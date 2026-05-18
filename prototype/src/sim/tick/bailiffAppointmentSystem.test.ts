import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { ProvinceOfficeAssignmentId } from '../types/ids'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext, toResult } from './context'
import { runBailiffAppointmentSystem } from './bailiffAppointmentSystem'
import type { SimEvent } from '../types/event'
import {
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
  bindProvinceToPolity,
} from '../testFixtures'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makeBaseState(): {
  state: WorldState
  polityId: PolityId
  houseId: HouseId
  provinceId: ProvinceId
  rulerId: PersonId
} {
  const polityId = createPolityId('c', 0)
  const houseId = createHouseId('h', 0)
  const provinceId = createProvinceId('p', 0)
  const rulerId = createPersonId('pe', 0)

  let s = makeEmptyV016State()
  s = { ...s, currentYear: 1444, currentMonth: 1 }
  s = withProvince(s, provinceId, { name: 'P0', development: 10 })
  s = withHouse(s, houseId, {
    name: 'Test House',
    memberIds: [rulerId],
    legacyPrestige: 50,
    seatProvinceId: provinceId,
  })
  s = withPolity(s, polityId, {
    name: 'Test Polity',
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceId,
  })
  s = bindProvinceToPolity(s, provinceId, polityId)
  s = withPerson(s, rulerId, {
    name: 'Ruler',
    houseId,
    birthStatus: 'unknown',
    traits: { ambition: 0.3, caution: 0.5 },
    legacyPrestige: 30,
  })

  return { state: s, polityId, houseId, provinceId, rulerId }
}

function countEvents(events: readonly SimEvent[], type: string): number {
  return events.filter((e) => e.type === type).length
}

describe('runBailiffAppointmentSystem', () => {
  it('vacates bailiff whose term has expired (startYear = currentYear - 3)', () => {
    const { state: baseState, houseId, provinceId } = makeBaseState()
    // Set month so absMonth % 6 === 0 (bailiffAppointmentInterval)
    const s: WorldState = { ...baseState, currentMonth: 6 }

    const bailiffId = createPersonId('pe', 10)
    const stateWithBailiff = withPerson(s, bailiffId, {
      name: 'Bailiff',
      age: 30,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.2, caution: 0.5 },
      legacyPrestige: 20,
      abilities: DEFAULT_ABILITIES,
    })

    // Install a non-placeholder bailiff with startYear = currentYear - 3
    const officeId = stateWithBailiff.provinceOfficeIndex.byProvince[
      provinceId
    ] as ProvinceOfficeAssignmentId
    const office = stateWithBailiff.provinceOfficeAssignments[officeId]
    if (!officeId || !office) throw new Error('no bailiff office found')

    const updatedState: WorldState = {
      ...stateWithBailiff,
      provinceOfficeAssignments: {
        ...stateWithBailiff.provinceOfficeAssignments,
        [officeId]: {
          ...office,
          holderPersonId: bailiffId,
          startYear: stateWithBailiff.currentYear - 3,
        },
      },
      provinceOfficeIndex: {
        ...stateWithBailiff.provinceOfficeIndex,
        byHolderPerson: {
          ...stateWithBailiff.provinceOfficeIndex.byHolderPerson,
          [bailiffId]: [officeId],
        },
      },
    }

    const ctx = createTickContext({
      state: updatedState,
      rng: createRng('test'),
      config: defaultConfig,
    })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    // Bailiff should be vacated and placeholder installed
    expect(countEvents(result.events, 'BAILIFF_VACATED')).toBeGreaterThan(0)
    expect(countEvents(result.events, 'BAILIFF_PLACEHOLDER_INSTALLED')).toBeGreaterThan(0)
  })

  it('does NOT vacate bailiff whose term has not expired (startYear = currentYear)', () => {
    const { state: baseState, houseId, provinceId } = makeBaseState()
    const bailiffId = createPersonId('pe', 10)

    const stateWithBailiff = withPerson(baseState, bailiffId, {
      name: 'Bailiff',
      age: 30,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.2, caution: 0.5 },
      legacyPrestige: 20,
      abilities: DEFAULT_ABILITIES,
    })

    // Install a bailiff with startYear = currentYear (not expired yet)
    const officeId = stateWithBailiff.provinceOfficeIndex.byProvince[
      provinceId
    ] as ProvinceOfficeAssignmentId
    const office = stateWithBailiff.provinceOfficeAssignments[officeId]
    if (!officeId || !office) throw new Error('no bailiff office found')

    const updatedState: WorldState = {
      ...stateWithBailiff,
      provinceOfficeAssignments: {
        ...stateWithBailiff.provinceOfficeAssignments,
        [officeId]: {
          ...office,
          holderPersonId: bailiffId,
          startYear: stateWithBailiff.currentYear,
        },
      },
      provinceOfficeIndex: {
        ...stateWithBailiff.provinceOfficeIndex,
        byHolderPerson: {
          ...stateWithBailiff.provinceOfficeIndex.byHolderPerson,
          [bailiffId]: [officeId],
        },
      },
    }

    const ctx = createTickContext({
      state: updatedState,
      rng: createRng('test'),
      config: defaultConfig,
    })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    // Bailiff should NOT be vacated (term not expired)
    expect(countEvents(result.events, 'BAILIFF_VACATED')).toBe(0)
    expect(countEvents(result.events, 'BAILIFF_PLACEHOLDER_INSTALLED')).toBe(0)
  })

  it('does NOT vacate placeholder bailiff by term', () => {
    const { state: baseState, provinceId } = makeBaseState()

    const officeId = baseState.provinceOfficeIndex.byProvince[
      provinceId
    ] as ProvinceOfficeAssignmentId
    const office = baseState.provinceOfficeAssignments[officeId]
    if (!officeId || !office) throw new Error('no bailiff office found')

    // Placeholder bailiff (holder starts with 'pe-anon')
    const placeholderId = 'pe-anon-placeholder' as PersonId
    const updatedState: WorldState = {
      ...baseState,
      provinceOfficeAssignments: {
        ...baseState.provinceOfficeAssignments,
        [officeId]: {
          ...office,
          holderPersonId: placeholderId,
          startYear: baseState.currentYear - 10,
        },
      },
      provinceOfficeIndex: {
        ...baseState.provinceOfficeIndex,
        byHolderPerson: {
          ...baseState.provinceOfficeIndex.byHolderPerson,
          [placeholderId]: [officeId],
        },
      },
    }

    const ctx = createTickContext({
      state: updatedState,
      rng: createRng('test'),
      config: defaultConfig,
    })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    // Placeholder should NOT be vacated by term
    expect(countEvents(result.events, 'BAILIFF_VACATED')).toBe(0)
    expect(countEvents(result.events, 'BAILIFF_PLACEHOLDER_INSTALLED')).toBe(0)
  })
})
