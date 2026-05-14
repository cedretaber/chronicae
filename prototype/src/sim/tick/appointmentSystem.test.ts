import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext, toResult } from './context'
import { runAppointmentSystem } from './appointmentSystem'
import type { SimEvent } from '../types/event'

function makeBaseState(): {
  state: WorldState
  countryId: CountryId
  houseRulerId: HouseId
  houseVassalId: HouseId
  personRulerId: PersonId
  personVassalId: PersonId
} {
  const countryId = createCountryId('c', 0)
  const houseRulerId = createHouseId('h', 0)
  const houseVassalId = createHouseId('h', 1)
  const personRulerId = createPersonId('pe', 0)
  const personVassalId = createPersonId('pe', 1)

  const state: WorldState = {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {},
    countries: {
      [countryId]: {
        id: countryId,
        name: 'Country 1',
        rulerHouseId: houseRulerId,
        houseIds: [houseRulerId, houseVassalId],
        treasury: 100,
        legitimacy: 80,
        adminPower: 10,
        stability: 0,
        roleAssignments: {},
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [houseRulerId]: {
        id: houseRulerId,
        name: 'Ruler House',
        active: true,
        countryId,
        provinceIds: [],
        memberIds: [personRulerId],
        headId: personRulerId,
        prestige: 50,
        cohesion: 50,
        loyaltyToCountry: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
      [houseVassalId]: {
        id: houseVassalId,
        name: 'Vassal House',
        active: true,
        countryId,
        provinceIds: [],
        memberIds: [personVassalId],
        headId: personVassalId,
        prestige: 50,
        cohesion: 50,
        loyaltyToCountry: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [personRulerId]: {
        id: personRulerId,
        name: 'Ruler Person',
        age: 30,
        alive: true,
        houseId: houseRulerId,
        countryId,
        stats: { admin: 7, martial: 5 },
        traits: { ambition: 0.3, loyaltyToCountry: 0.8, caution: 0.5 },
        prestige: 30,
      },
      [personVassalId]: {
        id: personVassalId,
        name: 'Vassal Person',
        age: 35,
        alive: true,
        houseId: houseVassalId,
        countryId,
        stats: { admin: 9, martial: 6 },
        traits: { ambition: 0.2, loyaltyToCountry: 0.9, caution: 0.6 },
        prestige: 40,
      },
    },
    activePlots: {},
  }

  return {
    state,
    countryId,
    houseRulerId,
    houseVassalId,
    personRulerId,
    personVassalId,
  }
}

function buildCtx(state: WorldState, config: SimulationConfig) {
  return createTickContext({ state, rng: createRng('test'), config })
}

function countEvents(events: readonly SimEvent[], type: string): number {
  return events.filter((e) => e.type === type).length
}

describe('runAppointmentSystem', () => {
  it('appoints best candidate to vacant role', () => {
    const { state, countryId, personVassalId } = makeBaseState()
    const config = { ...defaultConfig }
    const ctx = buildCtx(state, config)

    const result = toResult(runAppointmentSystem(ctx))

    const country = result.state.countries[countryId]!
    // p-1 has higher chancellorScore (100 > 78), so p-1 gets chancellor
    expect(country.roleAssignments.chancellor).toBe(personVassalId)
    // System also assigns general to p-0 (only candidate after chancellor is taken)
    expect(countEvents(result.events, 'ROLE_ASSIGNED')).toBe(2)
  })

  it('does not replace current holder when score diff < replacementThreshold', () => {
    const { state, countryId, personRulerId } = makeBaseState()
    const stateWithRole: WorldState = {
      ...state,
      countries: {
        ...state.countries,
        [countryId]: {
          ...state.countries[countryId],
          roleAssignments: { chancellor: personRulerId },
        },
      },
    }
    const config = { ...defaultConfig, replacementThreshold: 30 }
    const ctx = buildCtx(stateWithRole, config)

    const result = toResult(runAppointmentSystem(ctx))

    const country = result.state.countries[countryId]!
    expect(country.roleAssignments.chancellor).toBe(personRulerId)
    expect(countEvents(result.events, 'ROLE_ASSIGNED')).toBe(1)
    expect(countEvents(result.events, 'ROLE_REVOKED')).toBe(0)
  })

  it('replaces current holder on January when score diff >= replacementThreshold', () => {
    const { state, countryId, personRulerId, personVassalId } = makeBaseState()
    const stateWithRole: WorldState = {
      ...state,
      countries: {
        ...state.countries,
        [countryId]: {
          ...state.countries[countryId],
          roleAssignments: { chancellor: personRulerId },
        },
      },
    }
    const config = { ...defaultConfig, replacementThreshold: 20 }
    const ctx = buildCtx(stateWithRole, config)

    const result = toResult(runAppointmentSystem(ctx))

    const country = result.state.countries[countryId]!
    expect(country.roleAssignments.chancellor).toBe(personVassalId)
    expect(countEvents(result.events, 'ROLE_REVOKED')).toBe(1)
    // ROLE_ASSIGNED for chancellor replacement + ROLE_ASSIGNED for general (p-0)
    expect(countEvents(result.events, 'ROLE_ASSIGNED')).toBe(2)
  })

  it('does not replace on months other than January', () => {
    const { state, countryId, personRulerId } = makeBaseState()
    const stateWithRole: WorldState = {
      ...state,
      currentMonth: 2,
      countries: {
        ...state.countries,
        [countryId]: {
          ...state.countries[countryId],
          roleAssignments: { chancellor: personRulerId },
        },
      },
    }
    const config = { ...defaultConfig, replacementThreshold: 20 }
    const ctx = buildCtx(stateWithRole, config)

    const result = toResult(runAppointmentSystem(ctx))

    const country = result.state.countries[countryId]!
    expect(country.roleAssignments.chancellor).toBe(personRulerId)
    // p-1 gets general (only candidate since p-0 has chancellor)
    expect(countEvents(result.events, 'ROLE_ASSIGNED')).toBe(1)
    expect(countEvents(result.events, 'ROLE_REVOKED')).toBe(0)
  })

  it('revokes dead person role and appoints new person', () => {
    const { state, countryId, personRulerId, personVassalId } = makeBaseState()
    const stateWithRole: WorldState = {
      ...state,
      countries: {
        ...state.countries,
        [countryId]: {
          ...state.countries[countryId],
          roleAssignments: { chancellor: personRulerId },
        },
      },
      persons: {
        ...state.persons,
        [personRulerId]: { ...state.persons[personRulerId]!, alive: false },
      },
    }
    const config = { ...defaultConfig }
    const ctx = buildCtx(stateWithRole, config)

    const result = toResult(runAppointmentSystem(ctx))

    const country = result.state.countries[countryId]!
    expect(country.roleAssignments.chancellor).toBe(personVassalId)
    // Dead person revocation does not emit ROLE_REVOKED event (only replacement does)
    expect(countEvents(result.events, 'ROLE_REVOKED')).toBe(0)
    // p-1 gets chancellor (only alive candidate)
    expect(countEvents(result.events, 'ROLE_ASSIGNED')).toBe(1)
  })
})
