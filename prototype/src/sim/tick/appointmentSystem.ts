import type { TickContext } from './context'
import { createSimEvent } from './context'
import { isLifeStageAtLeast } from '../types/person'
import { nameParam, entityRef } from '../types/event'
import { createOfficeAssignment, revokeOfficesByHolder } from '../mutations/officeMutations'
import {
  getPolityLeader,
  getHouseLeader,
  getActiveOfficeHolders,
} from '../selectors/officeSelectors'
import { getHousePolitySharePercent, getPersonHouseSharePercent } from '../selectors/shareSelectors'
import { getPersonPrestige } from '../selectors/statusSelectors'
import { getAttitudeOrDefault, attitudeValueToScore } from '../helpers/attitudeHelpers'
import { getAppointmentTaskModifier } from '../selectors/appointmentTaskSelectors'

import type { PersonId, PolityId, HouseId } from '../types/ids'
import type { OfficeRole, OrganizationRef } from '../types/office'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { FactionId } from '../types/ids'
import type { Polity } from '../types/polity'
import type { House } from '../types/house'
import { getRoleScore } from '../selectors/abilitySelectors'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'
import {
  hasRelevantFactionForAppointment,
  getFactionalCandidateScore,
  getActiveFactions,
  getFactionNominationPower,
  getFactionActiveMemberIds,
} from '../selectors/factionSelectors'
import {
  getOfficeCompatibilityPenalty,
  getEffectiveOfficeMaxHolders,
  hasActiveHoldingOffice,
} from '../selectors/officeSelectors'
import {
  getHouseProjectedAnnualIncome,
  getHouseAnnualOfficeSalary,
} from '../selectors/houseFinanceSelectors'
import { getOfficeDefinition } from '../config/officeDefinitions'

const POLITY_APPOINTABLE_ROLES: OfficeRole[] = ['administrator', 'treasurer', 'military', 'advisor']
const HOUSE_APPOINTABLE_ROLES: OfficeRole[] = ['administrator', 'treasurer', 'military', 'advisor']

// polity / house 任命の共通前処理: 当該 organization/role の現職のうち
// 死亡 (or 不在) している者の役職を罷免し、更新後の ctx を返す。
function revokeDeadOfficeHolders(
  ctx: TickContext,
  organization: OrganizationRef,
  role: OfficeRole,
): TickContext {
  let currentCtx = ctx
  const currentHolders = getActiveOfficeHolders(currentCtx.state, organization, role)
  for (const holderId of currentHolders) {
    const holder = currentCtx.state.persons[holderId]
    if (!holder || !holder.alive) {
      currentCtx = { ...currentCtx, state: revokeOfficesByHolder(currentCtx.state, holderId) }
    }
  }
  return currentCtx
}

// スコア付き候補から最良を選ぶ共通処理: 降順ソートして先頭が minScore 以上なら採用。
// scored の構築 (どの候補をどの式でスコアリングするか) は呼び出し側に残す。
// NOTE: 同点時は scored の元順序 (= 安定ソートで先に来た候補) が勝つ挙動を保持する。
function pickBestScored(
  scored: { id: PersonId; score: number }[],
  minScore: number,
): { id: PersonId; score: number } | undefined {
  scored.sort((a, b) => b.score - a.score)
  const top = scored[0]
  return top && top.score >= minScore ? top : undefined
}

function getRelevantStat(state: WorldState, personId: PersonId, role: OfficeRole): number {
  switch (role) {
    case 'military':
      return getRoleScore(state, personId, 'warCommand') / 10
    default:
      return getRoleScore(state, personId, 'governance') / 10
  }
}

// ---------------------------------------------------------------------------
// v0.17 §14.6: Pre-computed polity candidate cache
// ---------------------------------------------------------------------------

type PolityCandidateCache = Map<string, PersonId[]>

function buildPolityCandidateCache(state: WorldState): PolityCandidateCache {
  const housePrimaryPolity = new Map<string, PolityId>()
  for (const houseId of Object.keys(state.houses)) {
    const h = state.houses[houseId as HouseId]
    if (!h || !h.active) continue
    const polityId = getHousePrimaryPolityId(state, houseId as HouseId)
    if (polityId) housePrimaryPolity.set(houseId, polityId)
  }

  const ownerHousePolities = new Map<string, PolityId[]>()
  for (const polityId of Object.keys(state.polities)) {
    const polity = state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue
    if (polity.ownerHouseId !== undefined) {
      const list = ownerHousePolities.get(polity.ownerHouseId) ?? []
      list.push(polityId as PolityId)
      ownerHousePolities.set(polity.ownerHouseId, list)
    }
  }

  const cache: PolityCandidateCache = new Map()
  for (const pid of state.livingPersonIds) {
    const p = state.persons[pid]
    if (!p) continue
    if (p.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(p.lifeStage, 'young_adulthood')) continue
    if (hasActiveHoldingOffice(state, pid)) continue
    if (!p.houseId) continue
    const house = state.houses[p.houseId]
    if (!house || !house.active) continue

    const addedPolities = new Set<string>()
    const primaryPolity = housePrimaryPolity.get(p.houseId)
    if (primaryPolity) {
      const list = cache.get(primaryPolity) ?? []
      list.push(pid)
      cache.set(primaryPolity, list)
      addedPolities.add(primaryPolity)
    }
    const ownerPolities = ownerHousePolities.get(p.houseId)
    if (ownerPolities) {
      for (const polityId of ownerPolities) {
        if (addedPolities.has(polityId)) continue
        const list = cache.get(polityId) ?? []
        list.push(pid)
        cache.set(polityId, list)
      }
    }
  }
  return cache
}

function collectHouseCandidatesTraditional(
  state: WorldState,
  config: SimulationConfig,
  house: House,
  alreadyHolding: Set<string>,
): PersonId[] {
  void config
  const result: PersonId[] = []
  for (const memberId of house.memberIds) {
    const member = state.persons[memberId]
    if (!member || !member.alive) continue
    if (member.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(member.lifeStage, 'young_adulthood')) continue
    if (alreadyHolding.has(memberId)) continue
    // v0.17.1 §15.3: active Bailiff (HoldingOffice) 保有者は候補外
    if (hasActiveHoldingOffice(state, memberId)) continue
    result.push(memberId)
  }
  return result
}

// v0.17.1 §15.3: 別 Holding の bailiff として active な HoldingOffice を持つ Person を判定。
// ---------------------------------------------------------------------------
// v0.17 §14.1: Factional candidate collection
// ---------------------------------------------------------------------------

function collectFactionalCandidates(
  state: WorldState,
  config: SimulationConfig,
  org: OrganizationRef,
  role: OfficeRole,
): { factionId: FactionId; candidateId: PersonId }[] {
  const result: { factionId: FactionId; candidateId: PersonId }[] = []
  for (const faction of getActiveFactions(state)) {
    const np = getFactionNominationPower(state, config, faction.id, org, role)
    if (np < config.factionNominationPowerThreshold) continue
    for (const mid of getFactionActiveMemberIds(state, faction.id)) {
      const m = state.persons[mid]
      if (!m || !m.alive) continue
      if (m.kind === 'placeholder') continue
      if (!isLifeStageAtLeast(m.lifeStage, 'young_adulthood')) continue
      // v0.17.1 §15.3: active Bailiff 保有者は Polity/House Office 候補から除外
      if (hasActiveHoldingOffice(state, mid)) continue
      result.push({ factionId: faction.id, candidateId: mid })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// v0.17 §14.5: Traditional scoring with v0.17 adjustments
// ---------------------------------------------------------------------------

function computePolityScoreV017(
  state: WorldState,
  config: SimulationConfig,
  polity: Polity,
  rulerId: PersonId,
  personId: PersonId,
  role: OfficeRole,
): number {
  const person = state.persons[personId]
  if (!person) return -Infinity
  if (!person.houseId) return -Infinity
  const ruler = state.persons[rulerId]

  const prestige = getPersonPrestige(state, personId)
  const leaderRespect = ruler
    ? attitudeValueToScore(
        getAttitudeOrDefault(state, ruler, { kind: 'polity', id: polity.id }).respect,
      ) / 100
    : 0
  const polityAtt = getAttitudeOrDefault(state, person, { kind: 'polity', id: polity.id })
  const polityAffection = attitudeValueToScore(polityAtt.affection) / 100
  const houseSharePct = getHousePolitySharePercent(state, polity.id, person.houseId)
  const personSharePct = getPersonHouseSharePercent(state, person.houseId, personId)

  // same-house polity office count (effective per v0.17 §14.5)
  const polityOfficeIds = state.officeIndex.byOrganization[`polity:${polity.id}`] ?? []
  let sameHousePolityOfficeCount = 0
  for (const oId of polityOfficeIds) {
    const o = state.officeAssignments[oId]
    if (!o || !o.active) continue
    const p = state.persons[o.holderPersonId]
    if (p && p.houseId === person.houseId) sameHousePolityOfficeCount++
  }
  const sameHouseEffective =
    config.sameHousePolityOfficePenalty * (1 - houseSharePct / 100) * sameHousePolityOfficeCount

  // ownerHouseBonus: 0 when ownerHouseId is undefined (commonwealth)
  const ownerHouseBonus =
    polity.ownerHouseId !== undefined && polity.ownerHouseId === person.houseId
      ? config.ownerHouseAppointmentBonus
      : 0

  // v0.17 §14.5: replace concurrentOfficePenalty * count with getOfficeCompatibilityPenalty
  const compatibilityPenalty = getOfficeCompatibilityPenalty(
    state,
    config,
    personId,
    { kind: 'polity', id: polity.id },
    role,
  )

  return (
    getRelevantStat(state, personId, role) * 1.0 +
    (prestige / 100) * 8 +
    leaderRespect * 4 +
    polityAffection * 3 +
    houseSharePct * config.polityShareAppointmentFactor +
    personSharePct * config.houseShareAppointmentFactor +
    ownerHouseBonus -
    compatibilityPenalty -
    sameHouseEffective +
    getAppointmentTaskModifier(state, config, personId, { kind: 'polity', id: polity.id }, role) -
    // v0.40 §9.3: old_age は固定減算（負スコアでも単調に不利化するため乗算でなく減算）。
    (person.lifeStage === 'old_age' ? config.oldAgeAppointmentScorePenalty : 0)
  )
}

function computeHouseScoreV017(
  state: WorldState,
  config: SimulationConfig,
  house: House,
  leaderId: PersonId,
  personId: PersonId,
  role: OfficeRole,
): number {
  const person = state.persons[personId]
  if (!person) return -Infinity
  const leader = state.persons[leaderId]

  const prestige = getPersonPrestige(state, personId)
  const leaderRespect = leader
    ? attitudeValueToScore(
        getAttitudeOrDefault(state, leader, { kind: 'house', id: house.id }).respect,
      ) / 100
    : 0
  const houseAtt = getAttitudeOrDefault(state, person, { kind: 'house', id: house.id })
  const houseAffection = attitudeValueToScore(houseAtt.affection) / 100
  const personSharePct = getPersonHouseSharePercent(state, house.id, personId)

  // v0.17 §14.5: replace concurrentOfficePenalty * count with getOfficeCompatibilityPenalty
  const compatibilityPenalty = getOfficeCompatibilityPenalty(
    state,
    config,
    personId,
    { kind: 'house', id: house.id },
    role,
  )

  return (
    getRelevantStat(state, personId, role) * 1.0 +
    (prestige / 100) * 10 +
    leaderRespect * 5 +
    houseAffection * 3 +
    personSharePct * 0.1 -
    compatibilityPenalty +
    getAppointmentTaskModifier(state, config, personId, { kind: 'house', id: house.id }, role) -
    // v0.40 §9.3: old_age は固定減算。
    (person.lifeStage === 'old_age' ? config.oldAgeAppointmentScorePenalty : 0)
  )
}

// ---------------------------------------------------------------------------
// v0.17 §14.1: tryAppoint helpers (dispatch between factional and traditional)
// ---------------------------------------------------------------------------

function tryAppointPolityOffice(
  ctx: TickContext,
  polity: Polity,
  rulerId: PersonId,
  role: OfficeRole,
  cachedCandidates: PersonId[],
): TickContext {
  const config = ctx.config
  const polityRef: OrganizationRef = { kind: 'polity', id: polity.id }

  // 1. revoke dead holders
  let currentCtx = revokeDeadOfficeHolders(ctx, polityRef, role)

  const activeHolders = getActiveOfficeHolders(currentCtx.state, polityRef, role)
  const effectiveMax = getEffectiveOfficeMaxHolders(currentCtx.state, config, polityRef, role)
  if (activeHolders.length >= effectiveMax) return currentCtx
  const alreadyHolding = new Set(activeHolders.map((id) => id as string))

  let best: { id: PersonId; score: number } | undefined

  // 2. factional path
  if (hasRelevantFactionForAppointment(currentCtx.state, config, polityRef, role)) {
    const factional = collectFactionalCandidates(currentCtx.state, config, polityRef, role).filter(
      (c) => !alreadyHolding.has(c.candidateId as string),
    )
    const scored = factional.map((c) => ({
      id: c.candidateId,
      score: getFactionalCandidateScore(
        currentCtx.state,
        config,
        c.factionId,
        c.candidateId,
        polityRef,
        role,
      ),
    }))
    best = pickBestScored(scored, config.minAppointmentScore)
  }

  // 3. traditional fallback (uses pre-computed candidate cache)
  if (!best) {
    const candidates = cachedCandidates.filter((id) => !alreadyHolding.has(id as string))
    const scored = candidates.map((id) => ({
      id,
      score: computePolityScoreV017(currentCtx.state, config, polity, rulerId, id, role),
    }))
    best = pickBestScored(scored, config.minAppointmentScore)
  }

  if (!best) return currentCtx

  const newState = createOfficeAssignment(currentCtx.state, polityRef, role, best.id)
  currentCtx = { ...currentCtx, state: newState }

  const person = currentCtx.state.persons[best.id]
  if (person && person.houseId) {
    const house = currentCtx.state.houses[person.houseId]
    if (house) {
      const { event, ctx: eventCtx } = createSimEvent(currentCtx, {
        type: 'OFFICE_ASSIGNED',
        importance: 'normal',
        messageKey: 'office.assigned_polity',
        messageParams: {
          person: nameParam('person', person.nameKey),
          role: nameParam('role', `polity_${role}`),
          polity: nameParam('polity', polity.nameKey),
        },
        entityRefs: [
          entityRef('person', best.id, 'appointee', person.nameKey),
          entityRef('polity', polity.id, 'organization', polity.nameKey),
        ],
      })
      currentCtx = {
        ...eventCtx,
        state: currentCtx.state,
        events: [...eventCtx.events, event],
      }
    }
  }

  return currentCtx
}

function tryAppointHouseOffice(
  ctx: TickContext,
  house: House,
  leaderId: PersonId,
  role: OfficeRole,
  getFactionalCandidates: () => { factionId: FactionId; candidateId: PersonId }[] | null,
  projectedAnnualIncome: number,
): TickContext {
  const config = ctx.config
  const houseRef: OrganizationRef = { kind: 'house', id: house.id }

  // 1. revoke dead holders
  let currentCtx = revokeDeadOfficeHolders(ctx, houseRef, role)

  const activeHolders = getActiveOfficeHolders(currentCtx.state, houseRef, role)
  const effectiveMax = getEffectiveOfficeMaxHolders(currentCtx.state, config, houseRef, role)
  if (activeHolders.length >= effectiveMax) return currentCtx

  // v0.37: 家役職の支払能力ゲート。家が定常的に得る収入 (PolitySurplus) で
  // 既存役職 + この役職の年間給与を賄えないなら任命しない (収入ベースの役職数)。
  // 収入の無い landless 小家系が給与未払い (OFFICE_SALARY_UNPAID) を量産する問題への対処。
  // leader (baseSalary=0) は対象外。Polity 役職は別経路で財庫から支払われるため不問。
  const roleSalary = getOfficeDefinition('house', role)?.baseSalary ?? 0
  if (roleSalary > 0) {
    const currentSalary = getHouseAnnualOfficeSalary(currentCtx.state, house.id)
    if (currentSalary + roleSalary > projectedAnnualIncome) return currentCtx
  }

  const alreadyHolding = new Set(activeHolders.map((id) => id as string))

  let best: { id: PersonId; score: number } | undefined

  // 2. factional path (lazy-computed once per house, shared across roles)
  const cachedFactionalCandidates = getFactionalCandidates()
  if (cachedFactionalCandidates) {
    const factional = cachedFactionalCandidates.filter(
      (c) => !alreadyHolding.has(c.candidateId as string),
    )
    const scored = factional.map((c) => ({
      id: c.candidateId,
      score: getFactionalCandidateScore(
        currentCtx.state,
        config,
        c.factionId,
        c.candidateId,
        houseRef,
        role,
      ),
    }))
    best = pickBestScored(scored, config.minAppointmentScore)
  }

  // 3. traditional fallback
  if (!best) {
    const candidates = collectHouseCandidatesTraditional(
      currentCtx.state,
      config,
      house,
      alreadyHolding,
    )
    const scored = candidates.map((id) => ({
      id,
      score: computeHouseScoreV017(currentCtx.state, config, house, leaderId, id, role),
    }))
    best = pickBestScored(scored, config.minAppointmentScore)
  }

  if (!best) return currentCtx

  const newState = createOfficeAssignment(currentCtx.state, houseRef, role, best.id)
  currentCtx = { ...currentCtx, state: newState }

  const person = currentCtx.state.persons[best.id]
  if (person) {
    const { event, ctx: eventCtx } = createSimEvent(currentCtx, {
      type: 'OFFICE_ASSIGNED',
      importance: 'normal',
      messageKey: 'office.assigned_house',
      messageParams: {
        person: nameParam('person', person.nameKey),
        role: nameParam('role', `house_${role}`),
        house: nameParam('house', house.nameKey),
      },
      entityRefs: [
        entityRef('person', best.id, 'appointee', person.nameKey),
        entityRef('house', house.id, 'organization', house.nameKey),
      ],
    })
    currentCtx = { ...eventCtx, state: currentCtx.state, events: [...eventCtx.events, event] }
  }

  return currentCtx
}

export function runAppointmentSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  const polityCandidateCache = buildPolityCandidateCache(currentCtx.state)

  // Polity offices
  for (const polityId of Object.keys(currentCtx.state.polities).sort()) {
    const polity = currentCtx.state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue

    const rulerId = getPolityLeader(currentCtx.state, polityId as PolityId)
    if (!rulerId) continue

    const cachedCandidates = polityCandidateCache.get(polityId) ?? []
    for (const role of POLITY_APPOINTABLE_ROLES) {
      currentCtx = tryAppointPolityOffice(currentCtx, polity, rulerId, role, cachedCandidates)
    }
  }

  // House offices
  for (const houseId of Object.keys(currentCtx.state.houses).sort()) {
    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue

    const leaderId = getHouseLeader(currentCtx.state, houseId as HouseId)
    if (!leaderId) continue

    // v0.37: 家の投影年間収入を 1 家につき 1 回だけ計算 (役職ループ内で共有)。
    // 家役職の任命は当家収入を変えないため (share は年次の shareUpdateSystem でのみ更新)、
    // ループ前に一度確定させてよい。
    const projectedAnnualIncome = getHouseProjectedAnnualIncome(
      currentCtx.state,
      houseId as HouseId,
      currentCtx.config,
    )

    // Lazily compute factional candidates (once per house, shared across roles)
    let factionalCandidatesComputed = false
    let factionalCandidates: { factionId: FactionId; candidateId: PersonId }[] | null = null
    const getHouseFactionalCandidates = () => {
      if (!factionalCandidatesComputed) {
        factionalCandidatesComputed = true
        const houseRef: OrganizationRef = { kind: 'house', id: house.id }
        factionalCandidates = hasRelevantFactionForAppointment(
          currentCtx.state,
          currentCtx.config,
          houseRef,
          'administrator',
        )
          ? collectFactionalCandidates(
              currentCtx.state,
              currentCtx.config,
              houseRef,
              'administrator',
            )
          : null
      }
      return factionalCandidates
    }

    for (const role of HOUSE_APPOINTABLE_ROLES) {
      currentCtx = tryAppointHouseOffice(
        currentCtx,
        house,
        leaderId,
        role,
        getHouseFactionalCandidates,
        projectedAnnualIncome,
      )
    }
  }

  return currentCtx
}
