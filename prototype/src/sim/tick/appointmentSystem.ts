import type { TickContext } from './context'
import { makeEventId } from './context'
import { createOfficeAssignment, revokeOfficesByHolder } from '../mutations/officeMutations'
import {
  getPolityLeader,
  getHouseLeader,
  getActiveOfficeHolders,
} from '../selectors/officeSelectors'
import { getHousePolitySharePercent, getPersonHouseSharePercent } from '../selectors/shareSelectors'
import { getPersonPrestige } from '../selectors/statusSelectors'
import { getAttitudeOrDefault, attitudeValueToScore } from '../helpers/attitudeHelpers'
import { OFFICE_DEFINITIONS } from '../config/officeDefinitions'
import type { PersonId, PolityId, HouseId } from '../types/ids'
import type { OfficeRole, OrganizationRef } from '../types/office'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { FactionId } from '../types/ids'
import type { Polity } from '../types/polity'
import type { House } from '../types/house'
import { getRoleScore } from '../selectors/abilitySelectors'
import { getPersonPrimaryPolityId } from '../selectors/polityRelations'
import {
  hasRelevantFactionForAppointment,
  getFactionalCandidateScore,
  getActiveFactions,
  getFactionNominationPower,
  getFactionActiveMemberIds,
} from '../selectors/factionSelectors'
import { getOfficeCompatibilityPenalty } from '../selectors/officeSelectors'

const POLITY_APPOINTABLE_ROLES: OfficeRole[] = ['administrator', 'treasurer', 'military', 'advisor']
const HOUSE_APPOINTABLE_ROLES: OfficeRole[] = ['administrator', 'treasurer', 'military', 'advisor']

function getRelevantStat(state: WorldState, personId: PersonId, role: OfficeRole): number {
  switch (role) {
    case 'military':
      return getRoleScore(state, personId, 'warCommand') / 10
    default:
      return getRoleScore(state, personId, 'governance') / 10
  }
}

// ---------------------------------------------------------------------------
// v0.17 §14.6: Traditional pool collection (system House exclusion removed)
// ---------------------------------------------------------------------------

function collectPolityCandidatesTraditional(
  state: WorldState,
  config: SimulationConfig,
  polity: Polity,
  alreadyHolding: Set<string>,
): PersonId[] {
  void config
  const result: PersonId[] = []
  for (const pidStr of Object.keys(state.persons).sort()) {
    const pid = pidStr as PersonId
    const p = state.persons[pid]
    if (!p || !p.alive) continue
    if (p.kind === 'placeholder') continue
    if (p.age < config.adultAge) continue
    if (alreadyHolding.has(pid)) continue
    // v0.17.1 §15.3: active Bailiff (HoldingOffice) 保有者は候補外
    if (hasActiveHoldingOffice(state, pid)) continue
    const house = state.houses[p.houseId]
    if (!house || !house.active) continue
    // v0.17 §14.6: system House 所属者除外を撤廃 (placeholder のみ除外)
    const personPrimaryPolityId = getPersonPrimaryPolityId(state, pid)
    const isOwnerHouseMember =
      polity.ownerHouseId !== undefined && p.houseId === polity.ownerHouseId
    if (personPrimaryPolityId !== polity.id && !isOwnerHouseMember) continue
    result.push(pid)
  }
  return result
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
    if (member.age < config.adultAge) continue
    if (alreadyHolding.has(memberId)) continue
    // v0.17.1 §15.3: active Bailiff (HoldingOffice) 保有者は候補外
    if (hasActiveHoldingOffice(state, memberId)) continue
    result.push(memberId)
  }
  return result
}

// v0.17.1 §15.3: 別 Holding の bailiff として active な HoldingOffice を持つ Person を判定。
function hasActiveHoldingOffice(state: WorldState, personId: PersonId): boolean {
  const ids = state.holdingOfficeIndex.byHolderPerson[personId] ?? []
  for (const id of ids) {
    const a = state.holdingOfficeAssignments[id]
    if (a && a.active) return true
  }
  return false
}

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
      if (m.age < config.adultAge) continue
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
    sameHouseEffective
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
    compatibilityPenalty
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
  def: { displayName: string; maxHolders: number },
): TickContext {
  const config = ctx.config
  const polityRef: OrganizationRef = { kind: 'polity', id: polity.id }

  // 1. revoke dead holders
  let currentCtx = ctx
  const currentHolders = getActiveOfficeHolders(currentCtx.state, polityRef, role)
  for (const holderId of currentHolders) {
    const holder = currentCtx.state.persons[holderId]
    if (!holder || !holder.alive) {
      currentCtx = { ...currentCtx, state: revokeOfficesByHolder(currentCtx.state, holderId) }
    }
  }

  const activeHolders = getActiveOfficeHolders(currentCtx.state, polityRef, role)
  if (activeHolders.length >= def.maxHolders) return currentCtx
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
    scored.sort((a, b) => b.score - a.score)
    if (scored[0] && scored[0].score >= config.minAppointmentScore) {
      best = scored[0]
    }
  }

  // 3. traditional fallback
  if (!best) {
    const candidates = collectPolityCandidatesTraditional(
      currentCtx.state,
      config,
      polity,
      alreadyHolding,
    )
    const scored = candidates.map((id) => ({
      id,
      score: computePolityScoreV017(currentCtx.state, config, polity, rulerId, id, role),
    }))
    scored.sort((a, b) => b.score - a.score)
    if (scored[0] && scored[0].score >= config.minAppointmentScore) {
      best = scored[0]
    }
  }

  if (!best) return currentCtx

  const newState = createOfficeAssignment(currentCtx.state, polityRef, role, best.id)
  currentCtx = { ...currentCtx, state: newState }

  const person = currentCtx.state.persons[best.id]
  if (person) {
    const house = currentCtx.state.houses[person.houseId]
    if (house) {
      const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
      const event: SimEvent = {
        id: eventId,
        year: currentCtx.state.currentYear,
        weekOfYear: currentCtx.state.currentWeekOfYear,
        type: 'OFFICE_ASSIGNED',
        importance: 'normal',
        actorIds: [best.id],
        houseIds: [person.houseId],
        polityIds: [polity.id],
        provinceIds: [],
        holdingIds: [],
        summary: `${person.name} was appointed as ${def.displayName} of ${polity.name}.`,
        reasons: [],
        effects: [],
      }
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
  def: { displayName: string; maxHolders: number },
): TickContext {
  const config = ctx.config
  const houseRef: OrganizationRef = { kind: 'house', id: house.id }

  // 1. revoke dead holders
  let currentCtx = ctx
  const currentHolders = getActiveOfficeHolders(currentCtx.state, houseRef, role)
  for (const holderId of currentHolders) {
    const holder = currentCtx.state.persons[holderId]
    if (!holder || !holder.alive) {
      currentCtx = { ...currentCtx, state: revokeOfficesByHolder(currentCtx.state, holderId) }
    }
  }

  const activeHolders = getActiveOfficeHolders(currentCtx.state, houseRef, role)
  if (activeHolders.length >= def.maxHolders) return currentCtx
  const alreadyHolding = new Set(activeHolders.map((id) => id as string))

  let best: { id: PersonId; score: number } | undefined

  // 2. factional path
  if (hasRelevantFactionForAppointment(currentCtx.state, config, houseRef, role)) {
    const factional = collectFactionalCandidates(currentCtx.state, config, houseRef, role).filter(
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
    scored.sort((a, b) => b.score - a.score)
    if (scored[0] && scored[0].score >= config.minAppointmentScore) {
      best = scored[0]
    }
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
    scored.sort((a, b) => b.score - a.score)
    if (scored[0] && scored[0].score >= config.minAppointmentScore) {
      best = scored[0]
    }
  }

  if (!best) return currentCtx

  const newState = createOfficeAssignment(currentCtx.state, houseRef, role, best.id)
  currentCtx = { ...currentCtx, state: newState }

  const person = currentCtx.state.persons[best.id]
  if (person) {
    const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
    const event: SimEvent = {
      id: eventId,
      year: currentCtx.state.currentYear,
      weekOfYear: currentCtx.state.currentWeekOfYear,
      type: 'OFFICE_ASSIGNED',
      importance: 'normal',
      actorIds: [best.id],
      houseIds: [person.houseId],
      polityIds: [],
      provinceIds: [],
      holdingIds: [],
      summary: `${person.name} was appointed as ${def.displayName} of ${house.name}.`,
      reasons: [],
      effects: [],
    }
    currentCtx = { ...eventCtx, state: currentCtx.state, events: [...eventCtx.events, event] }
  }

  return currentCtx
}

export function runAppointmentSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  // Polity offices
  for (const polityId of Object.keys(currentCtx.state.polities).sort()) {
    const polity = currentCtx.state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue

    const rulerId = getPolityLeader(currentCtx.state, polityId as PolityId)
    if (!rulerId) continue

    for (const role of POLITY_APPOINTABLE_ROLES) {
      const def = OFFICE_DEFINITIONS[`polity:${role}`]
      if (!def) continue

      currentCtx = tryAppointPolityOffice(currentCtx, polity, rulerId, role, def)
    }
  }

  // House offices
  for (const houseId of Object.keys(currentCtx.state.houses).sort()) {
    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue

    const leaderId = getHouseLeader(currentCtx.state, houseId as HouseId)
    if (!leaderId) continue

    for (const role of HOUSE_APPOINTABLE_ROLES) {
      const def = OFFICE_DEFINITIONS[`house:${role}`]
      if (!def) continue

      currentCtx = tryAppointHouseOffice(currentCtx, house, leaderId, role, def)
    }
  }

  return currentCtx
}
