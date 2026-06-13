import type { WorldState } from '@sim/types/world'
import type { PersonId, FactionId, FactionMembershipId, HouseId, PolityId } from '@sim/types/ids'
import type { Faction, FactionMembership } from '@sim/types/faction'
import type { Person, PersonBackgroundOccupation } from '@sim/types/person'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { OfficeRole, OrganizationRef } from '@sim/types/office'
import { getEffectiveOfficeMaxHolders } from '@sim/selectors/officeSelectors'
import { getPersonHouseSharePercent, getTopShareholders } from '@sim/selectors/shareSelectors'
import {
  getPolityInfluenceBreakdown,
  getActorInfluenceFromBreakdown,
} from '@sim/selectors/influenceSelectors'
import { getHousePolityIds } from '@sim/selectors/polityRelations'
import { getRightsByHolder } from '@sim/selectors/politicalRightSelectors'
import type { PoliticalRightHolderRef } from '@sim/types/politicalRight'
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

export function computeAvailableOfficeSlots(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
): number {
  // v0.42 §12.5: House office slot は opportunity から除外する。Faction は House office に
  // 介入できなくなった (house factional path 廃止) ため、使えない機会で Faction が
  // 肥大化するのを防ぐ。polity slot の share% 参照は influence% (ratio) に置換。
  let polityOfficeSlots = 0
  for (const polityId of getHousePolityIds(state, houseId)) {
    const breakdown = getPolityInfluenceBreakdown(state, config, polityId)
    const influenceRatio =
      getActorInfluenceFromBreakdown(breakdown, { kind: 'house', id: houseId }).percent / 100
    for (const role of NON_LEADER_OFFICE_ROLES) {
      const slots = getEffectiveOfficeMaxHolders(
        state,
        config,
        { kind: 'polity', id: polityId },
        role,
      )
      polityOfficeSlots += slots * influenceRatio * config.officeOpportunityRoleWeights[role]
    }
  }

  return polityOfficeSlots
}

export function getFactionOpportunityScore(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): number {
  const person = state.persons[personId]
  if (!person || !person.alive) return 0
  if (person.kind === 'placeholder') return 0

  if (!person.houseId) return 0
  const house = state.houses[person.houseId]
  if (!house || !house.active) return 0

  const personHouseShare = getPersonHouseSharePercent(state, house.id, personId) / 100
  const officeSlots = computeAvailableOfficeSlots(state, config, house.id)

  return personHouseShare * officeSlots
}

// 派閥拡大 WI-1: cap を「patron が配れる席数 + leader 才能」連動に再設計する (設計 §10.2)。
// 旧: max(minCap, floor(officeSlots)) は floor マスクで事実上の定数 2 になり集積力が死んでいた。
// 新: cap = clamp(minCap + floor(officeSlots) + appointmentSeats + meritSeats, minCap, hardCap)。
//   - appointmentSeats = leader 個人 ∪ leader 家が保有する office 任命権 (holding/polity) の席数 (§8.1)。
//     regiment_control は人材庇護と無関係なので除外する。
//   - meritSeats = leader の best role-score が floor を超えた分を divisor で席化 (才能ある patron は多く抱える)。
export function getFactionMemberCap(
  state: WorldState,
  config: SimulationConfig,
  factionId: FactionId,
): number {
  const faction = state.factions[factionId]
  if (!faction || !faction.active) return config.minimumFactionMembers

  const leader = state.persons[faction.leaderPersonId]
  if (!leader || !leader.houseId) return config.minimumFactionMembers

  const officeSlots = computeAvailableOfficeSlots(state, config, leader.houseId)
  const appointmentSeats = countLeaderAppointmentSeats(state, leader.id, leader.houseId)
  const bestRole = getBestRoleScore(state, leader.id)
  const meritSeats = Math.floor(
    Math.max(0, bestRole - config.factionCapMeritFloor) / config.factionCapMeritDivisor,
  )

  const raw = config.minimumFactionMembers + Math.floor(officeSlots) + appointmentSeats + meritSeats
  return Math.min(config.factionHardCap, Math.max(config.minimumFactionMembers, raw))
}

// leader が patron として配れる「席」= 個人 right + 家 right のうち office 任命権 (holding/polity) の数。
function countLeaderAppointmentSeats(
  state: WorldState,
  leaderId: PersonId,
  leaderHouseId: HouseId,
): number {
  let seats = 0
  const holders: PoliticalRightHolderRef[] = [
    { kind: 'person', id: leaderId },
    { kind: 'house', id: leaderHouseId },
  ]
  for (const holder of holders) {
    for (const right of getRightsByHolder(state, holder)) {
      const k = right.target.kind
      if (k === 'polity_office_role' || k === 'holding_office_role') seats++
    }
  }
  return seats
}

// Faction viability score — whether the faction has a reason to survive.
// Leader must remain in top (factionFounderShareRank + 2) shareholders to contribute share viability.
export function getFactionViabilityScore(
  state: WorldState,
  config: SimulationConfig,
  factionId: FactionId,
): number {
  const faction = state.factions[factionId]
  if (!faction || !faction.active) return 0

  const leader = state.persons[faction.leaderPersonId]
  let leaderShareViability = 0
  if (leader && leader.houseId) {
    const viabilityRankLimit = config.factionFounderShareRank + 2
    const topHolders = getTopShareholders(state, leader.houseId, viabilityRankLimit)
    const isTopHolder = topHolders.some(
      (s) => (s.holderPersonId as string) === (leader.id as string),
    )
    if (isTopHolder) {
      const sharePercent = getPersonHouseSharePercent(state, leader.houseId, leader.id)
      leaderShareViability = sharePercent * 0.05
    }
  }

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

  const leaderWealthFactor = leader
    ? Math.min(leader.wealth / Math.max(1, config.factionLeaderReserveWealth), 3)
    : 0

  return (
    leaderShareViability +
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
const OCCUPATION_FIT_BONUS: Record<PersonBackgroundOccupation, number> = {
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
  return OCCUPATION_FIT_BONUS[occupation] ?? 0
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
    // v0.42 §12.4: Faction が任命に介入できるのは anchor Polity のみ (越境介入の廃止)。
    // bailiff factional tier (terminal polity 経由) もここで anchor 限定される (§10.2)。
    if (org.id !== faction.polityId) return 0
    return getFactionNominationPowerForPolity(state, config, faction, org.id)
  }
  // v0.42 §12.5: House office への factional path は廃止 (house 向け NP は常に 0)。
  return 0
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

  // v0.42 §19.2-5: House-level influence (旧 share)。dedupe by house,
  // leader-house weights x1.0, others x0.5。breakdown は 1 回だけ計算する (§21.2)。
  const breakdown = getPolityInfluenceBreakdown(state, config, polityId)
  const seenHouses = new Set<string>()
  let power = 0
  for (const mid of memberIds) {
    const m = state.persons[mid]
    if (!m || !m.houseId) continue
    const hid = m.houseId
    if (seenHouses.has(hid)) continue
    seenHouses.add(hid)
    const influenceRatio =
      getActorInfluenceFromBreakdown(breakdown, { kind: 'house', id: m.houseId }).percent / 100
    const weight = m.houseId === leaderHouseId ? 1.0 : 0.5
    power += influenceRatio * weight
  }

  // 影響力個人中心化 Phase 2b: メンバー「個人」の influence% も推進力に算入する。
  // 役職 influence が個人帰属になった分 (Phase 2b) と評判 (Phase 1a) をここで回収し、
  // 「有能で評判の高い個人が集まった派閥が強い」=個人 agency が faction nomination に貫通する。
  // landless でも評判→個人influence→推進力→任用、の coldstart 経路が成立する (R15 解消)。
  // person entry は houseless でも個別に立つため dedupe 不要 (家とは別母集合)。
  for (const mid of memberIds) {
    const m = state.persons[mid]
    if (!m) continue
    const personRatio =
      getActorInfluenceFromBreakdown(breakdown, { kind: 'person', id: mid }).percent / 100
    if (personRatio <= 0) continue
    const weight = m.houseId === leaderHouseId ? 1.0 : 0.5
    power += personRatio * weight
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
