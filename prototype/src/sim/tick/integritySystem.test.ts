import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId, CountryId, ProvinceId } from '../types/ids'
import type { Person } from '../types/person'
import type { House } from '../types/house'
import type { Country } from '../types/country'
import type { Province } from '../types/province'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runIntegrityCheck } from './integritySystem'
import { generateWorld } from '../worldgen/generateWorld'

function makeCtx(world: WorldState): TickContext {
  return {
    state: world,
    rng: createRng('integrity-test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
  }
}

function makeMinimalWorldWithHouse(
  houseId: HouseId,
  countryId: CountryId,
  headId: PersonId,
  headAlive: boolean,
): WorldState {
  const house: House = {
    id: houseId,
    name: 'H0',
    active: true,
    countryId,
    provinceIds: [],
    memberIds: [headId],
    headId,
    prestige: 50,
    cohesion: 60,
    loyaltyToCountry: 70,
    wealth: 100,
  }

  const headPerson: Person = {
    id: headId,
    name: 'Head',
    age: 50,
    alive: headAlive,
    houseId,
    countryId,
    stats: { admin: 5, martial: 5 },
    traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
    prestige: 30,
  }

  return {
    currentYear: 1,
    currentMonth: 1,
    provinces: {},
    countries: {
      [countryId]: {
        id: countryId,
        name: 'C0',
        rulerHouseId: houseId,
        houseIds: [houseId],
        treasury: 100,
        legitimacy: 70,
        adminPower: 50,
        stability: 60,
        roleAssignments: {},
      },
    },
    houses: { [houseId]: house },
    persons: { [headId]: headPerson },
    activePlots: {},
  }
}

describe('runIntegrityCheck', () => {
  it('valid world passes integrity check without throwing', () => {
    const world = makeValidWorldState()
    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).not.toThrow()
  })

  it('throws when dead person holds a role', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const personId = 'pe-0' as PersonId

    const person: Person = {
      id: personId,
      name: 'DeadPerson',
      age: 50,
      alive: false,
      houseId,
      countryId,
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 30,
    }

    const house: House = {
      id: houseId,
      name: 'H0',
      active: true,
      countryId,
      provinceIds: [],
      memberIds: [personId],
      headId: personId,
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
    }

    const country: Country = {
      id: countryId,
      name: 'C0',
      rulerHouseId: houseId,
      houseIds: [houseId],
      treasury: 100,
      legitimacy: 70,
      adminPower: 50,
      stability: 60,
      roleAssignments: { chancellor: personId },
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: {},
      countries: { [countryId]: country },
      houses: { [houseId]: house },
      persons: { [personId]: person },
      activePlots: {},
    }

    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('Dead person')
  })

  it('throws when active house head is dead', () => {
    const world = makeMinimalWorldWithHouse(
      'h-0' as HouseId,
      'c-0' as CountryId,
      'pe-0' as PersonId,
      false,
    )
    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('head')
  })

  it('throws when house.provinceIds contains province with wrong ownerHouseId', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const provinceId = 'p-0' as ProvinceId
    const otherHouseId = 'h-1' as HouseId

    const otherHouse: House = {
      id: otherHouseId,
      name: 'H1',
      active: true,
      countryId,
      provinceIds: [],
      memberIds: [],
      headId: 'pe-0' as PersonId,
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
    }

    const province: Province = {
      id: provinceId,
      name: 'P0',
      x: 0,
      y: 0,
      neighbors: [],
      ownerHouseId: otherHouseId,
      countryId,
      baseTax: 5,
      manpower: 5,
      unrest: 0,
    }

    const headPerson: Person = {
      id: 'pe-0' as PersonId,
      name: 'Head',
      age: 50,
      alive: true,
      houseId,
      countryId,
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 30,
    }

    const house: House = {
      id: houseId,
      name: 'H0',
      active: true,
      countryId,
      provinceIds: [provinceId],
      memberIds: ['pe-0' as PersonId],
      headId: 'pe-0' as PersonId,
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
    }

    const country: Country = {
      id: countryId,
      name: 'C0',
      rulerHouseId: houseId,
      houseIds: [houseId, otherHouseId],
      treasury: 100,
      legitimacy: 70,
      adminPower: 50,
      stability: 60,
      roleAssignments: {},
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: { [provinceId]: province },
      countries: { [countryId]: country },
      houses: {
        [houseId]: house,
        [otherHouseId]: otherHouse,
      },
      persons: { ['pe-0' as PersonId]: headPerson },
      activePlots: {},
    }

    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('ownerHouseId mismatch')
  })

  it('throws when province.countryId does not match ownerHouse.countryId', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const wrongCountryId = 'c-1' as CountryId
    const provinceId = 'p-0' as ProvinceId

    const province: Province = {
      id: provinceId,
      name: 'P0',
      x: 0,
      y: 0,
      neighbors: [],
      ownerHouseId: houseId,
      countryId: wrongCountryId,
      baseTax: 5,
      manpower: 5,
      unrest: 0,
    }

    const headPerson: Person = {
      id: 'pe-0' as PersonId,
      name: 'Head',
      age: 50,
      alive: true,
      houseId,
      countryId,
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 30,
    }

    const house: House = {
      id: houseId,
      name: 'H0',
      active: true,
      countryId,
      provinceIds: [provinceId],
      memberIds: ['pe-0' as PersonId],
      headId: 'pe-0' as PersonId,
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
    }

    const country: Country = {
      id: countryId,
      name: 'C0',
      rulerHouseId: houseId,
      houseIds: [houseId],
      treasury: 100,
      legitimacy: 70,
      adminPower: 50,
      stability: 60,
      roleAssignments: {},
    }

    const wrongCountry: Country = {
      id: wrongCountryId,
      name: 'C1',
      rulerHouseId: houseId,
      houseIds: [houseId],
      treasury: 100,
      legitimacy: 70,
      adminPower: 50,
      stability: 60,
      roleAssignments: {},
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: { [provinceId]: province },
      countries: {
        [countryId]: country,
        [wrongCountryId]: wrongCountry,
      },
      houses: { [houseId]: house },
      persons: { ['pe-0' as PersonId]: headPerson },
      activePlots: {},
    }

    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('countryId mismatch')
  })

  it('throws when country.rulerHouseId points to inactive house', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId

    const house: House = {
      id: houseId,
      name: 'H0',
      active: false,
      countryId,
      provinceIds: [],
      memberIds: [],
      headId: 'pe-0' as PersonId,
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
    }

    const country: Country = {
      id: countryId,
      name: 'C0',
      rulerHouseId: houseId,
      houseIds: [houseId],
      treasury: 100,
      legitimacy: 70,
      adminPower: 50,
      stability: 60,
      roleAssignments: {},
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: {},
      countries: { [countryId]: country },
      houses: { [houseId]: house },
      persons: {},
      activePlots: {},
    }

    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('rulerHouseId')
  })
})

function makeValidWorldState(): WorldState {
  const { world } = generateWorld('integrity-valid')
  return world
}
