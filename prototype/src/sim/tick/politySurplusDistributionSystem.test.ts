// v0.42 §14 PolitySurplusDistribution の Influence 比例化テスト (spec §20.1)。
// - Influence 比例で House wealth が増えること
// - commonwealth (House entry なし・leader Person entry のみ) では surplus が treasury に残ること

import { describe, expect, it } from 'vitest'
import { createPersonId, createHouseId, createPolityId, createProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runPolitySurplusDistributionSystem } from './politySurplusDistributionSystem'
import { createOfficeAssignment } from '../mutations/officeMutations'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'

const polityId = createPolityId('dp', 0)
const houseId = createHouseId('dh', 0)
const leaderId = createPersonId('pe', 0)
const provinceId = createProvinceId('p', 0)

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextPolityIndex: 10,
  }
}

describe('runPolitySurplusDistributionSystem (v0.42 Influence 比例)', () => {
  it('distributes surplus to house entries proportional to influence percent', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, provinceId)
    state = withHouse(state, houseId, { seatProvinceId: provinceId, wealth: 0 })
    state = withPerson(state, leaderId, { houseId })
    state = withPolity(state, polityId, {
      ownerHouseId: houseId,
      treasury: 10000,
      capitalProvinceId: provinceId,
    })
    state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)

    const result = runPolitySurplusDistributionSystem(makeCtx(state))
    const houseAfter = result.state.houses[houseId]!
    const polityAfter = result.state.polities[polityId]!
    // 唯一の House entry (influence 100%) に distributable 全額が渡る
    expect(houseAfter.wealth).toBeGreaterThan(0)
    expect(polityAfter.treasury).toBeLessThan(10000)
    expect(houseAfter.wealth + polityAfter.treasury).toBeCloseTo(10000, 6)
  })

  it('keeps surplus in the treasury for a commonwealth with no house entries (§14.2)', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, provinceId)
    // houseless leader しかいない commonwealth: House entry が存在しない
    state = withPolity(state, polityId, {
      treasury: 10000,
      capitalProvinceId: provinceId,
      kind: 'commonwealth',
    })
    state = {
      ...state,
      persons: {
        ...state.persons,
        [leaderId]: {
          id: leaderId,
          nameKey: 'Leader',
          sex: 'male' as const,
          age: 30,
          lifeStage: 'mature_adulthood' as const,
          alive: true,
          childIds: [],
          birthStatus: 'unknown' as const,
          abilities: {
            valor: 50,
            command: 50,
            numeracy: 50,
            learning: 50,
            charisma: 50,
            insight: 50,
          },
          aptitudes: {
            valor: 50,
            command: 50,
            numeracy: 50,
            learning: 50,
            charisma: 50,
            insight: 50,
          },
          traits: { ambition: 0.5, caution: 0.5 },
          legacyPrestige: 0,
          wealth: 0,
          attitudes: {},
        },
      },
      livingPersonIds: [...state.livingPersonIds, leaderId].sort(),
    }
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', leaderId)

    const result = runPolitySurplusDistributionSystem(makeCtx(state))
    // Person entry (leader) には分配せず treasury 残留
    expect(result.state.polities[polityId]!.treasury).toBe(10000)
    expect(result.state.persons[leaderId]!.wealth).toBe(0)
  })
})
