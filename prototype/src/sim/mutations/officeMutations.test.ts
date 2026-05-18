import { describe, expect, it } from 'vitest'
import {
  createPolityId,
  createHouseId,
  createPersonId,
  createOfficeAssignmentId,
} from '../types/ids'
import type { PolityId, HouseId, PersonId, OfficeAssignmentId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { expireOfficeTermAssignment } from './officeMutations'
import { ANONYMOUS_HOUSE_ID } from '../types/landContract'

function makeOfficeState(): {
  state: WorldState
  officeId: OfficeAssignmentId
  holderId: PersonId
  houseId: HouseId
  polityId: PolityId
} {
  const polityId = createPolityId('c', 10)
  const houseId = createHouseId('h', 10)
  const holderId = createPersonId('pe', 10)
  const officeId = createOfficeAssignmentId(10)

  const anon = {
    id: ANONYMOUS_HOUSE_ID,
    name: 'Anonymous',
    active: true,
    kind: 'system' as const,
    memberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId: 'pr-anon' as ProvinceId,
  }
  const state: WorldState = {
    currentYear: 1450,
    currentMonth: 1,
    provinces: {},
    polities: {
      [polityId]: {
        id: polityId,
        name: 'C',
        rank: 2,
        treasury: 0,
        adminPower: 0,
        legacyPrestige: 0,
        active: true,
        capitalProvinceId: 'pr-0' as ProvinceId,
        ownerHouseId: houseId,
      },
    },
    houses: {
      [ANONYMOUS_HOUSE_ID]: anon,
      [houseId]: {
        id: houseId,
        name: 'H',
        active: true,
        memberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 0,
        wealth: 0,
        seatProvinceId: 'pr-0' as ProvinceId,
      },
    },
    persons: {
      [holderId]: {
        id: holderId,
        name: 'Holder',
        sex: 'male',
        age: 30,
        alive: true,
        houseId,
        childIds: [],
        birthStatus: 'legitimate',
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
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {
      [officeId]: {
        id: officeId,
        organization: { kind: 'polity' as const, id: polityId },
        role: 'administrator' as const,
        holderPersonId: holderId,
        active: true,
        startYear: 1440,
        unpaidCount: 0,
      },
    },
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: {
      byOrganization: { [`polity:${polityId}`]: [officeId] },
      byHolderPerson: { [holderId as string]: [officeId] },
    },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 11,
    landContracts: {},
    provinceOfficeAssignments: {},
    landContractIndex: { byProvince: {}, byGranteePolity: {}, byParent: {} },
    provinceTerminalPolityCache: {},
    provinceOfficeIndex: { byProvince: {}, byHolderPerson: {}, byAppointingPolity: {} },
    polityIndex: { byOwnerHouse: { [houseId]: [polityId] } },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    nextLandContractId: 0,
    nextProvinceOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
  }
  return { state, officeId, holderId, houseId, polityId }
}

describe('expireOfficeTermAssignment', () => {
  it('active office → active = false', () => {
    const { state, officeId } = makeOfficeState()
    const result = expireOfficeTermAssignment(state, officeId)
    expect(result.officeAssignments[officeId]!.active).toBe(false)
  })

  it('already inactive → unchanged', () => {
    const { state, officeId } = makeOfficeState()
    const first = expireOfficeTermAssignment(state, officeId)
    expect(first.officeAssignments[officeId]!.active).toBe(false)
    const second = expireOfficeTermAssignment(first, officeId)
    expect(second).toBe(first)
  })

  it('missing office → unchanged', () => {
    const { state } = makeOfficeState()
    const missingId = createOfficeAssignmentId(99)
    const result = expireOfficeTermAssignment(state, missingId)
    expect(result).toBe(state)
  })
})
