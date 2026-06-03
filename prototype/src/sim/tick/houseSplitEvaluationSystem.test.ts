import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import type { PersonId, HouseId, PolityId, ProvinceId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import { runHouseSplitEvaluationSystem } from './houseSplitEvaluationSystem'
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPolity,
  withProvince,
} from '../testFixtures'
import { createOfficeAssignment } from '../mutations/officeMutations'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makePerson(
  id: PersonId,
  nameKey: string,
  age: number,
  houseId: HouseId,
  overrides?: { ambition?: number; legacyPrestige?: number; alive?: boolean },
): Person {
  return {
    id,
    nameKey,
    sex: 'male',
    age,
    lifeStage: 'young_adulthood',
    alive: overrides?.alive ?? true,
    houseId,
    childIds: [],
    birthStatus: 'legitimate',
    abilities: DEFAULT_ABILITIES,
    aptitudes: DEFAULT_ABILITIES,
    traits: { ambition: overrides?.ambition ?? 0.5, caution: 0.5 },
    legacyPrestige: overrides?.legacyPrestige ?? 10,
    wealth: 0,
    attitudes: {},
  }
}

const splitConfig: Partial<SimulationConfig> = {
  houseSplitEnabled: true,
  baseHouseSplitChance: 1.0,
  minProvincesForHouseSplit: 3,
  houseSplitCohesionThreshold: 60,
  houseSplitCooldownWeeks: 48,
  houseSplitMinLivingMembers: 3,
  houseSplitMinWealth: 50,
  houseSplitMinLegacyPrestige: 20,
}

function makeSplitableHouseCtx(configOverride?: Partial<SimulationConfig>): TickContext {
  const houseId = 'h-0' as HouseId
  const polityId = 'dp-0' as PolityId
  const config = { ...defaultConfig, ...splitConfig, ...configOverride }

  const memberIds: PersonId[] = []
  const persons: Record<string, Person> = {}
  for (let i = 0; i < 5; i++) {
    const pid = `pe-${i}` as PersonId
    memberIds.push(pid)
    persons[pid] = makePerson(pid, `Member${i}`, 30, houseId, {
      ambition: i === 1 ? 0.9 : 0.3,
      legacyPrestige: i === 1 ? 80 : 10,
    })
  }

  const provinceIds: ProvinceId[] = []
  for (let i = 0; i < 5; i++) {
    provinceIds.push(`p-${i}` as ProvinceId)
  }

  let state = makeEmptyV016State()
  state = { ...state, currentYear: 10, currentWeekOfYear: 12, absoluteWeek: 525 }

  for (const provId of provinceIds) {
    state = withProvince(state, provId, { nameKey: `Province_${provId}`, x: 0, y: 0 })
  }

  state = withHouse(state, houseId, {
    nameKey: 'H0',
    memberIds,
    legacyPrestige: 50,
    wealth: 100,
    seatProvinceId: provinceIds[0]!,
  })

  state = withPolity(state, polityId, {
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 50,
    capitalProvinceId: provinceIds[0]!,
  })

  for (const provId of provinceIds) {
    state = bindProvinceToHouseViaPolity(state, provId, polityId, houseId)
  }

  state = { ...state, persons: { ...state.persons, ...persons } }

  // Set up house leader office for pe-0
  state = createOfficeAssignment(
    state,
    { kind: 'house', id: houseId },
    'leader',
    'pe-0' as PersonId,
  )

  return {
    state,
    rng: createRng('split-eval-test'),
    config,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 1,
    nextPolityIndex: 1,
  }
}

describe('runHouseSplitEvaluationSystem', () => {
  it('disabled → identity', () => {
    const ctx = makeSplitableHouseCtx({ houseSplitEnabled: false })
    const result = runHouseSplitEvaluationSystem(ctx)
    expect(result.state).toBe(ctx.state)
  })

  it('no split when living members below threshold', () => {
    const ctx = makeSplitableHouseCtx({ houseSplitMinLivingMembers: 100 })
    const result = runHouseSplitEvaluationSystem(ctx)
    expect(result.events.filter((e) => e.type === 'HOUSE_SPLIT').length).toBe(0)
  })

  it('no split when wealth below threshold', () => {
    const ctx = makeSplitableHouseCtx({ houseSplitMinWealth: 99999 })
    const result = runHouseSplitEvaluationSystem(ctx)
    expect(result.events.filter((e) => e.type === 'HOUSE_SPLIT').length).toBe(0)
  })

  it('no split when provinces below threshold', () => {
    const ctx = makeSplitableHouseCtx({ minProvincesForHouseSplit: 100 })
    const result = runHouseSplitEvaluationSystem(ctx)
    expect(result.events.filter((e) => e.type === 'HOUSE_SPLIT').length).toBe(0)
  })

  it('no split during cooldown', () => {
    const ctx = makeSplitableHouseCtx()
    const houseId = 'h-0' as HouseId
    const house = ctx.state.houses[houseId]!
    const stateWithCooldown = {
      ...ctx.state,
      houses: {
        ...ctx.state.houses,
        [houseId]: { ...house, lastSplitWeek: ctx.state.absoluteWeek },
      },
    }
    const result = runHouseSplitEvaluationSystem({ ...ctx, state: stateWithCooldown })
    expect(result.events.filter((e) => e.type === 'HOUSE_SPLIT').length).toBe(0)
  })

  it('split occurs when all conditions met', () => {
    const ctx = makeSplitableHouseCtx()
    const result = runHouseSplitEvaluationSystem(ctx)

    const splitEvents = result.events.filter((e) => e.type === 'HOUSE_SPLIT')
    expect(splitEvents.length).toBeGreaterThan(0)

    const cadetEvents = result.events.filter((e) => e.type === 'CADET_HOUSE_FOUNDED')
    expect(cadetEvents.length).toBeGreaterThan(0)
  })

  it('no SUCCESSION_CRISIS event in evaluation path', () => {
    const ctx = makeSplitableHouseCtx()
    const result = runHouseSplitEvaluationSystem(ctx)

    const crisisEvents = result.events.filter((e) => e.type === 'SUCCESSION_CRISIS')
    expect(crisisEvents.length).toBe(0)
  })

  it('lastSplitWeek set on both houses after split', () => {
    const ctx = makeSplitableHouseCtx()
    const result = runHouseSplitEvaluationSystem(ctx)

    const splitEvents = result.events.filter((e) => e.type === 'HOUSE_SPLIT')
    if (splitEvents.length > 0) {
      const parentHouse = result.state.houses['h-0' as HouseId]
      expect(parentHouse?.lastSplitWeek).toBe(result.state.absoluteWeek)

      // Find new house
      const newHouseIds = Object.keys(result.state.houses).filter((k) => {
        if (k === 'h-0') return false
        const h = result.state.houses[k as HouseId]
        return h !== undefined && h.kind !== 'system'
      })
      expect(newHouseIds.length).toBeGreaterThan(0)
      const newHouse = result.state.houses[newHouseIds[0] as HouseId]
      expect(newHouse?.lastSplitWeek).toBe(result.state.absoluteWeek)
    }
  })

  it('new house has shares after split', () => {
    const ctx = makeSplitableHouseCtx()
    const result = runHouseSplitEvaluationSystem(ctx)

    const newHouseIds = Object.keys(result.state.houses).filter((k) => {
      if (k === 'h-0') return false
      const h = result.state.houses[k as HouseId]
      return h !== undefined && h.kind !== 'system'
    })
    if (newHouseIds.length > 0) {
      const newHouseId = newHouseIds[0] as HouseId
      const houseRef = `house:${newHouseId}`
      const shareIds = result.state.shareIndex.byOrganization[houseRef] ?? []
      expect(shareIds.length).toBeGreaterThan(0)
    }
  })
})
