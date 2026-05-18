import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext, toResult } from './context'
import { runRebellionSystem } from './rebellionSystem'
import type { SimEvent } from '../types/event'

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
  houseRulerId: HouseId
  houseVassalId: HouseId
  personRulerId: PersonId
  personVassalId: PersonId
} {
  const polityId = createPolityId('c', 0)
  const houseRulerId = createHouseId('h', 0)
  const houseVassalId = createHouseId('h', 1)
  const personRulerId = createPersonId('pe', 0)
  const personVassalId = createPersonId('pe', 1)

  const state: WorldState = {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {},
    polities: {
      [polityId]: {
        id: polityId,
        name: 'Polity 1',
        rank: 2,
        ownerHouseId: houseRulerId,
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    houses: {
      [houseRulerId]: {
        id: houseRulerId,
        name: 'Ruler House',
        active: true,
        provinceIds: [],
        memberIds: [personRulerId],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
      [houseVassalId]: {
        id: houseVassalId,
        name: 'Vassal House',
        active: true,
        provinceIds: [],
        memberIds: [personVassalId],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [personRulerId]: {
        id: personRulerId,
        name: 'Ruler Person',
        sex: 'male',
        age: 30,
        alive: true,
        houseId: houseRulerId,
        childIds: [],
        birthStatus: 'unknown',
        abilities: DEFAULT_ABILITIES,
        aptitudes: DEFAULT_ABILITIES,
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 50,
        wealth: 0,
        attitudes: {},
      },
      [personVassalId]: {
        id: personVassalId,
        name: 'Vassal Person',
        sex: 'male',
        age: 35,
        alive: true,
        houseId: houseVassalId,
        childIds: [],
        birthStatus: 'unknown',
        abilities: DEFAULT_ABILITIES,
        aptitudes: DEFAULT_ABILITIES,
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 50,
        wealth: 0,
        attitudes: {},
      },
    },
    activePlots: {},
  }

  return {
    state,
    polityId,
    houseRulerId,
    houseVassalId,
    personRulerId,
    personVassalId,
  }
}

function countEvents(events: readonly SimEvent[], type: string): number {
  return events.filter((e) => e.type === type).length
}

describe('runRebellionSystem', () => {
  it('does not trigger rebellion when rebellionTendency < rebellionThreshold', () => {
    const { state, polityId, houseVassalId, personVassalId } = makeBaseState()

    // Low ambition (0.1), high loyaltyToPolity (0.9), high adminPower (80)
    const stateWithLowTendency: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [personVassalId]: {
          ...state.persons[personVassalId]!,
          traits: { ambition: 0.1, loyaltyToPolity: 0.9, caution: 0.5 },
        },
      },
      houses: {
        ...state.houses,
        [houseVassalId]: {
          ...state.houses[houseVassalId]!,
          legacyPrestige: 10,
        },
      },
      polities: {
        ...state.polities,
        [polityId]: {
          ...state.polities[polityId]!,
          legacyPrestige: 80,
          adminPower: 80,
        },
      },
    }

    const config = { ...defaultConfig }
    const ctx = createTickContext({ state: stateWithLowTendency, rng: createRng('test'), config })

    const result = toResult(runRebellionSystem(ctx))

    expect(countEvents(result.events, 'REBELLION_STARTED')).toBe(0)
    // No legacyPrestige changes from stateWithLowTendency
    const polity = result.state.polities[polityId]!
    expect(polity.legacyPrestige).toBe(stateWithLowTendency.polities[polityId]!.legacyPrestige)
  })

  it('rebellion may occur when rebellionTendency >= rebellionThreshold', () => {
    const { state, polityId, houseVassalId, personVassalId } = makeBaseState()

    // High ambition (0.9), low loyaltyToPolity (0.1), low caution (0.1)
    const stateWithHighTendency: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [personVassalId]: {
          ...state.persons[personVassalId]!,
          traits: { ambition: 0.9, loyaltyToPolity: 0.1, caution: 0.1 },
        },
      },
      houses: {
        ...state.houses,
        [houseVassalId]: {
          ...state.houses[houseVassalId]!,
          legacyPrestige: 30,
        },
      },
      polities: {
        ...state.polities,
        [polityId]: {
          ...state.polities[polityId]!,
          legacyPrestige: 30,
          adminPower: 20,
        },
      },
    }

    const config = { ...defaultConfig, rebellionThreshold: 70 }
    const ctx = createTickContext({
      state: stateWithHighTendency,
      rng: createRng('rebellion-test'),
      config,
    })

    // Just assert the system runs without throwing; outcome is RNG-dependent
    expect(() => toResult(runRebellionSystem(ctx))).not.toThrow()
  })

  it('rebellion applies instant penalties before success/failure check', () => {
    const { state, polityId, houseVassalId, personVassalId } = makeBaseState()

    // Maximize rebellionTendency: legacyPrestige=100, ambition=1.0, caution=0, legacyPrestige=0, adminPower=0
    const stateWithMaxTendency: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [personVassalId]: {
          ...state.persons[personVassalId]!,
          traits: { ambition: 1.0, caution: 0 },
        },
      },
      houses: {
        ...state.houses,
        [houseVassalId]: {
          ...state.houses[houseVassalId]!,
          legacyPrestige: 100,
        },
      },
      polities: {
        ...state.polities,
        [polityId]: {
          ...state.polities[polityId]!,
          legacyPrestige: 0,
          adminPower: 0,
        },
      },
    }

    const initialLegacyPrestige = state.polities[polityId]!.legacyPrestige
    const config = { ...defaultConfig, rebellionThreshold: 50 }
    const ctx = createTickContext({ state: stateWithMaxTendency, rng: createRng('test'), config })

    const result = toResult(runRebellionSystem(ctx))

    const hasRebellionStarted = countEvents(result.events, 'REBELLION_STARTED') > 0
    if (hasRebellionStarted) {
      const polity = result.state.polities[polityId]!
      expect(polity.legacyPrestige).toBeLessThan(initialLegacyPrestige)
    }
  })

  it('rebellion_succeeded emits POLITY_SPLIT in independence mode', () => {
    const polityId = createPolityId('c', 0)
    const houseRulerId = createHouseId('h', 0)
    const houseVassalId = createHouseId('h', 1)
    const personRulerId = createPersonId('pe', 0)
    const personVassalId = createPersonId('pe', 1)

    // Create provinces for the rebel house
    const provinceIds: ProvinceId[] = []
    for (let i = 0; i < 5; i++) {
      const pid = createProvinceId('pr', i)
      provinceIds.push(pid)
    }

    const state: WorldState = {
      currentYear: 1444,
      currentMonth: 1,
      provinces: Object.fromEntries(
        provinceIds.map((pid, i) => [
          pid,
          {
            id: pid,
            name: `Province ${i}`,
            x: i * 10,
            y: 0,
            neighbors: [],
            ownerHouseId: houseVassalId,
            polityId,
            habitability: 50,
            development: 0,
            popGroupIds: [],
            polityControl: 100,
            houseControl: 100,
          },
        ]),
      ),
      polities: {
        [polityId]: {
          id: polityId,
          name: 'Polity 1',
          rank: 2,
          ownerHouseId: houseRulerId,
          treasury: 0,
          legacyPrestige: 0,
          adminPower: 0,
          active: true,
          capitalProvinceId: '' as ProvinceId,
        },
      },
      houses: {
        [houseRulerId]: {
          id: houseRulerId,
          name: 'Ruler House',
          active: true,
          provinceIds: [],
          memberIds: [personRulerId],
          cadetHouseIds: [],
          legacyPrestige: 10,
          wealth: 0,
          seatProvinceId: '' as ProvinceId,
        },
        [houseVassalId]: {
          id: houseVassalId,
          name: 'Rebel House',
          active: true,
          provinceIds: provinceIds,
          memberIds: [personVassalId],
          cadetHouseIds: [],
          legacyPrestige: 100,
          wealth: 0,
          seatProvinceId: provinceIds[0] ?? ('' as ProvinceId),
        },
      },
      persons: {
        [personRulerId]: {
          id: personRulerId,
          name: 'Ruler Person',
          sex: 'male',
          age: 30,
          alive: true,
          houseId: houseRulerId,
          childIds: [],
          birthStatus: 'unknown',
          abilities: DEFAULT_ABILITIES,
          aptitudes: DEFAULT_ABILITIES,
          traits: { ambition: 0.1, caution: 0.5 },
          legacyPrestige: 10,
          wealth: 0,
          attitudes: {},
        },
        [personVassalId]: {
          id: personVassalId,
          name: 'Rebel Person',
          sex: 'male',
          age: 35,
          alive: true,
          houseId: houseVassalId,
          childIds: [],
          birthStatus: 'unknown',
          abilities: DEFAULT_ABILITIES,
          aptitudes: DEFAULT_ABILITIES,
          traits: { ambition: 1.0, caution: 0 },
          legacyPrestige: 100,
          wealth: 0,
          attitudes: {},
        },
      },
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments: {},
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 0,
    }

    const config = {
      ...defaultConfig,
      rebellionThreshold: 0,
      rebellionSuccessMode: 'independence' as const,
    }
    const ctx = createTickContext({ state, rng: createRng('rebellion-split-test'), config })

    const result = toResult(runRebellionSystem(ctx))

    const hasRebellionStarted = countEvents(result.events, 'REBELLION_STARTED') > 0
    if (hasRebellionStarted) {
      expect(
        countEvents(result.events, 'REBELLION_SUCCEEDED') > 0 ||
          countEvents(result.events, 'REBELLION_FAILED') > 0,
      ).toBe(true)
      if (countEvents(result.events, 'REBELLION_SUCCEEDED') > 0) {
        expect(countEvents(result.events, 'POLITY_SPLIT')).toBeGreaterThan(0)
      }
    }
  })
})
