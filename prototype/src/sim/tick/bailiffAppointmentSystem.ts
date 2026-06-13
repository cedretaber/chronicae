import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { HoldingId, PolityId, PersonId, ProvinceId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import type { OrganizationRef, OfficeRole } from '../types/office'
import {
  getPolityTerminalProvinceIds,
  isPlaceholderPerson,
} from '../selectors/landContractSelectors'
import {
  getActiveFactions,
  collectSubtreeMemberWeights,
  getFactionNominationPower,
  getFactionalCandidateScore,
} from '../selectors/factionSelectors'
import {
  vacateHoldingBailiff,
  appointHoldingBailiff,
  installHoldingPlaceholderBailiff,
} from '../mutations/provinceOfficeMutations'
import { hasActiveOffice, hasActiveHoldingOffice } from '../selectors/officeSelectors'
import {
  isEstablishedCommonwealthRepublic,
  getRepublicPoliticalCandidatePersons,
} from '../selectors/republicSelectors'
import { getHoldingOfficeAppointmentRight } from '../selectors/politicalRightSelectors'
import { isRoleEligibleBySex } from '../selectors/roleEligibilitySelectors'

// v0.17.1 §15.3: bailiff 任命用の OfficeRole alias。
// getFactionNominationPower / getFactionalCandidateScore は role 引数を `void role` で
// 無視するが、型として OfficeRole を要求するため 'advisor' を渡す。Bailiff 用の重み付け
// は factionBailiffNominationWeight 側で調整する。
const BAILIFF_ROLE_ALIAS: OfficeRole = 'advisor'

// v0.16 §19: BailiffAppointmentSystem
// 各 terminal Polity ごとに HoldingOfficeAssignment (bailiff) を走査:
//   - bailiff が placeholder で候補がいる → 通常人物を任命 (BAILIFF_APPOINTED)
//   - bailiff が死亡 or holder houseId が terminal owner と無関係 → vacate → placeholder install (BAILIFF_VACATED + BAILIFF_PLACEHOLDER_INSTALLED)
// 候補者選定: terminal Polity の ownerHouse member 優先 (active, adult, alive)。
// 起動頻度は config.bailiffAppointmentInterval (月単位)。
export function runBailiffAppointmentSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const polityIdStr of Object.keys(currentCtx.state.polities).sort()) {
    const polityId = polityIdStr as PolityId
    const polity = currentCtx.state.polities[polityId]
    if (!polity || !polity.active) continue
    // commonwealth アリーナ化: ownerHouseId を持たない polity も、established commonwealth なら
    // 代官を任命する (旧 `if (!ownerHouseId) continue` で丸ごとスキップしていた)。Tier 2b の
    // 候補母集合は ownerHouse.memberIds の代わりに getRepublicPoliticalCandidatePersons とする。
    const ownerHouseId = polity.ownerHouseId
    let candidatePoolIds: PersonId[]
    if (ownerHouseId !== undefined) {
      const ownerHouse = currentCtx.state.houses[ownerHouseId]
      if (!ownerHouse) continue
      candidatePoolIds = ownerHouse.memberIds
    } else if (isEstablishedCommonwealthRepublic(currentCtx.state, polityId)) {
      candidatePoolIds = getRepublicPoliticalCandidatePersons(
        currentCtx.state,
        currentCtx.config,
        polityId,
      )
    } else {
      continue
    }

    const terminalProvinceIds = getPolityTerminalProvinceIds(currentCtx.state, polityId)

    // Collect holdings from terminal provinces
    // getPolityTerminalProvinceIds は「この Polity が 1 つ以上の holding を terminal 支配する
    // Province」を返す (Province 粒度)。分割 Province (例: 反乱 commonwealth が 1 holding だけ
    // seizure) では、この Polity が支配しない holding も含まれる。holding 粒度で
    // holdingTerminalPolityCache を見て、自分が terminal 支配する holding のみに絞る。
    // これを怠ると、旧 grantor (同 Province の他 holding を保持) が奪われた holding の bailiff を
    // 毎サイクル再任命し、land 移転時の bailiff リセットを打ち消す (influence リークの再発)。
    const terminalHoldings: { provinceId: ProvinceId; holdingId: HoldingId }[] = []
    for (const provinceId of terminalProvinceIds) {
      const province = currentCtx.state.provinces[provinceId]
      if (!province) continue
      for (const holdingId of province.holdingIds) {
        if (currentCtx.state.holdingTerminalPolityCache[holdingId] !== polityId) continue
        terminalHoldings.push({ provinceId, holdingId })
      }
    }

    // Term-based vacating (v0.17 §15.2): insert before step 1
    for (const { provinceId, holdingId } of terminalHoldings) {
      const officeId = currentCtx.state.holdingOfficeIndex.byHolding[holdingId]
      if (!officeId) continue
      const office = currentCtx.state.holdingOfficeAssignments[officeId]
      if (!office) continue
      // Skip placeholder bailiffs (they never had a real tenure)
      // v0.17.2: Person.kind ベース判定に統一 (singleton 化に伴い ID prefix check は廃止)
      if (isPlaceholderPerson(currentCtx.state, office.holderPersonId)) continue
      // Term expiration: week-based comparison
      const termWeeks = currentCtx.config.provinceOfficeTermYears.bailiff * WEEKS_PER_YEAR
      if (currentCtx.state.absoluteWeek - office.startWeek >= termWeeks) {
        // v0.27: Project 使用中の bailiff は通常任期交代から保護
        if (
          office.termProtectedUntilWeek &&
          currentCtx.state.absoluteWeek < office.termProtectedUntilWeek
        )
          continue
        currentCtx = emitBailiffVacated(currentCtx, provinceId, office.holderPersonId)
        const beforeVacate = currentCtx.state
        const afterPlaceholder = installHoldingPlaceholderBailiff(beforeVacate, {
          holdingId,
          appointingPolityId: polityId,
          week: beforeVacate.absoluteWeek,
        })
        currentCtx = { ...currentCtx, state: afterPlaceholder }
        currentCtx = emitBailiffPlaceholderInstalled(currentCtx, provinceId)
      }
    }

    // 1) 死亡 / 欠落 holder の vacate → placeholder へ
    // v0.17.2: 旧版の「ownerHouse 外の holder を vacate」ロジックを削除。
    // v0.17.1 で factional bailiff (ownerHouse 外の派閥員) を意図的に任命するようになったため、
    // この check が factional bailiff を毎 6 ヶ月で即解任する事故を引き起こしていた。
    // 死亡 holder のみ vacate する。生存中の holder は (placeholder / normal / 所属 House を問わず)
    // 任期 (step 0) で循環させる方針に切り替える。
    for (const { provinceId, holdingId } of terminalHoldings) {
      const officeId = currentCtx.state.holdingOfficeIndex.byHolding[holdingId]
      if (!officeId) continue
      const office = currentCtx.state.holdingOfficeAssignments[officeId]
      if (!office) continue
      const holder = currentCtx.state.persons[office.holderPersonId]
      // 既に Person が消えている / 死亡している場合のみ vacate (placeholder は alive=true なので除外)
      const needsVacate = !holder || (!holder.alive && holder.kind !== 'placeholder')
      if (!needsVacate) continue
      currentCtx = emitBailiffVacated(currentCtx, provinceId, office.holderPersonId)
      const beforeVacate = currentCtx.state
      const afterPlaceholder = installHoldingPlaceholderBailiff(beforeVacate, {
        holdingId,
        appointingPolityId: polityId,
        week: beforeVacate.absoluteWeek,
      })
      currentCtx = { ...currentCtx, state: afterPlaceholder }
      currentCtx = emitBailiffPlaceholderInstalled(currentCtx, provinceId)
    }

    // 2) placeholder bailiff の交代:
    //    2a) factional 優先 (派閥 NP >= threshold の active member、Polity 内外問わず候補)
    //    2b) fallback: ownerHouse の free adult member
    //    どちらの経路でも他 active Office / 他 active HoldingOffice は持っていないこと
    const polityRef: OrganizationRef = { kind: 'polity', id: polityId }

    const ownerFreeAdults = candidatePoolIds
      .map((mid) => currentCtx.state.persons[mid])
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .filter(
        (p) =>
          p.alive &&
          p.age >= currentCtx.config.bailiffMinAge &&
          p.kind !== 'placeholder' &&
          !hasActiveOffice(currentCtx.state, p.id) &&
          !hasActiveHoldingOffice(currentCtx.state, p.id),
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

    for (const { provinceId, holdingId } of terminalHoldings) {
      const officeId = currentCtx.state.holdingOfficeIndex.byHolding[holdingId]
      if (!officeId) continue
      const office = currentCtx.state.holdingOfficeAssignments[officeId]
      if (!office) continue
      if (!isPlaceholderPerson(currentCtx.state, office.holderPersonId)) continue

      // v0.45.3 性別役職適格ゲート: 3 tier すべて gated で評価し、空振りした場合のみ
      // ungated 再試行する (cascade 全体の後に 1 箇所 — appointmentSystem と同形)。
      const appointmentRight = getHoldingOfficeAppointmentRight(currentCtx.state, holdingId)
      const pickBailiff = (gate: boolean): PersonId | undefined => {
        const passes = (id: PersonId): boolean =>
          !gate || isRoleEligibleBySex(currentCtx.state, currentCtx.config, id)

        // Tier 0) holding_office_appointment right holder (v0.42 §10.2)。
        // holder が候補を出せない場合は factional / ownerHouse へ fall-through する
        // (polity office と意図的に非対称 — bailiff は行政実務を止めない現場職のため)。
        if (appointmentRight) {
          const rightCandidateIds =
            appointmentRight.holder.kind === 'house'
              ? (currentCtx.state.houses[appointmentRight.holder.id]?.memberIds ?? [])
              : [appointmentRight.holder.id]
          const rightCandidates = rightCandidateIds
            .map((mid) => currentCtx.state.persons[mid])
            .filter((p): p is NonNullable<typeof p> => p !== undefined)
            .filter(
              (p) =>
                p.alive &&
                p.age >= currentCtx.config.bailiffMinAge &&
                p.kind !== 'placeholder' &&
                !hasActiveOffice(currentCtx.state, p.id) &&
                !hasActiveHoldingOffice(currentCtx.state, p.id) &&
                !bookedThisTick.has(p.id) &&
                passes(p.id),
            )
            .sort((a, b) => {
              const aScore = a.abilities.numeracy + a.abilities.insight
              const bScore = b.abilities.numeracy + b.abilities.insight
              if (bScore !== aScore) return bScore - aScore
              return a.id.localeCompare(b.id)
            })
          const rightChoice = rightCandidates[0]?.id
          if (rightChoice) return rightChoice
        }

        // 2a) factional: 最高スコア候補が minAppointmentScore 以上なら採用
        //     (anchor polity 限定 — getFactionNominationPower が非 anchor で 0 を返す §12.4)
        for (const cand of factionalRanked) {
          if (bookedThisTick.has(cand.id)) continue
          if (cand.score < currentCtx.config.minAppointmentScore) break
          if (!passes(cand.id)) continue
          return cand.id
        }

        // 2b) fallback: ownerHouse 内の free adult を score 順に走査
        //     (v0.45.3: gated/ungated の 2 回呼びで壊れないよう shift 消費を走査に変更。
        //      着座者は bookedThisTick で除外されるため挙動は同等)
        for (const candidate of ownerFreeAdults) {
          if (bookedThisTick.has(candidate.id)) continue
          if (!passes(candidate.id)) continue
          return candidate.id
        }

        return undefined
      }

      let chosenId = pickBailiff(true)
      if (!chosenId && currentCtx.config.allowFemaleRolesWhenNoMaleCandidate) {
        chosenId = pickBailiff(false)
      }

      if (!chosenId) continue

      bookedThisTick.add(chosenId)
      const vacatedState = vacateHoldingBailiff(currentCtx.state, holdingId)
      const { state: appointedState } = appointHoldingBailiff(vacatedState, {
        holdingId,
        holderPersonId: chosenId,
        appointingPolityId: polityId,
        week: vacatedState.absoluteWeek,
      })
      currentCtx = { ...currentCtx, state: appointedState }
      currentCtx = emitBailiffAppointed(currentCtx, provinceId, polityId, chosenId)
    }
  }

  return currentCtx
}

// v0.17.1 §15.3: bailiff 任命用の factional 候補プール。
// - Polity に対する NP が factionNominationPowerThreshold 以上の active faction が対象。
// - 各 faction の active member のうち: alive, adult, normal kind, 他 active Office / HoldingOffice なし。
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
    // 入れ子 Phase 2-b: 親の実効プール = 自前 ∪ 子孫メンバー (深さで score 割引)。
    // protégé は sub-leader の推薦を通して親の席に届く (§4.2)。own のみの派閥では従来と一致。
    for (const { memberId: mid, weight: depthWeight } of collectSubtreeMemberWeights(
      state,
      config,
      faction.id,
    )) {
      const m = state.persons[mid]
      if (!m || !m.alive) continue
      if (m.kind === 'placeholder') continue
      if (m.age < config.bailiffMinAge) continue
      if (hasActiveOffice(state, mid)) continue
      if (hasActiveHoldingOffice(state, mid)) continue
      const raw = getFactionalCandidateScore(
        state,
        config,
        faction.id,
        mid,
        polityRef,
        BAILIFF_ROLE_ALIAS,
      )
      const score = raw * config.factionBailiffNominationWeight * depthWeight
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

function emitBailiffAppointed(
  ctx: TickContext,
  provinceId: ProvinceId,
  _polityId: PolityId,
  holderPersonId: PersonId,
): TickContext {
  const province = ctx.state.provinces[provinceId]
  const person = ctx.state.persons[holderPersonId]
  const provinceName = nameParam('province', province?.nameKey ?? provinceId)
  const personName = nameParam('person', person?.nameKey ?? holderPersonId)
  const { event, ctx: c1 } = createSimEvent(ctx, {
    type: 'BAILIFF_APPOINTED',
    importance: 'minor',
    messageKey: 'bailiff.appointed',
    messageParams: {
      person: personName,
      province: provinceName,
    },
    entityRefs: [
      entityRef('person', holderPersonId, 'bailiff', person?.nameKey),
      entityRef('province', provinceId, 'province'),
    ],
  })
  return { ...c1, events: [...c1.events, event] }
}

function emitBailiffVacated(
  ctx: TickContext,
  provinceId: ProvinceId,
  holderPersonId: PersonId,
): TickContext {
  const province = ctx.state.provinces[provinceId]
  const person = ctx.state.persons[holderPersonId]
  const provinceName = nameParam('province', province?.nameKey ?? provinceId)
  const personName = nameParam('person', person?.nameKey ?? holderPersonId)
  const { event, ctx: c1 } = createSimEvent(ctx, {
    type: 'BAILIFF_VACATED',
    importance: 'minor',
    messageKey: 'bailiff.vacated',
    messageParams: {
      person: personName,
      province: provinceName,
    },
    entityRefs: [
      entityRef('person', holderPersonId, 'bailiff'),
      entityRef('province', provinceId, 'province'),
    ],
  })
  return { ...c1, events: [...c1.events, event] }
}

function emitBailiffPlaceholderInstalled(ctx: TickContext, provinceId: ProvinceId): TickContext {
  const province = ctx.state.provinces[provinceId]
  const provinceName = nameParam('province', province?.nameKey ?? provinceId)
  const { event, ctx: c1 } = createSimEvent(ctx, {
    type: 'BAILIFF_PLACEHOLDER_INSTALLED',
    importance: 'minor',
    messageKey: 'bailiff.placeholder_installed',
    messageParams: {
      province: provinceName,
    },
    entityRefs: [entityRef('province', provinceId, 'province')],
  })
  return { ...c1, events: [...c1.events, event] }
}
