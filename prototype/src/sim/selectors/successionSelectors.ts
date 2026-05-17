import type { Person } from '../types/person'
import type { House } from '../types/house'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { getHouseLeader } from './officeSelectors'
import { getRoleScore } from './abilitySelectors'

export type SuccessionCandidate = {
  person: Person
  score: number
}

export function needsSuccession(state: WorldState, house: House): boolean {
  return house.active === true && getHouseLeader(state, house.id) === undefined
}

export function getAdultSuccessionCandidates(
  state: WorldState,
  house: House,
  config: SimulationConfig,
): SuccessionCandidate[] {
  const members = house.memberIds
    .map((id) => state.persons[id])
    .filter((p): p is Person => p !== undefined && p.alive && p.age >= config.adultAge)

  const adultMales = members.filter((p) => p.sex === 'male')
  let candidates: Person[]
  if (adultMales.length > 0) {
    candidates = adultMales
  } else if (config.allowFemaleHouseHeadWhenNoMaleHeir) {
    candidates = members
  } else {
    return []
  }

  // Find the dead/gone leader via any means — since headId is gone,
  // look for a dead member of the house who was likely the leader
  const deadHead =
    house.memberIds
      .map((id) => state.persons[id])
      .find((p): p is Person => p !== undefined && !p.alive) ?? undefined

  if (!deadHead) {
    return candidates.map((person) => ({
      person,
      score: calcSuccessionScore(person, undefined, state, config),
    }))
  }

  const result: SuccessionCandidate[] = candidates.map((person) => ({
    person,
    score: calcSuccessionScore(person, deadHead, state, config),
  }))

  result.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.person.id < b.person.id ? -1 : a.person.id > b.person.id ? 1 : 0
  })

  return result
}

export function getMinorSuccessionCandidates(
  state: WorldState,
  house: House,
  config: SimulationConfig,
): Person[] {
  const candidates = house.memberIds
    .map((id) => state.persons[id])
    .filter((p): p is Person => p !== undefined && p.alive && p.age < config.adultAge)

  candidates.sort((a, b) => {
    if (b.age !== a.age) return b.age - a.age
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return candidates
}

export function getBloodScore(candidate: Person, deadHead: Person, state: WorldState): number {
  // 1. Child of dead head
  if (deadHead.childIds.some((cid) => (cid as string) === (candidate.id as string))) {
    return 100
  }

  // 2. Grandchild (dead head's child's child)
  for (const childId of deadHead.childIds) {
    const child = state.persons[childId]
    if (child && child.childIds.some((cid) => (cid as string) === (candidate.id as string))) {
      return 85
    }
  }

  // 3. Sibling via father or mother
  if (candidate.fatherId !== undefined && candidate.fatherId === deadHead.fatherId) {
    return 75
  }
  if (candidate.motherId !== undefined && candidate.motherId === deadHead.motherId) {
    return 75
  }

  // 4. Uncle/nephew: candidate's parent is a sibling of dead head (shares a grandparent)
  const candidateParentIds = [candidate.fatherId, candidate.motherId].filter(
    (id): id is typeof candidate.fatherId & {} => id !== undefined,
  )
  for (const parentId of candidateParentIds) {
    const parent = state.persons[parentId]
    if (!parent) continue
    if (
      parent.fatherId !== undefined &&
      deadHead.fatherId !== undefined &&
      parent.fatherId === deadHead.fatherId
    ) {
      return 60
    }
    if (
      parent.motherId !== undefined &&
      deadHead.motherId !== undefined &&
      parent.motherId === deadHead.motherId
    ) {
      return 60
    }
  }

  // 5. Same house, no closer relation
  return 20
}

export function calcSuccessionScore(
  candidate: Person,
  deadHead: Person | undefined,
  state: WorldState,
  config: SimulationConfig,
): number {
  const blood = deadHead ? getBloodScore(candidate, deadHead, state) : 50 // Default mid-range blood score when deadHead is unknown
  const birthPenalty =
    candidate.birthStatus === 'illegitimate'
      ? config.illegitimateSuccessionPenalty
      : candidate.birthStatus === 'unknown'
        ? config.unknownBirthStatusSuccessionPenalty
        : 0

  return (
    blood +
    candidate.legacyPrestige * config.prestigeSuccessionWeight +
    (getRoleScore(state, candidate.id, 'governance') / 10) * config.adminSuccessionWeight +
    (getRoleScore(state, candidate.id, 'warCommand') / 10) * config.martialSuccessionWeight +
    candidate.traits.ambition * config.ambitionSuccessionWeight -
    birthPenalty
  )
}

export function chooseSuccessor(candidates: SuccessionCandidate[]): SuccessionCandidate {
  if (candidates.length === 0) {
    throw new Error('chooseSuccessor: no candidates')
  }
  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.person.id < b.person.id ? -1 : a.person.id > b.person.id ? 1 : 0
  })
  const first = sorted[0]
  if (!first) throw new Error('chooseSuccessor: no candidates')
  return first
}
