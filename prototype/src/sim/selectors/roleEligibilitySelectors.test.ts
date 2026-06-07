import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withHouse, withPerson, withHouseLeader } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { isRoleEligibleBySex } from './roleEligibilitySelectors'
import type { HouseId, PersonId, PolityId } from '../types/ids'

const HOUSE = 'h-1' as HouseId
const POLITY = 'c-1' as PolityId

function baseState() {
  let state = makeEmptyV016State()
  state = withHouse(state, HOUSE)
  return state
}

describe('isRoleEligibleBySex (v0.45.3 性別役職適格ゲート)', () => {
  it('男性は chance 0 でも常に適格', () => {
    let state = baseState()
    state = withPerson(state, 'p-m' as PersonId, { houseId: HOUSE, sex: 'male' })
    const config = { ...defaultConfig, femaleRoleEligibilityChance: 0 }
    expect(isRoleEligibleBySex(state, config, 'p-m' as PersonId)).toBe(true)
  })

  it('女性は chance 0 で常に不適格、chance 1 で常に適格', () => {
    let state = baseState()
    state = withPerson(state, 'p-f' as PersonId, { houseId: HOUSE, sex: 'female' })
    expect(
      isRoleEligibleBySex(
        state,
        { ...defaultConfig, femaleRoleEligibilityChance: 0 },
        'p-f' as PersonId,
      ),
    ).toBe(false)
    expect(
      isRoleEligibleBySex(
        state,
        { ...defaultConfig, femaleRoleEligibilityChance: 1 },
        'p-f' as PersonId,
      ),
    ).toBe(true)
  })

  it('現職の female house/polity leader でも免除されない (女当主・女王の例外は構造側: 継承 selector と CG leader fallback は本 gate を通らない)', () => {
    let state = baseState()
    state = withPerson(state, 'p-f' as PersonId, { houseId: HOUSE, sex: 'female' })
    state = withHouseLeader(state, HOUSE, 'p-f' as PersonId)
    state = withPerson(state, 'p-q' as PersonId, { houseId: HOUSE, sex: 'female' })
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: POLITY },
      'leader',
      'p-q' as PersonId,
    )
    const config = { ...defaultConfig, femaleRoleEligibilityChance: 0 }
    expect(isRoleEligibleBySex(state, config, 'p-f' as PersonId)).toBe(false)
    expect(isRoleEligibleBySex(state, config, 'p-q' as PersonId)).toBe(false)
  })

  it('決定論的: 同じ personId は同じ結果。chance 0.5 では適格・不適格が混在する', () => {
    let state = baseState()
    const ids: PersonId[] = []
    for (let i = 0; i < 100; i++) {
      const id = `p-f${i}` as PersonId
      state = withPerson(state, id, { houseId: HOUSE, sex: 'female' })
      ids.push(id)
    }
    const config = { ...defaultConfig, femaleRoleEligibilityChance: 0.5 }
    const first = ids.map((id) => isRoleEligibleBySex(state, config, id))
    const second = ids.map((id) => isRoleEligibleBySex(state, config, id))
    expect(second).toEqual(first)
    expect(first.some((v) => v)).toBe(true)
    expect(first.some((v) => !v)).toBe(true)
  })
})
