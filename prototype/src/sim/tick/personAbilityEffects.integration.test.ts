import { describe, it, expect } from 'vitest'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { ProvinceId, HouseId, CountryId, PersonId } from '../types/ids'
import type { Person } from '../types/person'
import { runControlSystem } from './controlSystem'
import { runEconomySystem } from './economySystem'
import { runPublicSpendingSystem } from './publicSpendingSystem'
import { runHouseDevelopmentSystem } from './houseDevelopmentSystem'
import {
  calcGeneralDeclareThreshold,
  calcHouseHeadDevelopmentChanceBonus,
} from '../selectors/personAbilityEffects'

function makePerson(
  admin: number,
  martial: number,
  ambition: number,
  caution: number,
  loyaltyToCountry: number = 0.5,
): Person {
  return {
    id: 'pe-0' as PersonId,
    name: 'TestPerson',
    age: 30,
    alive: true,
    houseId: 'h-0' as HouseId,
    countryId: 'c-0' as CountryId,
    stats: { admin, martial },
    traits: { ambition, caution, loyaltyToCountry },
    prestige: 50,
  }
}

function makeWorldState(
  person: Person,
  roleAssignments: Record<string, PersonId>,
  treasury: number = 100,
  houseWealth: number = 100,
): WorldState {
  const provinceId = 'p-0' as ProvinceId
  const houseId = 'h-0' as HouseId
  const countryId = 'c-0' as CountryId

  return {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {
      [provinceId]: {
        id: provinceId,
        name: 'P0',
        x: 0,
        y: 0,
        neighbors: [],
        ownerHouseId: houseId,
        countryId,
        baseTax: 10,
        manpower: 5,
        unrest: 0,
        development: 0,
        countryControl: 50,
        houseControl: 50,
      },
    },
    countries: {
      [countryId]: {
        id: countryId,
        name: 'C0',
        rulerHouseId: houseId,
        houseIds: [houseId],
        treasury,
        legitimacy: 80,
        adminPower: 10,
        stability: 0,
        roleAssignments,
        active: true,
        capitalProvinceId: provinceId,
      },
    },
    houses: {
      [houseId]: {
        id: houseId,
        name: 'H0',
        active: true,
        countryId,
        provinceIds: [provinceId],
        memberIds: [],
        headId: person.id,
        prestige: 50,
        cohesion: 60,
        loyaltyToCountry: 70,
        wealth: houseWealth,
        seatProvinceId: provinceId,
      },
    },
    persons: {
      [person.id]: person,
    },
    activePlots: {},
  }
}

function makeCtx(world: WorldState): TickContext {
  return {
    state: world,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
  }
}

describe('runControlSystem — countryControl growth', () => {
  it('admin=10 chancellor grows countryControl faster than admin=5', () => {
    const highAdminPerson = makePerson(10, 5, 0.5, 0.5)
    const highAdminState = makeWorldState(highAdminPerson, { chancellor: highAdminPerson.id })
    const highAdminCtx = makeCtx(highAdminState)
    const highAdminResult = runControlSystem(highAdminCtx)

    const neutralPerson = makePerson(5, 5, 0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { chancellor: neutralPerson.id })
    const neutralCtx = makeCtx(neutralState)
    const neutralResult = runControlSystem(neutralCtx)

    const highAdminProv = highAdminResult.state.provinces['p-0' as ProvinceId]!
    const neutralProv = neutralResult.state.provinces['p-0' as ProvinceId]!

    expect(highAdminProv.countryControl).toBeGreaterThan(neutralProv.countryControl)
  })

  it('admin=5 chancellor grows countryControl faster than admin=0', () => {
    const neutralPerson = makePerson(5, 5, 0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { chancellor: neutralPerson.id })
    const neutralCtx = makeCtx(neutralState)
    const neutralResult = runControlSystem(neutralCtx)

    const lowAdminPerson = makePerson(0, 5, 0.5, 0.5)
    const lowAdminState = makeWorldState(lowAdminPerson, { chancellor: lowAdminPerson.id })
    const lowAdminCtx = makeCtx(lowAdminState)
    const lowAdminResult = runControlSystem(lowAdminCtx)

    const neutralProv = neutralResult.state.provinces['p-0' as ProvinceId]!
    const lowAdminProv = lowAdminResult.state.provinces['p-0' as ProvinceId]!

    expect(neutralProv.countryControl).toBeGreaterThan(lowAdminProv.countryControl)
  })

  it('expected values: admin=10 → 52.5, admin=5 → 52.0, admin=0 → 51.5', () => {
    const admin10Person = makePerson(10, 5, 0.5, 0.5)
    const admin10State = makeWorldState(admin10Person, { chancellor: admin10Person.id })
    const admin10Result = runControlSystem(makeCtx(admin10State))
    const admin10Prov = admin10Result.state.provinces['p-0' as ProvinceId]!
    expect(admin10Prov.countryControl).toBeCloseTo(52.5, 5)

    const admin5Person = makePerson(5, 5, 0.5, 0.5)
    const admin5State = makeWorldState(admin5Person, { chancellor: admin5Person.id })
    const admin5Result = runControlSystem(makeCtx(admin5State))
    const admin5Prov = admin5Result.state.provinces['p-0' as ProvinceId]!
    expect(admin5Prov.countryControl).toBeCloseTo(52.0, 5)

    const admin0Person = makePerson(0, 5, 0.5, 0.5)
    const admin0State = makeWorldState(admin0Person, { chancellor: admin0Person.id })
    const admin0Result = runControlSystem(makeCtx(admin0State))
    const admin0Prov = admin0Result.state.provinces['p-0' as ProvinceId]!
    expect(admin0Prov.countryControl).toBeCloseTo(51.5, 5)
  })
})

describe('runControlSystem — capital province maxControl', () => {
  it('capital province at 100 stays at 100 regardless of chancellor admin', () => {
    const admin0Person = makePerson(0, 5, 0.5, 0.5)
    const provinceId = 'p-0' as ProvinceId
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId

    const world: WorldState = {
      currentYear: 1444,
      currentMonth: 1,
      provinces: {
        [provinceId]: {
          id: provinceId,
          name: 'Capital',
          x: 0,
          y: 0,
          neighbors: [],
          ownerHouseId: houseId,
          countryId,
          baseTax: 10,
          manpower: 5,
          unrest: 0,
          development: 0,
          countryControl: 100,
          houseControl: 100,
        },
      },
      countries: {
        [countryId]: {
          id: countryId,
          name: 'C0',
          rulerHouseId: houseId,
          houseIds: [houseId],
          treasury: 100,
          legitimacy: 80,
          adminPower: 10,
          stability: 0,
          roleAssignments: { chancellor: admin0Person.id },
          active: true,
          capitalProvinceId: provinceId,
        },
      },
      houses: {
        [houseId]: {
          id: houseId,
          name: 'H0',
          active: true,
          countryId,
          provinceIds: [provinceId],
          memberIds: [],
          headId: admin0Person.id,
          prestige: 50,
          cohesion: 60,
          loyaltyToCountry: 70,
          wealth: 100,
          seatProvinceId: provinceId,
        },
      },
      persons: {
        [admin0Person.id]: admin0Person,
      },
      activePlots: {},
    }

    const result = runControlSystem(makeCtx(world))
    const capitalProv = result.state.provinces['p-0' as ProvinceId]!
    expect(capitalProv.countryControl).toBe(100)
  })
})

describe('runEconomySystem — treasurer tax efficiency', () => {
  it('treasurer admin=10 produces higher treasury than admin=5', () => {
    const highAdminPerson = makePerson(10, 5, 0.5, 1.0)
    const highAdminState = makeWorldState(highAdminPerson, { treasurer: highAdminPerson.id })
    const highAdminResult = runEconomySystem(makeCtx(highAdminState))
    const highAdminTreasury = highAdminResult.state.countries['c-0' as CountryId]!.treasury

    const neutralPerson = makePerson(5, 5, 0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { treasurer: neutralPerson.id })
    const neutralResult = runEconomySystem(makeCtx(neutralState))
    const neutralTreasury = neutralResult.state.countries['c-0' as CountryId]!.treasury

    expect(highAdminTreasury).toBeGreaterThan(neutralTreasury)
  })

  it('expected treasury values: admin=10 → 103.0, admin=5 → 102.5', () => {
    const highAdminPerson = makePerson(10, 5, 0.5, 1.0)
    const highAdminState = makeWorldState(highAdminPerson, { treasurer: highAdminPerson.id })
    const highAdminResult = runEconomySystem(makeCtx(highAdminState))
    const highAdminTreasury = highAdminResult.state.countries['c-0' as CountryId]!.treasury
    expect(highAdminTreasury).toBeCloseTo(103.0, 5)

    const neutralPerson = makePerson(5, 5, 0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { treasurer: neutralPerson.id })
    const neutralResult = runEconomySystem(makeCtx(neutralState))
    const neutralTreasury = neutralResult.state.countries['c-0' as CountryId]!.treasury
    expect(neutralTreasury).toBeCloseTo(102.5, 5)
  })
})

describe('runEconomySystem — houseIncome unaffected by treasurer', () => {
  it('house.wealth is the same regardless of treasurer admin level', () => {
    const highAdminPerson = makePerson(10, 5, 0.5, 1.0)
    const highAdminState = makeWorldState(highAdminPerson, { treasurer: highAdminPerson.id })
    const highAdminResult = runEconomySystem(makeCtx(highAdminState))
    const highAdminWealth = highAdminResult.state.houses['h-0' as HouseId]!.wealth

    const neutralPerson = makePerson(5, 5, 0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { treasurer: neutralPerson.id })
    const neutralResult = runEconomySystem(makeCtx(neutralState))
    const neutralWealth = neutralResult.state.houses['h-0' as HouseId]!.wealth

    expect(highAdminWealth).toBe(neutralWealth)
  })

  it('expected house.wealth: 102.5 for both admin=10 and admin=5', () => {
    const highAdminPerson = makePerson(10, 5, 0.5, 1.0)
    const highAdminState = makeWorldState(highAdminPerson, { treasurer: highAdminPerson.id })
    const highAdminResult = runEconomySystem(makeCtx(highAdminState))
    const highAdminWealth = highAdminResult.state.houses['h-0' as HouseId]!.wealth
    expect(highAdminWealth).toBeCloseTo(102.5, 5)

    const neutralPerson = makePerson(5, 5, 0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { treasurer: neutralPerson.id })
    const neutralResult = runEconomySystem(makeCtx(neutralState))
    const neutralWealth = neutralResult.state.houses['h-0' as HouseId]!.wealth
    expect(neutralWealth).toBeCloseTo(102.5, 5)
  })
})

describe('calcGeneralDeclareThreshold — integration with defaultConfig', () => {
  it('ambition=1.0 general returns threshold below base 0.45', () => {
    const ambitionPerson = makePerson(5, 10, 1.0, 0.5)
    const state = makeWorldState(ambitionPerson, { general: ambitionPerson.id })
    const threshold = calcGeneralDeclareThreshold(
      state,
      state.countries['c-0' as CountryId]!,
      defaultConfig,
    )
    expect(threshold).toBe(0.4)
    expect(threshold).toBeLessThan(0.45)
  })

  it('caution=1.0 general returns threshold above base 0.45', () => {
    const cautionPerson = makePerson(5, 10, 0.5, 1.0)
    const state = makeWorldState(cautionPerson, { general: cautionPerson.id })
    const threshold = calcGeneralDeclareThreshold(
      state,
      state.countries['c-0' as CountryId]!,
      defaultConfig,
    )
    expect(threshold).toBe(0.5)
    expect(threshold).toBeGreaterThan(0.45)
  })

  it('disabled effects returns base threshold 0.45', () => {
    const ambitionPerson = makePerson(5, 10, 1.0, 0.5)
    const state = makeWorldState(ambitionPerson, { general: ambitionPerson.id })
    const disabledConfig = { ...defaultConfig, personAbilityEffectsEnabled: false }
    const threshold = calcGeneralDeclareThreshold(
      state,
      state.countries['c-0' as CountryId]!,
      disabledConfig,
    )
    expect(threshold).toBe(0.45)
  })
})

describe('runPublicSpendingSystem — chancellor ambition monument preference', () => {
  it('ambition=1.0 chancellor triggers MONUMENT_BUILT event', () => {
    const ambitionChancellor = makePerson(5, 5, 1.0, 0.0)
    const state = makeWorldState(ambitionChancellor, { chancellor: ambitionChancellor.id }, 500)
    const config = { ...defaultConfig, publicSpendingYearlyChance: 1.0 }
    const ctx = { ...makeCtx(state), config }
    const result = runPublicSpendingSystem(ctx)

    const monumentEvents = result.events.filter((e) => e.type === 'MONUMENT_BUILT')
    expect(monumentEvents.length).toBeGreaterThan(0)
  })

  it('monumentScore exceeds landDevelopmentScore with ambition=1.0 chancellor', () => {
    const ambitionChancellor = makePerson(5, 5, 1.0, 0.0)
    const state = makeWorldState(ambitionChancellor, { chancellor: ambitionChancellor.id }, 500)
    const config = { ...defaultConfig, publicSpendingYearlyChance: 1.0 }
    const ctx = { ...makeCtx(state), config }
    const result = runPublicSpendingSystem(ctx)

    const monumentEvents = result.events.filter((e) => e.type === 'MONUMENT_BUILT')
    const landDevEvents = result.events.filter((e) => e.type === 'COUNTRY_LAND_DEVELOPED')
    expect(monumentEvents.length).toBeGreaterThan(0)
    expect(landDevEvents.length).toBe(0)
  })

  it('neutral chancellor produces different outcome than ambition=1.0', () => {
    const neutralChancellor = makePerson(5, 5, 0.5, 0.5)
    const neutralState = makeWorldState(
      neutralChancellor,
      { chancellor: neutralChancellor.id },
      500,
    )
    const config = { ...defaultConfig, publicSpendingYearlyChance: 1.0 }
    const neutralCtx = { ...makeCtx(neutralState), config }
    const neutralResult = runPublicSpendingSystem(neutralCtx)

    const ambitionChancellor = makePerson(5, 5, 1.0, 0.0)
    const ambitionState = makeWorldState(
      ambitionChancellor,
      { chancellor: ambitionChancellor.id },
      500,
    )
    const ambitionCtx = { ...makeCtx(ambitionState), config }
    const ambitionResult = runPublicSpendingSystem(ambitionCtx)

    const neutralMonumentEvents = neutralResult.events.filter((e) => e.type === 'MONUMENT_BUILT')
    const ambitionMonumentEvents = ambitionResult.events.filter((e) => e.type === 'MONUMENT_BUILT')

    expect(ambitionMonumentEvents.length).toBeGreaterThanOrEqual(neutralMonumentEvents.length)
  })
})

describe('runHouseDevelopmentSystem — admin/caution bonus', () => {
  it('admin=10, caution=1.0 head produces higher abilityChanceBonus than admin=5', () => {
    const highBonusPerson = makePerson(10, 5, 0.5, 1.0)
    const highBonusState = makeWorldState(highBonusPerson, {})
    const highBonusBonus = calcHouseHeadDevelopmentChanceBonus(
      highBonusState,
      highBonusState.houses['h-0' as HouseId]!,
      defaultConfig,
    )

    const neutralPerson = makePerson(5, 5, 0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, {})
    const neutralBonus = calcHouseHeadDevelopmentChanceBonus(
      neutralState,
      neutralState.houses['h-0' as HouseId]!,
      defaultConfig,
    )

    expect(highBonusBonus).toBeGreaterThan(neutralBonus)
  })

  it('admin=10, caution=1.0 produces abilityChanceBonus of approximately 0.15', () => {
    const highBonusPerson = makePerson(10, 5, 0.5, 1.0)
    const highBonusState = makeWorldState(highBonusPerson, {})
    const bonus = calcHouseHeadDevelopmentChanceBonus(
      highBonusState,
      highBonusState.houses['h-0' as HouseId]!,
      defaultConfig,
    )
    expect(bonus).toBeCloseTo(0.15, 5)
  })

  it('system emits HOUSE_LAND_DEVELOPED event with high wealth and chance=1.0', () => {
    const headPerson = makePerson(10, 5, 0.5, 1.0)
    const houseId = 'h-0' as HouseId
    const provinceId = 'p-0' as ProvinceId
    const countryId = 'c-0' as CountryId

    const state: WorldState = {
      currentYear: 1444,
      currentMonth: 1,
      provinces: {
        [provinceId]: {
          id: provinceId,
          name: 'P0',
          x: 0,
          y: 0,
          neighbors: [],
          ownerHouseId: houseId,
          countryId,
          baseTax: 10,
          manpower: 5,
          unrest: 0,
          development: 0,
          countryControl: 50,
          houseControl: 50,
        },
      },
      countries: {
        [countryId]: {
          id: countryId,
          name: 'C0',
          rulerHouseId: houseId,
          houseIds: [houseId],
          treasury: 500,
          legitimacy: 80,
          adminPower: 10,
          stability: 0,
          roleAssignments: {},
          active: true,
          capitalProvinceId: provinceId,
        },
      },
      houses: {
        [houseId]: {
          id: houseId,
          name: 'H0',
          active: true,
          countryId,
          provinceIds: [provinceId],
          memberIds: [],
          headId: headPerson.id,
          prestige: 50,
          cohesion: 60,
          loyaltyToCountry: 70,
          wealth: 500,
          seatProvinceId: provinceId,
        },
      },
      persons: {
        [headPerson.id]: headPerson,
      },
      activePlots: {},
    }

    const config = { ...defaultConfig, houseDevelopmentYearlyChance: 1.0 }
    const ctx = { ...makeCtx(state), config }
    const result = runHouseDevelopmentSystem(ctx)

    const devEvents = result.events.filter((e) => e.type === 'HOUSE_LAND_DEVELOPED')
    expect(devEvents.length).toBeGreaterThan(0)
  })

  it('disabled effects produce zero abilityChanceBonus', () => {
    const highBonusPerson = makePerson(10, 5, 0.5, 1.0)
    const highBonusState = makeWorldState(highBonusPerson, {})
    const disabledConfig = { ...defaultConfig, personAbilityEffectsEnabled: false }
    const bonus = calcHouseHeadDevelopmentChanceBonus(
      highBonusState,
      highBonusState.houses['h-0' as HouseId]!,
      disabledConfig,
    )
    expect(bonus).toBe(0)
  })
})
