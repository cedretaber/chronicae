import type { WorldState } from '@sim/types/world'
import type { PersonId, FactionId, FactionMembershipId, HouseId, PolityId } from '@sim/types/ids'
import type { Faction, FactionMembership } from '@sim/types/faction'
import type { Person, UnaffiliatedOccupation } from '@sim/types/person'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { OfficeRole, OrganizationRef } from '@sim/types/office'
import { getEffectiveOfficeMaxHolders, getHouseLeader } from '@sim/selectors/officeSelectors'
import {
  getPersonHouseSharePercent,
  getHousePolitySharePercent,
} from '@sim/selectors/shareSelectors'
import { getHousePolityIds } from '@sim/selectors/polityRelations'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import { getAttitudeOrDefault, attitudeValueToScore } from '@sim/helpers/attitudeHelpers'
import { getOfficeCompatibilityPenalty } from '@sim/selectors/officeSelectors'

export function getActiveFactions(state: WorldState): Faction[] {
  const result: Faction[] = []
  for (const id of Object.keys(state.factions).sort() as FactionId[]) {
    const f = state.factions[id]
    if (f && f.active) result.push(f)
  }
  return result
}

export function getFaction(state: WorldState, factionId: FactionId): Faction | undefined {
  return state.factions[factionId]
}

export function getFactionMembership(
  state: WorldState,
  membershipId: FactionMembershipId,
): FactionMembership | undefined {
  return state.factionMemberships[membershipId]
}

// Returns the active Faction this person currently leads, if any.
export function getFactionByLeader(state: WorldState, personId: PersonId): Faction | undefined {
  const factionIds = state.factionIndex.byLeader[personId]
  if (!factionIds) return undefined
  for (const fid of factionIds) {
    const f = state.factions[fid]
    if (f && f.active && f.leaderPersonId === personId) return f
  }
  return undefined
}

// Returns the active FactionMembership this person currently holds, if any.
// Per spec §4.4 invariant: a Person has at most 1 active membership.
export function getActiveFactionMembership(
  state: WorldState,
  personId: PersonId,
): FactionMembership | undefined {
  const ids = state.factionIndex.byMember[personId]
  if (!ids) return undefined
  for (const mid of ids) {
    const m = state.factionMemberships[mid]
    if (m && m.active) return m
  }
  return undefined
}

// Returns all PersonIds in active membership of the given faction.
export function getFactionActiveMemberIds(state: WorldState, factionId: FactionId): PersonId[] {
  const result: PersonId[] = []
  for (const m of Object.values(state.factionMemberships)) {
    if (!m) continue
    if (m.factionId !== factionId) continue
    if (!m.active) continue
    result.push(m.personId)
  }
  return result.sort()
}

// v0.17 §13.3: Total opportunity score for a person to found a faction.
// Leader role is excluded from office slots.
const NON_LEADER_OFFICE_ROLES: ReadonlyArray<Exclude<OfficeRole, 'leader'>> = [
  'administrator',
  'treasurer',
  'military',
  'advisor',
]

export function getFactionOpportunityScore(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): number {
  const person = state.persons[personId]
  if (!person || !person.alive) return 0
  if (person.kind === 'placeholder') return 0

  const house = state.houses[person.houseId]
  if (!house || !house.active) return 0

  const personHouseShare = getPersonHouseSharePercent(state, house.id, personId) / 100

  let houseOfficeSlots = 0
  for (const role of NON_LEADER_OFFICE_ROLES) {
    const slots = getEffectiveOfficeMaxHolders(state, config, { kind: 'house', id: house.id }, role)
    houseOfficeSlots += slots * config.officeOpportunityRoleWeights[role]
  }

  let polityOfficeSlots = 0
  for (const polityId of getHousePolityIds(state, house.id)) {
    const housePolityShare = getHousePolitySharePercent(state, polityId, house.id) / 100
    for (const role of NON_LEADER_OFFICE_ROLES) {
      const slots = getEffectiveOfficeMaxHolders(
        state,
        config,
        { kind: 'polity', id: polityId },
        role,
      )
      polityOfficeSlots += slots * housePolityShare * config.officeOpportunityRoleWeights[role]
    }
  }

  return personHouseShare * (houseOfficeSlots + polityOfficeSlots)
}

// v0.17 §13.6: Faction viability score — whether the faction has a reason to survive.
export function getFactionViabilityScore(
  state: WorldState,
  config: SimulationConfig,
  factionId: FactionId,
): number {
  const faction = state.factions[factionId]
  if (!faction || !faction.active) return 0

  const leaderOppScore = getFactionOpportunityScore(state, config, faction.leaderPersonId)

  const memberIds = getFactionActiveMemberIds(state, factionId)
  let officeHolderCount = 0
  for (const mid of memberIds) {
    const officeIds = state.officeIndex.byHolderPerson[mid] ?? []
    let hasActive = false
    for (const oid of officeIds) {
      const o = state.officeAssignments[oid]
      if (o && o.active) {
        hasActive = true
        break
      }
    }
    if (hasActive) officeHolderCount++
  }
  const activeMemberCount = memberIds.length

  const leader = state.persons[faction.leaderPersonId]
  const leaderWealthFactor = leader
    ? Math.min(leader.wealth / Math.max(1, config.factionLeaderReserveWealth), 3)
    : 0

  return (
    leaderOppScore * 1.0 +
    activeMemberCount * config.factionViabilityMemberCountWeight +
    officeHolderCount * config.factionViabilityOfficeHolderWeight +
    leaderWealthFactor * config.factionViabilityWealthWeight
  )
}

// Best role-score across the 5 derived roles. Used by recruitment ranking.
export function getBestRoleScore(state: WorldState, personId: PersonId): number {
  const roles = ['governance', 'stewardship', 'diplomacy', 'intrigue', 'warCommand'] as const
  let best = 0
  for (const r of roles) {
    const s = getRoleScore(state, personId, r)
    if (s > best) best = s
  }
  return best
}

// v0.17 §12.4: occupation × role fit. Stage B では candidate.occupation の汎用適性のみ
// 評価する (faction の不足 role 個別解析は Stage C 以降)。
const OCCUPATION_FIT_BONUS: Record<UnaffiliatedOccupation, number> = {
  adventurer: 4,
  mercenary: 4,
  scholar: 5,
  scribe: 4,
  priest: 3,
  physician: 2,
  jurist: 4,
  merchant: 4,
  wanderer: 2,
}

export function getOccupationRoleFitBonus(candidate: Person): number {
  const occupation = candidate.occupation
  if (!occupation) return 0
  return OCCUPATION_FIT_BONUS[occupation]
}

// ---------------------------------------------------------------------------
// v0.17 §14.1: Appointment-related faction selectors
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

// v0.17 §14.1: getFactionNominationPower returns 0..1.
// Sum various contributions then clamp to [0, 1].
export function getFactionNominationPower(
  state: WorldState,
  config: SimulationConfig,
  factionId: FactionId,
  org: OrganizationRef,
  role: OfficeRole,
): number {
  void role
  const faction = state.factions[factionId]
  if (!faction || !faction.active) return 0
  if (org.kind === 'polity') {
    return getFactionNominationPowerForPolity(state, config, faction, org.id)
  }
  return getFactionNominationPowerForHouse(state, faction, org.id)
}

function getFactionNominationPowerForPolity(
  state: WorldState,
  config: SimulationConfig,
  faction: Faction,
  polityId: PolityId,
): number {
  const memberIds = getFactionActiveMemberIds(state, faction.id)
  const leader = state.persons[faction.leaderPersonId]
  const leaderHouseId = leader?.houseId

  // House-level Share: dedupe by house, leader-house weights x1.0, others x0.5
  const seenHouses = new Set<string>()
  let power = 0
  for (const mid of memberIds) {
    const m = state.persons[mid]
    if (!m) continue
    const hid = m.houseId
    if (seenHouses.has(hid)) continue
    seenHouses.add(hid)
    const sharePct = getHousePolitySharePercent(state, polityId, m.houseId) / 100
    const weight = m.houseId === leaderHouseId ? 1.0 : 0.5
    power += sharePct * weight
  }

  // Existing Polity office holdings (members in this polity)
  for (const mid of memberIds) {
    const ids = state.officeIndex.byHolderPerson[mid] ?? []
    for (const oid of ids) {
      const o = state.officeAssignments[oid]
      if (o && o.active && o.organization.kind === 'polity' && o.organization.id === polityId) {
        power += 0.2
      }
    }
  }

  // ownerHouse bonus (skip commonwealth)
  const polity = state.polities[polityId]
  if (polity && polity.ownerHouseId !== undefined && leaderHouseId === polity.ownerHouseId) {
    power += config.factionOwnerHouseNominationBonus
  }

  return clamp01(power)
}

function getFactionNominationPowerForHouse(
  state: WorldState,
  faction: Faction,
  houseId: HouseId,
): number {
  const memberIds = getFactionActiveMemberIds(state, faction.id)
  let power = 0

  // Member personal Shares within this house (no leader-house dedupe at house-level)
  for (const mid of memberIds) {
    const m = state.persons[mid]
    if (!m) continue
    if (m.houseId !== houseId) continue
    const psPct = getPersonHouseSharePercent(state, houseId, mid) / 100
    power += psPct * 0.5
  }

  // Members holding active offices in this house
  for (const mid of memberIds) {
    const ids = state.officeIndex.byHolderPerson[mid] ?? []
    for (const oid of ids) {
      const o = state.officeAssignments[oid]
      if (o && o.active && o.organization.kind === 'house' && o.organization.id === houseId) {
        power += 0.2
      }
    }
  }

  // Leader influence on their own House
  const leader = state.persons[faction.leaderPersonId]
  if (leader && leader.houseId === houseId) {
    const houseLeader = getHouseLeader(state, houseId)
    if (houseLeader && houseLeader === leader.id) {
      power += 0.5
    } else {
      power += 0.2
    }
  }

  return clamp01(power)
}

// v0.17 §14.1: hasRelevantFactionForAppointment
export function hasRelevantFactionForAppointment(
  state: WorldState,
  config: SimulationConfig,
  org: OrganizationRef,
  role: OfficeRole,
): boolean {
  for (const faction of getActiveFactions(state)) {
    const np = getFactionNominationPower(state, config, faction.id, org, role)
    if (np >= config.factionNominationPowerThreshold) return true
  }
  return false
}

// v0.17 §14.3: getFactionRecommendationScore
function mapOfficeRoleToApplied(
  role: OfficeRole,
): 'governance' | 'stewardship' | 'warCommand' | 'diplomacy' | undefined {
  switch (role) {
    case 'leader':
      return 'governance'
    case 'administrator':
      return 'governance'
    case 'treasurer':
      return 'stewardship'
    case 'military':
      return 'warCommand'
    case 'advisor':
      return 'diplomacy'
  }
}

export function getFactionRecommendationScore(
  state: WorldState,
  factionId: FactionId,
  candidateId: PersonId,
  _targetOrg: OrganizationRef,
  targetRole: OfficeRole,
): number {
  const faction = state.factions[factionId]
  if (!faction || !faction.active) return 0
  const leader = state.persons[faction.leaderPersonId]
  const candidate = state.persons[candidateId]
  if (!leader || !candidate) return 0

  const lToC = getAttitudeOrDefault(state, leader, { kind: 'person', id: candidateId })
  const cToL = getAttitudeOrDefault(state, candidate, {
    kind: 'person',
    id: faction.leaderPersonId,
  })

  const appliedKey = mapOfficeRoleToApplied(targetRole)
  const suitability = appliedKey ? getRoleScore(state, candidateId, appliedKey) : 0

  const components = [
    attitudeValueToScore(lToC.affection) * 0.3,
    attitudeValueToScore(lToC.respect) * 0.25,
    attitudeValueToScore(cToL.affection) * 0.15,
    attitudeValueToScore(cToL.respect) * 0.1,
    suitability * 0.2,
  ]
  const raw = components.reduce((a, b) => a + b, 0)
  return clamp01(raw / 100)
}

// v0.17 §14.1: getFactionalCandidateScore
export function getFactionalCandidateScore(
  state: WorldState,
  config: SimulationConfig,
  factionId: FactionId,
  candidateId: PersonId,
  org: OrganizationRef,
  role: OfficeRole,
): number {
  const nominationPower = getFactionNominationPower(state, config, factionId, org, role)
  const recommendation = getFactionRecommendationScore(state, factionId, candidateId, org, role)
  const candidate = state.persons[candidateId]
  const appliedKey = mapOfficeRoleToApplied(role)
  const smallAbility = appliedKey ? getRoleScore(state, candidateId, appliedKey) * 0.05 : 0
  const smallPrestige = ((candidate?.legacyPrestige ?? 0) / 100) * 0.05
  const compatibilityPenalty = getOfficeCompatibilityPenalty(state, config, candidateId, org, role)

  return (
    nominationPower * recommendation * config.factionalAppointmentScoreScale +
    smallAbility +
    smallPrestige -
    compatibilityPenalty
  )
}
