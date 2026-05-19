import type { TickContext } from './context'
import { makeEventId } from './context'
import type { ProvinceId, PolityId, PersonId } from '../types/ids'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { OrganizationRef, OfficeRole } from '../types/office'
import {
  getPolityTerminalProvinceIds,
  isPlaceholderPerson,
} from '../selectors/landContractSelectors'
import {
  getActiveFactions,
  getFactionActiveMemberIds,
  getFactionNominationPower,
  getFactionalCandidateScore,
} from '../selectors/factionSelectors'
import {
  vacateBailiff,
  appointBailiff,
  installPlaceholderBailiff,
} from '../mutations/provinceOfficeMutations'
import { defaultLandContractConfig } from '../config/landContractConfig'

// v0.17.1 §15.3: bailiff 任命用の OfficeRole alias。
// getFactionNominationPower / getFactionalCandidateScore は role 引数を `void role` で
// 無視するが、型として OfficeRole を要求するため 'advisor' を渡す。Bailiff 用の重み付け
// は factionBailiffNominationWeight 側で調整する。
const BAILIFF_ROLE_ALIAS: OfficeRole = 'advisor'

// v0.16 §19: BailiffAppointmentSystem
// 各 terminal Polity ごとに ProvinceOfficeAssignment (bailiff) を走査:
//   - bailiff が placeholder で候補がいる → 通常人物を任命 (BAILIFF_APPOINTED)
//   - bailiff が死亡 or holder houseId が terminal owner と無関係 → vacate → placeholder install (BAILIFF_VACATED + BAILIFF_PLACEHOLDER_INSTALLED)
// 候補者選定: terminal Polity の ownerHouse member 優先 (active, adult, alive)。
// 起動頻度は config.bailiffAppointmentInterval (月単位)。
export function runBailiffAppointmentSystem(ctx: TickContext): TickContext {
  const interval = defaultLandContractConfig.bailiffAppointmentInterval
  const absMonth = ctx.state.currentYear * 12 + ctx.state.currentMonth
  if (absMonth % interval !== 0) return ctx

  let currentCtx = ctx

  for (const polityIdStr of Object.keys(currentCtx.state.polities).sort()) {
    const polityId = polityIdStr as PolityId
    const polity = currentCtx.state.polities[polityId]
    if (!polity || !polity.active) continue
    const ownerHouseId = polity.ownerHouseId
    if (!ownerHouseId) continue
    const ownerHouse = currentCtx.state.houses[ownerHouseId]
    if (!ownerHouse) continue

    const terminalProvinceIds = getPolityTerminalProvinceIds(currentCtx.state, polityId)

    // Term-based vacating (v0.17 §15.2): insert before step 1
    for (const provinceId of terminalProvinceIds) {
      const officeId = currentCtx.state.provinceOfficeIndex.byProvince[provinceId]
      if (!officeId) continue
      const office = currentCtx.state.provinceOfficeAssignments[officeId]
      if (!office) continue
      // Skip placeholder bailiffs (they never had a real tenure)
      if (office.holderPersonId.startsWith('pe-anon')) continue
      // Term expiration: yearly comparison
      if (
        currentCtx.state.currentYear - office.startYear >=
        currentCtx.config.provinceOfficeTermYears.bailiff
      ) {
        currentCtx = emitBailiffVacated(currentCtx, provinceId, office.holderPersonId)
        const beforeVacate = currentCtx.state
        const afterPlaceholder = installPlaceholderBailiff(beforeVacate, {
          provinceId,
          appointingPolityId: polityId,
          year: beforeVacate.currentYear,
          month: beforeVacate.currentMonth,
        })
        currentCtx = { ...currentCtx, state: afterPlaceholder }
        currentCtx = emitBailiffPlaceholderInstalled(currentCtx, provinceId, polityId)
      }
    }

    // 1) 死亡 / 不正な bailiff を vacate → placeholder へ
    for (const provinceId of terminalProvinceIds) {
      const officeId = currentCtx.state.provinceOfficeIndex.byProvince[provinceId]
      if (!officeId) continue
      const office = currentCtx.state.provinceOfficeAssignments[officeId]
      if (!office) continue
      const holder = currentCtx.state.persons[office.holderPersonId]
      const isAlive = holder?.alive === true && holder.kind !== 'placeholder'
      if (!isAlive) continue
      // holder の houseId が ownerHouse の members に属していない場合は再任命対象
      if (ownerHouse.memberIds.some((m) => m === holder.id)) {
        continue
      }
      currentCtx = emitBailiffVacated(currentCtx, provinceId, office.holderPersonId)
      const beforeVacate = currentCtx.state
      const afterPlaceholder = installPlaceholderBailiff(beforeVacate, {
        provinceId,
        appointingPolityId: polityId,
        year: beforeVacate.currentYear,
        month: beforeVacate.currentMonth,
      })
      currentCtx = { ...currentCtx, state: afterPlaceholder }
      currentCtx = emitBailiffPlaceholderInstalled(currentCtx, provinceId, polityId)
    }

    // 2) placeholder bailiff の交代:
    //    2a) factional 優先 (派閥 NP >= threshold の active member、Polity 内外問わず候補)
    //    2b) fallback: ownerHouse の free adult member
    //    どちらの経路でも他 active Office / 他 active ProvinceOffice は持っていないこと
    const polityRef: OrganizationRef = { kind: 'polity', id: polityId }

    const ownerFreeAdults = ownerHouse.memberIds
      .map((mid) => currentCtx.state.persons[mid])
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .filter(
        (p) =>
          p.alive &&
          p.age >= defaultLandContractConfig.bailiffMinAge &&
          p.kind !== 'placeholder' &&
          !hasActiveOffice(currentCtx.state, p.id) &&
          !hasActiveProvinceOffice(currentCtx.state, p.id),
      )
      .sort((a, b) => {
        const aScore = a.abilities.numeracy + a.abilities.insight
        const bScore = b.abilities.numeracy + b.abilities.insight
        if (bScore !== aScore) return bScore - aScore
        return a.id.localeCompare(b.id)
      })

    // 派閥候補プール (Polity に NP >= threshold な faction 全 active member から構築)。
    // スコア順 (降順) でソート済み。dedupe 済み (同一人物が複数 faction 所属時は最大スコア)。
    const factionalRanked = collectBailiffFactionalCandidates(
      currentCtx.state,
      currentCtx.config,
      polityRef,
    )

    const bookedThisTick = new Set<string>()

    for (const provinceId of terminalProvinceIds) {
      const officeId = currentCtx.state.provinceOfficeIndex.byProvince[provinceId]
      if (!officeId) continue
      const office = currentCtx.state.provinceOfficeAssignments[officeId]
      if (!office) continue
      if (!isPlaceholderPerson(currentCtx.state, office.holderPersonId)) continue

      let chosenId: PersonId | undefined

      // 2a) factional: 最高スコア候補が minAppointmentScore 以上なら採用
      for (const cand of factionalRanked) {
        if (bookedThisTick.has(cand.id)) continue
        if (cand.score < currentCtx.config.minAppointmentScore) break
        chosenId = cand.id
        break
      }

      // 2b) fallback: ownerHouse 内の free adult を score 順に消費
      if (!chosenId) {
        while (ownerFreeAdults.length > 0) {
          const candidate = ownerFreeAdults.shift()
          if (!candidate) break
          if (bookedThisTick.has(candidate.id)) continue
          chosenId = candidate.id
          break
        }
      }

      if (!chosenId) continue

      bookedThisTick.add(chosenId)
      const vacatedState = vacateBailiff(currentCtx.state, provinceId)
      const { state: appointedState } = appointBailiff(vacatedState, {
        provinceId,
        holderPersonId: chosenId,
        appointingPolityId: polityId,
        year: vacatedState.currentYear,
        month: vacatedState.currentMonth,
      })
      currentCtx = { ...currentCtx, state: appointedState }
      currentCtx = emitBailiffAppointed(currentCtx, provinceId, polityId, chosenId)
    }
  }

  return currentCtx
}

// v0.17.1 §15.3: bailiff 任命用の factional 候補プール。
// - Polity に対する NP が factionNominationPowerThreshold 以上の active faction が対象。
// - 各 faction の active member のうち: alive, adult, normal kind, 他 active Office / ProvinceOffice なし。
// - 同一人物が複数 faction 所属の場合は最大スコアで dedupe。
// - getFactionalCandidateScore に factionBailiffNominationWeight を掛けて bailiff 用に弱める。
function collectBailiffFactionalCandidates(
  state: WorldState,
  config: SimulationConfig,
  polityRef: OrganizationRef,
): { id: PersonId; score: number }[] {
  const byId = new Map<string, { id: PersonId; score: number }>()

  for (const faction of getActiveFactions(state)) {
    const np = getFactionNominationPower(state, config, faction.id, polityRef, BAILIFF_ROLE_ALIAS)
    if (np < config.factionNominationPowerThreshold) continue
    for (const mid of getFactionActiveMemberIds(state, faction.id)) {
      const m = state.persons[mid]
      if (!m || !m.alive) continue
      if (m.kind === 'placeholder') continue
      if (m.age < defaultLandContractConfig.bailiffMinAge) continue
      if (hasActiveOffice(state, mid)) continue
      if (hasActiveProvinceOffice(state, mid)) continue
      const raw = getFactionalCandidateScore(
        state,
        config,
        faction.id,
        mid,
        polityRef,
        BAILIFF_ROLE_ALIAS,
      )
      const score = raw * config.factionBailiffNominationWeight
      const prev = byId.get(mid)
      if (!prev || score > prev.score) byId.set(mid, { id: mid, score })
    }
  }

  const list = [...byId.values()]
  list.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.id.localeCompare(b.id)
  })
  return list
}

function hasActiveOffice(state: WorldState, personId: PersonId): boolean {
  const ids = state.officeIndex.byHolderPerson[personId] ?? []
  for (const id of ids) {
    const o = state.officeAssignments[id]
    if (o && o.active) return true
  }
  return false
}

function hasActiveProvinceOffice(state: WorldState, personId: PersonId): boolean {
  const ids = state.provinceOfficeIndex.byHolderPerson[personId] ?? []
  for (const id of ids) {
    const a = state.provinceOfficeAssignments[id]
    if (a && a.active) return true
  }
  return false
}

function emitBailiffAppointed(
  ctx: TickContext,
  provinceId: ProvinceId,
  polityId: PolityId,
  holderPersonId: PersonId,
): TickContext {
  const { id: eventId, ctx: c1 } = makeEventId(ctx)
  const province = c1.state.provinces[provinceId]
  const person = c1.state.persons[holderPersonId]
  const provinceName = province?.name ?? provinceId
  const personName = person?.name ?? holderPersonId
  const event: SimEvent = {
    id: eventId,
    year: c1.state.currentYear,
    month: c1.state.currentMonth,
    type: 'BAILIFF_APPOINTED',
    importance: 'minor',
    actorIds: [holderPersonId],
    houseIds: person?.houseId ? [person.houseId] : [],
    polityIds: [polityId],
    provinceIds: [provinceId],
    summary: `${personName} was appointed bailiff of ${provinceName}.`,
    reasons: [],
    effects: [],
  }
  return { ...c1, events: [...c1.events, event] }
}

function emitBailiffVacated(
  ctx: TickContext,
  provinceId: ProvinceId,
  holderPersonId: PersonId,
): TickContext {
  const { id: eventId, ctx: c1 } = makeEventId(ctx)
  const province = c1.state.provinces[provinceId]
  const person = c1.state.persons[holderPersonId]
  const provinceName = province?.name ?? provinceId
  const personName = person?.name ?? holderPersonId
  const event: SimEvent = {
    id: eventId,
    year: c1.state.currentYear,
    month: c1.state.currentMonth,
    type: 'BAILIFF_VACATED',
    importance: 'minor',
    actorIds: [holderPersonId],
    houseIds: [],
    polityIds: [],
    provinceIds: [provinceId],
    summary: `${personName} stepped down as bailiff of ${provinceName}.`,
    reasons: [],
    effects: [],
  }
  return { ...c1, events: [...c1.events, event] }
}

function emitBailiffPlaceholderInstalled(
  ctx: TickContext,
  provinceId: ProvinceId,
  polityId: PolityId,
): TickContext {
  const { id: eventId, ctx: c1 } = makeEventId(ctx)
  const province = c1.state.provinces[provinceId]
  const provinceName = province?.name ?? provinceId
  const event: SimEvent = {
    id: eventId,
    year: c1.state.currentYear,
    month: c1.state.currentMonth,
    type: 'BAILIFF_PLACEHOLDER_INSTALLED',
    importance: 'minor',
    actorIds: [],
    houseIds: [],
    polityIds: [polityId],
    provinceIds: [provinceId],
    summary: `An anonymous placeholder oversees ${provinceName}.`,
    reasons: [],
    effects: [],
  }
  return { ...c1, events: [...c1.events, event] }
}
