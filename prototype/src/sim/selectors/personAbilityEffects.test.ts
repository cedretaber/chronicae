import { describe, expect, it } from 'vitest'
import {
  createPolityId,
  createHouseId,
  createOfficeAssignmentId,
  createPersonId,
  createProvinceId,
} from '../types/ids'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { Person } from '../types/person'
import type { Province } from '../types/province'
import type { Polity } from '../types/polity'
import type { House } from '../types/house'
import type { OfficeRole, OrganizationRef } from '../types/office'
import { defaultConfig } from '../config/defaultConfig'
import {
  normalizedStat,
  normalizedTrait,
  calcChancellorControlGrowthModifier,
  calcChancellorControlMaxBonus,
  calcTreasurerTaxEfficiency,
  calcGeneralWarPowerModifier,
  calcGeneralDeclareThreshold,
} from './personAbilityEffects'

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: createPersonId('pe', 0),
    nameKey: 'Test Person',
    sex: 'male',
    age: 30,
    alive: true,
    houseId: createHouseId('h', 0),
    childIds: [],
    birthStatus: 'unknown',
    abilities: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
    aptitudes: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 50,
    wealth: 0,
    attitudes: {},
    ...overrides,
  }
}

function makeOfficeAssignment(
  state: WorldState,
  organization: OrganizationRef,
  role: OfficeRole,
  holderPersonId: PersonId,
): PersonId {
  const id = createOfficeAssignmentId(state.nextOfficeAssignmentId)
  state.nextOfficeAssignmentId += 1
  state.officeAssignments[id] = {
    id,
    organization,
    role,
    holderPersonId,
    active: true,
    startYear: state.currentYear,
    unpaidCount: 0,
  }
  const key = `${organization.kind}:${organization.id}`
  if (!state.officeIndex.byOrganization[key]) {
    state.officeIndex.byOrganization[key] = []
  }
  state.officeIndex.byOrganization[key].push(id)
  if (!state.officeIndex.byHolderPerson[holderPersonId]) {
    state.officeIndex.byHolderPerson[holderPersonId] = []
  }
  state.officeIndex.byHolderPerson[holderPersonId].push(id)
  return holderPersonId
}

function makeWorldState(
  personOverrides: Partial<Person> = {},
  officeAssignments: Record<string, PersonId> = {},
  personId: PersonId = createPersonId('pe', 0),
): {
  state: WorldState
  polity: Polity
  house: House
  polity1Id: PolityId
  house1Id: HouseId
  personId: PersonId
  provinceId: ProvinceId
} {
  const polity1Id = createPolityId('c', 0)
  const house1Id = createHouseId('h', 0)
  const provinceId = createProvinceId('p', 0)

  const person = makePerson(personOverrides)
  const province = {
    id: provinceId,
    stateId: 'sr-0' as import('../types/ids').StateRegionId,
    nameKey: 'Test Province',
    x: 0,
    y: 0,
    neighbors: [],
    ownerHouseId: house1Id,
    polityId: polity1Id,
    terrain: 'plains',
    features: [],
    holdingIds: [],
  } as unknown as Province

  const state: WorldState = {
    currentYear: 1444,
    absoluteWeek: 69312,
    currentWeekOfYear: 1,
    provinces: {
      [provinceId]: province,
    },
    holdings: {},
    states: {},
    polities: {
      [polity1Id]: {
        id: polity1Id,
        nameKey: 'Polity 1',
        rank: 2,
        ownerHouseId: house1Id,
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: provinceId,
      },
    },
    houses: {
      [house1Id]: {
        id: house1Id,
        nameKey: 'House 1',
        active: true,
        memberIds: [personId],
        deceasedMemberIds: [],
        founderId: personId,
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: provinceId,
      },
    },
    persons: {
      [personId]: person,
    },
    livingPersonIds: [personId],
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    landContracts: {},
    holdingOfficeAssignments: {},
    holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
    landContractIndex: { byProvince: {}, byHolding: {}, byGranteePolity: {}, byParent: {} },
    holdingTerminalPolityCache: {},
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    holdingImprovements: {},
    holdingImprovementIndex: { byHolding: {} },
    nextHoldingImprovementId: 0,
    nextLandContractId: 0,
    nextHoldingOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    diplomaticPlays: {},
    diplomaticOffers: {},
    projects: {},
    projectIndex: {
      byOwner: {},
      byAim: {},
      byParentProject: {},
      byCreatorPerson: {},
      bySupervisorPerson: {},
      byRelatedEntity: {},
    },
    nextProjectId: 0,
    nextDiplomaticPlayId: 0,
    wars: {},
    warIndex: { byParticipant: {}, byOriginDiplomaticPlay: {} },
    regiments: {},
    regimentIndex: { byOwner: {}, byWar: {}, byHomeProvince: {}, byHomeHolding: {} },
    nextRegimentId: 0,
    battles: {},
    battleIndex: { byWar: {} },
    nextBattleId: 0,
    nextWarId: 0,
    nextDiplomaticOfferId: 0,
    pressures: {},
    pressureIndex: { byTarget: {}, bySource: {}, byDiplomaticPlay: {}, byProject: {} },
    nextPressureId: 1,
    // v0.22 Goal/Aim system
    goals: {},
    aims: {},
    decisionReasons: {},
    goalIndex: { byOwner: {} },
    aimIndex: { byOwner: {}, byGoal: {} },
    nextGoalId: 0,
    nextAimId: 0,
    nextDecisionReasonId: 0,
    tasks: {},
    taskIndex: { byAssignee: {}, byOwner: {}, byTarget: {} },
    personActivityLogs: {},
    personActivityLogIndex: { byPerson: {} },
    personTrainingExperience: {},
    waitingAimIds: [],
    nextTaskId: 0,
    nextPersonActivityLogId: 0,
    clans: {},
    nextClanId: 1,
    popIndex: { byHolding: {} },
    nextPopGroupId: 0,
  }
  const polity = state.polities[polity1Id]!
  const house = state.houses[house1Id]!

  // Apply office assignments
  const polityRef: OrganizationRef = { kind: 'polity', id: polity1Id }
  for (const [role, pid] of Object.entries(officeAssignments)) {
    makeOfficeAssignment(state, polityRef, role as OfficeRole, pid)
  }

  // Create a house leader office assignment so getHouseLeader works
  const houseRef: OrganizationRef = { kind: 'house', id: house1Id }
  makeOfficeAssignment(state, houseRef, 'leader', personId)

  return { state, polity, house, polity1Id, house1Id, personId, provinceId }
}

describe('normalizedStat', () => {
  it('returns -1 for value 0', () => {
    expect(normalizedStat(0)).toBe(-1)
  })

  it('returns 0 for value 5', () => {
    expect(normalizedStat(5)).toBe(0)
  })

  it('returns 1 for value 10', () => {
    expect(normalizedStat(10)).toBe(1)
  })
})

describe('normalizedTrait', () => {
  it('returns -0.5 for value 0.0', () => {
    expect(normalizedTrait(0.0)).toBe(-0.5)
  })

  it('returns 0 for value 0.5', () => {
    expect(normalizedTrait(0.5)).toBe(0)
  })

  it('returns 0.5 for value 1.0', () => {
    expect(normalizedTrait(1.0)).toBe(0.5)
  })
})

describe('calcChancellorControlGrowthModifier', () => {
  it('returns 1.25 with chancellor admin=10', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
        aptitudes: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
      },
      { administrator: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcChancellorControlGrowthModifier(state, polity.id, config)
    expect(result).toBe(1.25)
  })

  it('returns 1 with chancellor admin=5', () => {
    const { state, polity } = makeWorldState(
      {
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
      },
      { administrator: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcChancellorControlGrowthModifier(state, polity.id, config)
    expect(result).toBe(1)
  })

  it('returns 0.75 with chancellor admin=0', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: { valor: 50, command: 50, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
        aptitudes: { valor: 50, command: 50, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
      },
      { administrator: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcChancellorControlGrowthModifier(state, polity.id, config)
    expect(result).toBe(0.75)
  })

  it('returns 1 with no chancellor (vacant)', () => {
    const { state, polity } = makeWorldState()
    const config = { ...defaultConfig }
    const result = calcChancellorControlGrowthModifier(state, polity.id, config)
    expect(result).toBe(1)
  })

  it('returns 1 when personAbilityEffectsEnabled is false', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
        aptitudes: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
      },
      { administrator: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig, personAbilityEffectsEnabled: false }
    const result = calcChancellorControlGrowthModifier(state, polity.id, config)
    expect(result).toBe(1)
  })
})

describe('calcChancellorControlMaxBonus', () => {
  it('returns 5 with chancellor admin=10', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
        aptitudes: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
      },
      { administrator: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcChancellorControlMaxBonus(state, polity.id, config)
    expect(result).toBe(5)
  })

  it('returns 0 with chancellor admin=5', () => {
    const { state, polity } = makeWorldState(
      {
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
      },
      { administrator: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcChancellorControlMaxBonus(state, polity.id, config)
    expect(result).toBe(0)
  })

  it('returns -5 with chancellor admin=0', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: { valor: 50, command: 50, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
        aptitudes: { valor: 50, command: 50, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
      },
      { administrator: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcChancellorControlMaxBonus(state, polity.id, config)
    expect(result).toBe(-5)
  })

  it('returns 0 when personAbilityEffectsEnabled is false', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
        aptitudes: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
      },
      { administrator: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig, personAbilityEffectsEnabled: false }
    const result = calcChancellorControlMaxBonus(state, polity.id, config)
    expect(result).toBe(0)
  })
})

describe('calcTreasurerTaxEfficiency', () => {
  it('returns 1.2 with treasurer admin=10, caution=1.0 (clamped)', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
        aptitudes: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
        traits: { ambition: 0.5, caution: 1.0 },
      },
      { treasurer: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcTreasurerTaxEfficiency(state, polity.id, config)
    expect(result).toBe(1.2)
  })

  it('returns 1.0 with treasurer admin=5, caution=0.5', () => {
    const { state, polity } = makeWorldState(
      {
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
      },
      { treasurer: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcTreasurerTaxEfficiency(state, polity.id, config)
    expect(result).toBe(1.0)
  })

  it('returns 0.8 with treasurer admin=0, caution=0.0 (clamped)', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: { valor: 50, command: 50, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
        aptitudes: { valor: 50, command: 50, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
        traits: { ambition: 0.5, caution: 0.0 },
      },
      { treasurer: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcTreasurerTaxEfficiency(state, polity.id, config)
    expect(result).toBe(0.8)
  })

  it('returns 1.0 with no treasurer', () => {
    const { state, polity } = makeWorldState()
    const config = { ...defaultConfig }
    const result = calcTreasurerTaxEfficiency(state, polity.id, config)
    expect(result).toBe(1.0)
  })

  it('returns 1.0 when personAbilityEffectsEnabled is false', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
        aptitudes: {
          valor: 50,
          command: 50,
          numeracy: 100,
          learning: 100,
          charisma: 100,
          insight: 100,
        },
        traits: { ambition: 0.5, caution: 1.0 },
      },
      { treasurer: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig, personAbilityEffectsEnabled: false }
    const result = calcTreasurerTaxEfficiency(state, polity.id, config)
    expect(result).toBe(1.0)
  })
})

describe('calcGeneralWarPowerModifier', () => {
  it('returns 1.15 with general martial=10', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: {
          valor: 100,
          command: 100,
          numeracy: 50,
          learning: 100,
          charisma: 50,
          insight: 100,
        },
        aptitudes: {
          valor: 100,
          command: 100,
          numeracy: 50,
          learning: 100,
          charisma: 50,
          insight: 100,
        },
      },
      { military: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcGeneralWarPowerModifier(state, polity.id, config)
    expect(result).toBe(1.15)
  })

  it('returns 1 with general martial=5', () => {
    const { state, polity } = makeWorldState(
      {
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
      },
      { military: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcGeneralWarPowerModifier(state, polity.id, config)
    expect(result).toBe(1)
  })

  it('returns 0.85 with general martial=0', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: { valor: 0, command: 0, numeracy: 50, learning: 0, charisma: 50, insight: 0 },
        aptitudes: { valor: 0, command: 0, numeracy: 50, learning: 0, charisma: 50, insight: 0 },
      },
      { military: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcGeneralWarPowerModifier(state, polity.id, config)
    expect(result).toBe(0.85)
  })

  it('returns 1 with no general', () => {
    const { state, polity } = makeWorldState()
    const config = { ...defaultConfig }
    const result = calcGeneralWarPowerModifier(state, polity.id, config)
    expect(result).toBe(1)
  })

  it('returns 1 when personAbilityEffectsEnabled is false', () => {
    const { state, polity } = makeWorldState(
      {
        abilities: {
          valor: 100,
          command: 100,
          numeracy: 50,
          learning: 100,
          charisma: 50,
          insight: 100,
        },
        aptitudes: {
          valor: 100,
          command: 100,
          numeracy: 50,
          learning: 100,
          charisma: 50,
          insight: 100,
        },
      },
      { military: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig, personAbilityEffectsEnabled: false }
    const result = calcGeneralWarPowerModifier(state, polity.id, config)
    expect(result).toBe(1)
  })
})

describe('calcGeneralDeclareThreshold', () => {
  it('returns 0.40 with general ambition=1.0, caution=0.5', () => {
    const { state, polity } = makeWorldState(
      { traits: { ambition: 1.0, caution: 0.5 } },
      { military: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcGeneralDeclareThreshold(state, polity.id, config)
    expect(result).toBe(0.4)
  })

  it('returns 0.50 with general ambition=0.5, caution=1.0', () => {
    const { state, polity } = makeWorldState(
      { traits: { ambition: 0.5, caution: 1.0 } },
      { military: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig }
    const result = calcGeneralDeclareThreshold(state, polity.id, config)
    expect(result).toBe(0.5)
  })

  it('returns 0.45 with no general', () => {
    const { state, polity } = makeWorldState()
    const config = { ...defaultConfig }
    const result = calcGeneralDeclareThreshold(state, polity.id, config)
    expect(result).toBe(0.45)
  })

  it('returns 0.45 when personAbilityEffectsEnabled is false', () => {
    const { state, polity } = makeWorldState(
      { traits: { ambition: 1.0, caution: 0.5 } },
      { military: createPersonId('pe', 0) },
    )
    const config = { ...defaultConfig, personAbilityEffectsEnabled: false }
    const result = calcGeneralDeclareThreshold(state, polity.id, config)
    expect(result).toBe(0.45)
  })
})
