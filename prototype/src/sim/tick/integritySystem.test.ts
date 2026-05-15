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
    nextHouseIndex: 0,
    nextCountryIndex: 0,
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
    cadetHouseIds: [],
    prestige: 50,
    cohesion: 60,
    loyaltyToCountry: 70,
    wealth: 100,
    seatProvinceId: '' as ProvinceId,
  }

  const headPerson: Person = {
    id: headId,
    name: 'Head',
    sex: 'male',
    age: 50,
    alive: headAlive,
    houseId,
    countryId,
    childIds: [],
    birthStatus: 'unknown',
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
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: { [houseId]: house },
    persons: { [headId]: headPerson },
    activePlots: {},
    popGroups: {},
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
      sex: 'male',
      age: 50,
      alive: false,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
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
      cadetHouseIds: [],
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
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
      active: true,
      capitalProvinceId: '' as ProvinceId,
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: {},
      countries: { [countryId]: country },
      houses: { [houseId]: house },
      persons: { [personId]: person },
      activePlots: {},
      popGroups: {},
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
      cadetHouseIds: [],
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const province: Province = {
      id: provinceId,
      name: 'P0',
      x: 0,
      y: 0,
      neighbors: [],
      ownerHouseId: otherHouseId,
      countryId,
      habitability: 50,
      development: 0,
      countryControl: 100,
      houseControl: 100,
      popGroupIds: [],
    }

    const headPerson: Person = {
      id: 'pe-0' as PersonId,
      name: 'Head',
      sex: 'male',
      age: 50,
      alive: true,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
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
      cadetHouseIds: [],
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
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
      active: true,
      capitalProvinceId: '' as ProvinceId,
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
      popGroups: {},
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
      habitability: 50,
      development: 0,
      countryControl: 100,
      houseControl: 100,
      popGroupIds: [],
    }

    const headPerson: Person = {
      id: 'pe-0' as PersonId,
      name: 'Head',
      sex: 'male',
      age: 50,
      alive: true,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
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
      cadetHouseIds: [],
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
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
      active: true,
      capitalProvinceId: '' as ProvinceId,
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
      active: true,
      capitalProvinceId: '' as ProvinceId,
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
      popGroups: {},
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
      cadetHouseIds: [],
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
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
      active: true,
      capitalProvinceId: '' as ProvinceId,
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: {},
      countries: { [countryId]: country },
      houses: { [houseId]: house },
      persons: {},
      activePlots: {},
      popGroups: {},
    }

    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('rulerHouseId')
  })

  it('throws when person has invalid sex field', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const personId = 'pe-0' as PersonId

    const person: Person = {
      id: personId,
      name: 'InvalidSex',
      sex: 'other' as unknown as 'male' | 'female',
      age: 30,
      alive: true,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 10,
    }

    const house: House = {
      id: houseId,
      name: 'H0',
      active: true,
      countryId,
      provinceIds: [],
      memberIds: [personId],
      headId: personId,
      cadetHouseIds: [],
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
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
      active: true,
      capitalProvinceId: '' as ProvinceId,
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: {},
      countries: { [countryId]: country },
      houses: { [houseId]: house },
      persons: { [personId]: person },
      activePlots: {},
      popGroups: {},
    }

    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('invalid sex')
  })

  it('throws when spouse does not point back', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const personAId = 'pe-a' as PersonId
    const personBId = 'pe-b' as PersonId

    const personA: Person = {
      id: personAId,
      name: 'PersonA',
      sex: 'male',
      age: 30,
      alive: true,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 10,
      spouseId: personBId,
    }

    const personB: Person = {
      id: personBId,
      name: 'PersonB',
      sex: 'female',
      age: 28,
      alive: true,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 10,
    }

    const house: House = {
      id: houseId,
      name: 'H0',
      active: true,
      countryId,
      provinceIds: [],
      memberIds: [personAId, personBId],
      headId: personAId,
      cadetHouseIds: [],
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
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
      active: true,
      capitalProvinceId: '' as ProvinceId,
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: {},
      countries: { [countryId]: country },
      houses: { [houseId]: house },
      persons: { [personAId]: personA, [personBId]: personB },
      activePlots: {},
      popGroups: {},
    }

    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('does not point back')
  })

  it('throws when person is their own spouse', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const personId = 'pe-0' as PersonId

    const person: Person = {
      id: personId,
      name: 'SelfSpouse',
      sex: 'male',
      age: 30,
      alive: true,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 10,
      spouseId: personId,
    }

    const house: House = {
      id: houseId,
      name: 'H0',
      active: true,
      countryId,
      provinceIds: [],
      memberIds: [personId],
      headId: personId,
      cadetHouseIds: [],
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
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
      active: true,
      capitalProvinceId: '' as ProvinceId,
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: {},
      countries: { [countryId]: country },
      houses: { [houseId]: house },
      persons: { [personId]: person },
      activePlots: {},
      popGroups: {},
    }

    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('own spouse')
  })

  it('throws when alive person has dead spouse', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const personAId = 'pe-a' as PersonId
    const personBId = 'pe-b' as PersonId

    const personA: Person = {
      id: personAId,
      name: 'AlivePerson',
      sex: 'male',
      age: 30,
      alive: true,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 10,
      spouseId: personBId,
    }

    const personB: Person = {
      id: personBId,
      name: 'DeadPerson',
      sex: 'female',
      age: 28,
      alive: false,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 10,
      spouseId: personAId,
    }

    const house: House = {
      id: houseId,
      name: 'H0',
      active: true,
      countryId,
      provinceIds: [],
      memberIds: [personAId, personBId],
      headId: personAId,
      cadetHouseIds: [],
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
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
      active: true,
      capitalProvinceId: '' as ProvinceId,
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: {},
      countries: { [countryId]: country },
      houses: { [houseId]: house },
      persons: { [personAId]: personA, [personBId]: personB },
      activePlots: {},
      popGroups: {},
    }

    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('is dead')
  })

  it('throws when father missing child in childIds', () => {
    const countryId = 'c-0' as CountryId
    const childId = 'pe-child' as PersonId
    const fatherId = 'pe-father' as PersonId

    const child: Person = {
      id: childId,
      name: 'Child',
      sex: 'male',
      age: 5,
      alive: true,
      houseId: 'h-0' as HouseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 0,
      fatherId,
    }

    const father: Person = {
      id: fatherId,
      name: 'Father',
      sex: 'male',
      age: 30,
      alive: true,
      houseId: 'h-0' as HouseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 10,
    }

    const house: House = {
      id: 'h-0' as HouseId,
      name: 'H0',
      active: true,
      countryId,
      provinceIds: [],
      memberIds: [childId, fatherId],
      headId: fatherId,
      cadetHouseIds: [],
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const country: Country = {
      id: countryId,
      name: 'C0',
      rulerHouseId: 'h-0' as HouseId,
      houseIds: ['h-0' as HouseId],
      treasury: 100,
      legitimacy: 70,
      adminPower: 50,
      stability: 60,
      roleAssignments: {},
      active: true,
      capitalProvinceId: '' as ProvinceId,
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: {},
      countries: { [countryId]: country },
      houses: { ['h-0' as HouseId]: house },
      persons: { [childId]: child, [fatherId]: father },
      activePlots: {},
      popGroups: {},
    }

    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('missing child')
  })

  it('throws when parent house missing cadet in cadetHouseIds', () => {
    const countryId = 'c-0' as CountryId
    const parentHouseId = 'h-parent' as HouseId
    const cadetHouseId = 'h-cadet' as HouseId
    const headPersonId = 'pe-head' as PersonId

    const headPerson: Person = {
      id: headPersonId,
      name: 'Head',
      sex: 'male',
      age: 50,
      alive: true,
      houseId: parentHouseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown',
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 30,
    }

    const cadetHouse: House = {
      id: cadetHouseId,
      name: 'Cadet',
      active: true,
      countryId,
      provinceIds: [],
      memberIds: [],
      headId: headPersonId,
      cadetHouseIds: [],
      prestige: 30,
      cohesion: 50,
      loyaltyToCountry: 50,
      wealth: 50,
      seatProvinceId: '' as ProvinceId,
      parentHouseId: parentHouseId,
    }

    const parentHouse: House = {
      id: parentHouseId,
      name: 'Parent',
      active: true,
      countryId,
      provinceIds: [],
      memberIds: [headPersonId],
      headId: headPersonId,
      cadetHouseIds: [],
      prestige: 50,
      cohesion: 60,
      loyaltyToCountry: 70,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const country: Country = {
      id: countryId,
      name: 'C0',
      rulerHouseId: parentHouseId,
      houseIds: [parentHouseId, cadetHouseId],
      treasury: 100,
      legitimacy: 70,
      adminPower: 50,
      stability: 60,
      roleAssignments: {},
      active: true,
      capitalProvinceId: '' as ProvinceId,
    }

    const world: WorldState = {
      currentYear: 1,
      currentMonth: 1,
      provinces: {},
      countries: { [countryId]: country },
      houses: { [parentHouseId]: parentHouse, [cadetHouseId]: cadetHouse },
      persons: { [headPersonId]: headPerson },
      activePlots: {},
      popGroups: {},
    }

    const ctx = makeCtx(world)

    expect(() => runIntegrityCheck(ctx)).toThrow('missing cadet')
  })
})

function makeValidWorldState(): WorldState {
  const { world } = generateWorld('integrity-valid')
  return world
}
