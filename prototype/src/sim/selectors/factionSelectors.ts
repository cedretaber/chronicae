import type { WorldState } from '@sim/types/world'
import type { PersonId, FactionId, FactionMembershipId } from '@sim/types/ids'
import type { Faction, FactionMembership } from '@sim/types/faction'
import type { Person, UnaffiliatedOccupation } from '@sim/types/person'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { OfficeRole } from '@sim/types/office'
import { getEffectiveOfficeMaxHolders } from '@sim/selectors/officeSelectors'
import {
  getPersonHouseSharePercent,
  getHousePolitySharePercent,
} from '@sim/selectors/shareSelectors'
import { getHousePolityIds } from '@sim/selectors/polityRelations'
import { getRoleScore } from '@sim/selectors/abilitySelectors'

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
