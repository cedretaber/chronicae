import type { WorldState } from '@sim/types/world'
import type { PersonId, HouseId } from '@sim/types/ids'
import {
  getHouseControlledProvinceIds,
  getHouseOwnedPolityIds,
} from '@sim/selectors/landContractSelectors'
import { getHousePolitySharePercent } from '@sim/selectors/shareSelectors'
import { getActiveFactionMembership } from '@sim/selectors/factionSelectors'

export function isHouselessPerson(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false
  return person.houseId === undefined && person.kind !== 'placeholder'
}

export function getHouselessPersons(state: WorldState): PersonId[] {
  const result: PersonId[] = []
  for (const person of Object.values(state.persons)) {
    if (!person) continue
    if (!person.alive) continue
    if (person.kind === 'placeholder') continue
    if (person.houseId !== undefined) continue
    result.push(person.id)
  }
  return result
}

export function isHouseLandless(state: WorldState, houseId: HouseId): boolean {
  const house = state.houses[houseId]
  if (!house || !house.active) return false
  return getHouseControlledProvinceIds(state, houseId).length === 0
}

export function isLandlessHouseMember(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false
  if (!person.houseId) return false
  return isHouseLandless(state, person.houseId)
}

export function isRulingHouse(state: WorldState, houseId: HouseId): boolean {
  const house = state.houses[houseId]
  if (!house || !house.active) return false
  const polityIds = getHouseOwnedPolityIds(state, houseId)
  for (const pid of polityIds) {
    const polity = state.polities[pid]
    if (polity && polity.active) return true
  }
  return false
}

export function isNonRulingHouse(state: WorldState, houseId: HouseId): boolean {
  const house = state.houses[houseId]
  if (!house || !house.active) return false
  return !isRulingHouse(state, houseId)
}

export function getRulingHouseIds(state: WorldState): HouseId[] {
  const result: HouseId[] = []
  for (const house of Object.values(state.houses)) {
    if (!house || !house.active) continue
    if (isRulingHouse(state, house.id)) result.push(house.id)
  }
  return result
}

export function getNonRulingHouseIds(state: WorldState): HouseId[] {
  const result: HouseId[] = []
  for (const house of Object.values(state.houses)) {
    if (!house || !house.active) continue
    if (!isRulingHouse(state, house.id)) result.push(house.id)
  }
  return result
}

export function isInfluentialHouseInAnyPolity(
  state: WorldState,
  config: { influentialHousePolityShareThreshold: number },
  houseId: HouseId,
): boolean {
  const house = state.houses[houseId]
  if (!house || !house.active) return false
  const threshold = config.influentialHousePolityShareThreshold * 100
  for (const polity of Object.values(state.polities)) {
    if (!polity || !polity.active) continue
    if (polity.ownerHouseId === houseId) continue
    const sharePercent = getHousePolitySharePercent(state, polity.id, houseId)
    if (sharePercent >= threshold) return true
  }
  return false
}

export function isPoliticallyEngagedPerson(
  state: WorldState,
  config: { influentialHousePolityShareThreshold: number },
  personId: PersonId,
): boolean {
  const person = state.persons[personId]
  if (!person) return false

  if (person.houseId) {
    if (isRulingHouse(state, person.houseId)) return true
    if (isInfluentialHouseInAnyPolity(state, config, person.houseId)) return true
  }

  if (getActiveFactionMembership(state, personId) !== undefined) return true

  const officeIds = state.officeIndex.byHolderPerson[personId as string] ?? []
  for (const oid of officeIds) {
    const o = state.officeAssignments[oid]
    if (o && o.active) return true
  }

  const supervisedIds = state.projectIndex.bySupervisorPerson[`person:${personId}`] ?? []
  for (const pid of supervisedIds) {
    const project = state.projects[pid]
    if (project && project.status === 'active') return true
  }

  for (const play of Object.values(state.diplomaticPlays)) {
    if (!play) continue
    const status = play.status
    if (status !== 'active' && status !== 'escalated') continue
    if (play.initiatorDelegatePersonId === personId) return true
    if (play.targetDelegatePersonId === personId) return true
  }

  return false
}

export function isRecruitableOutsiderPerson(
  state: WorldState,
  config: { influentialHousePolityShareThreshold: number },
  personId: PersonId,
): boolean {
  const person = state.persons[personId]
  if (!person) return false
  if (!person.alive) return false
  if (person.kind === 'placeholder') return false
  return !isPoliticallyEngagedPerson(state, config, personId)
}
