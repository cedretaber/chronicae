import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { HouseId, CountryId, PersonId, EventId } from '../types/ids'
import type { Person } from '../types/person'
import { createTickContext, makeEventId, makePersonId, toResult } from './context'
import { createRng } from '../rng/rng'

function makeMinimalWorld(personIds: PersonId[] = []): WorldState {
  const persons: Record<PersonId, Person> = {}
  for (const id of personIds) {
    persons[id] = {
      id,
      name: 'Test',
      age: 30,
      alive: true,
      houseId: 'h-0' as HouseId,
      countryId: 'c-0' as CountryId,
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 10,
    }
  }
  return {
    currentYear: 1,
    currentMonth: 1,
    provinces: {},
    countries: {},
    houses: {},
    persons,
    activePlots: {},
  }
}

function makeConfig() {
  return {
    ...{
      minLivingMembersPerHouse: 4,
      maxNewPersonsPerHousePerYear: 2,
      basePlotSuccess: 0.35,
      rebellionThreshold: 70,
      plotThreshold: 65,
      replacementThreshold: 15,
      rebellionSuccessMode: 'independence' as const,
      maxRawEvents: 10000,
      maxChronicleEvents: 1000,
      warEnabled: true,
      warCostPerProvince: 20,
      maxProvincesPerWar: 3,
      maxWarsPerTick: 1,
      warCooldownMonths: 24,
      minAttackerWinChanceToDeclare: 0.45,
      disasterEnabled: true,
      famineBaseChancePerYear: 0.08,
      plagueBaseChancePerYear: 0.03,
      bountifulHarvestBaseChancePerYear: 0.05,
      disasterReliefCostPerProvince: 20,
      publicSpendingEnabled: true,
      monumentBaseCost: 120,
      publicSpendingYearlyChance: 0.35,
      developmentPositiveMonthlyDecay: 0.1,
      developmentNegativeMonthlyRecovery: 0.25,
      warConqueredProvinceDevastation: 8,
      warBorderProvinceDevastation: 3,
      failedWarBorderDevastation: 3,
      rebellionStartedDevastation: 2,
      rebellionSucceededDevastation: 3,
      rebellionFailedDevastation: 5,
      famineDevastation: 5,
      famineReliefDevelopmentRecovery: 2,
      plagueDevastation: 8,
      bountifulHarvestDevelopmentGain: 3,
      countryLandDevelopmentBaseCost: 70,
      countryLandDevelopmentGain: 8,
      houseDevelopmentEnabled: true,
      houseDevelopmentYearlyChance: 0.25,
      houseLandDevelopmentBaseCost: 40,
      houseLandDevelopmentGain: 6,
      houseWealthReserve: 50,
      controlMaxDistancePenalty: 10,
      controlMaxMinimum: 40,
      controlGrowthPerMonth: 2,
      controlDecayPerMonth: 1,
      disconnectedControlDecayPerMonth: 5,
      monumentCountryControlGain: 10,
      monumentLegitimacyGain: 5,
      landDevelopmentHouseControlGain: 5,
      landDevelopmentUnrestReduction: 1,
      lordshipAbsorptionTargetThreshold: 50,
      lordshipAbsorptionSourceMinimum: 60,
      lordshipAbsorptionRatio: 2,
      lordshipAbsorptionMonthlyChance: 0.05,
      lordshipAbsorptionNewControlMin: 50,
      lordshipAbsorptionNewControlMax: 70,
      lordshipAbsorptionNewControlPenalty: 10,
      annexedCountryControl: 35,
      newRulerHouseControl: 35,
    },
  }
}

describe('createTickContext', () => {
  it('sets nextPersonIndex=0 when no persons exist', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextPersonIndex).toBe(0)
  })

  it('sets nextPersonIndex to max index + 1 from existing persons (pe-0, pe-5, pe-12 -> 13)', () => {
    const personIds: PersonId[] = ['pe-0' as PersonId, 'pe-5' as PersonId, 'pe-12' as PersonId]
    const state = makeMinimalWorld(personIds)
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextPersonIndex).toBe(13)
  })
})

describe('createTickContext nextEventIndex', () => {
  it('sets nextEventIndex=0', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextEventIndex).toBe(0)
  })
})

describe('makeEventId', () => {
  it('returns id in format e-{year}-{month}-{index} and increments nextEventIndex', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextEventIndex).toBe(0)

    const { id, ctx: updatedCtx } = makeEventId(ctx)
    expect(id).toBe('e-1-1-0')
    expect(updatedCtx.nextEventIndex).toBe(1)

    const { id: id2, ctx: updatedCtx2 } = makeEventId(updatedCtx)
    expect(id2).toBe('e-1-1-1')
    expect(updatedCtx2.nextEventIndex).toBe(2)
  })

  it('does not mutate ctx', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    const originalNextEventIndex = ctx.nextEventIndex

    makeEventId(ctx)

    expect(ctx.nextEventIndex).toBe(originalNextEventIndex)
  })
})

describe('makePersonId', () => {
  it('returns id in format pe-{index} and increments nextPersonIndex', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextPersonIndex).toBe(0)

    const { id, ctx: updatedCtx } = makePersonId(ctx)
    expect(id).toBe('pe-0' as PersonId)
    expect(updatedCtx.nextPersonIndex).toBe(1)

    const { id: id2, ctx: updatedCtx2 } = makePersonId(updatedCtx)
    expect(id2).toBe('pe-1' as PersonId)
    expect(updatedCtx2.nextPersonIndex).toBe(2)
  })
})

describe('toResult', () => {
  it('returns state, rng, and events as array', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })

    const result = toResult(ctx)

    expect(result.state).toBe(state)
    expect(result.rng).toBe(rng)
    expect(Array.isArray(result.events)).toBe(true)
    expect(result.events).toHaveLength(0)
  })

  it('events array is a copy, not the same reference', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })

    const result = toResult(ctx)
    result.events.push({
      id: 'e-1-1-99' as EventId,
      year: 1,
      month: 1,
      type: 'PERSON_DIED',
      importance: 'minor',
      actorIds: [],
      houseIds: [],
      countryIds: [],
      provinceIds: [],
      summary: 'test',
      reasons: [],
      effects: [],
    })

    const result2 = toResult(ctx)
    expect(result2.events).toHaveLength(0)
  })
})
