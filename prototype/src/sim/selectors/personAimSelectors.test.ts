import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createGoalId,
} from '../types/ids'
import type { PersonId, HouseId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { Goal } from '../types/goal'
import { defaultConfig } from '../config/defaultConfig'
import {
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
  bindProvinceToPolity,
} from '../testFixtures'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { createPoliticalRight } from '../mutations/politicalRightMutations'
import { scorePersonAimKind } from './personAimSelectors'

// personal_advancement goal (obtain_office を強く志向)。
function personalAdvancementGoal(personId: PersonId): Goal {
  return {
    id: createGoalId(0),
    owner: { kind: 'person', id: personId },
    kind: 'personal_advancement',
    priority: 1,
    progress: 0,
    targetProgress: 100,
    createdWeek: 0,
    minimumUntilWeek: 144,
    lastReviewWeek: 0,
    nextReviewWeek: 48,
    status: 'active',
    reasonIds: [],
  }
}

// 本人が自家の非 leader office 4 つを全て握る (obtain_office の house 分岐を枯らし polity
// 分岐に到達させる)。これで初めて共和国 foothold が target 候補になる。
function seatAllHouseOffices(state: WorldState, houseId: HouseId, personId: PersonId): WorldState {
  let s = state
  for (const role of ['administrator', 'treasurer', 'military', 'advisor'] as const) {
    s = createOfficeAssignment(s, { kind: 'house', id: houseId }, role, personId)
  }
  return s
}

describe('scorePersonAimKind obtain_office — commonwealth 共和国の foothold target (v0.46)', () => {
  it('共和国に foothold を持つ housed person の obtain_office が共和国 office を target にする', () => {
    const polityId = createPolityId('c', 1)
    const provinceId = createProvinceId('p', 1)
    const houseId = createHouseId('h', 1)
    const personId = createPersonId('pe', 1)

    let state = makeEmptyV016State()
    state = withProvince(state, provinceId, {})
    state = withPolity(state, polityId, {
      kind: 'commonwealth',
      capitalProvinceId: provinceId,
      revoltState: { kind: 'established' },
    })
    state = bindProvinceToPolity(state, provinceId, polityId)
    state = withHouse(state, houseId, {}) // 土地なし (getHousePolityIds は空)
    state = withPerson(state, personId, { houseId })
    state = seatAllHouseOffices(state, houseId, personId)

    // 共和国 C に personal right (foothold)。
    const rightResult = createPoliticalRight(state, {
      polityId,
      holder: { kind: 'person', id: personId },
      target: { kind: 'polity_office_role', polityId, role: 'administrator', slotIndex: 0 },
      grantedWeek: 0,
    })
    expect(rightResult.ok).toBe(true)
    if (!rightResult.ok) return
    state = rightResult.value.state

    const results = scorePersonAimKind(
      state,
      defaultConfig,
      personId,
      personalAdvancementGoal(personId),
    )
    const obtain = results.find((r) => r.kind === 'obtain_office')
    expect(obtain).toBeDefined()
    expect(obtain?.target?.kind).toBe('office')
    if (obtain?.target?.kind === 'office') {
      expect(obtain.target.organization).toEqual({ kind: 'polity', id: polityId })
    }
  })

  it('foothold が無ければ共和国は target にならない (normal polity 経路は不変)', () => {
    // 家が normal polity N を所有。共和国 foothold なし → target は N のまま。
    const normalPolityId = createPolityId('c', 2)
    const provinceId = createProvinceId('p', 2)
    const houseId = createHouseId('h', 2)
    const personId = createPersonId('pe', 2)

    let state = makeEmptyV016State()
    state = withProvince(state, provinceId, {})
    state = withPolity(state, normalPolityId, {
      kind: 'normal',
      ownerHouseId: houseId,
      capitalProvinceId: provinceId,
    })
    state = withHouse(state, houseId, {})
    state = withPerson(state, personId, { houseId })
    state = bindProvinceToPolity(state, provinceId, normalPolityId)
    state = seatAllHouseOffices(state, houseId, personId)

    const results = scorePersonAimKind(
      state,
      defaultConfig,
      personId,
      personalAdvancementGoal(personId),
    )
    const obtain = results.find((r) => r.kind === 'obtain_office')
    // normal polity の office を target にする (従来挙動)。
    expect(obtain).toBeDefined()
    if (obtain?.target?.kind === 'office') {
      expect(obtain.target.organization).toEqual({ kind: 'polity', id: normalPolityId })
    }
  })
})
