import { describe, it, expect } from 'vitest'
import type { SimEvent } from '../types/event'
import type {
  PolityId,
  HouseId,
  PersonId,
  EventId,
  FactionId,
  FactionMembershipId,
} from '../types/ids'
import { createPolityId } from '../types/ids'
import type { Faction, FactionMembership } from '../types/faction'
import { nameParam } from '../types/event'
import { defaultConfig } from '../config/defaultConfig'
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
} from '../testFixtures'
import { buildActivityReport } from './activityReport'

import type { EventEntityRef, EventMessageParams } from '../types/event'

function makeEvent(
  id: number,
  year: number,
  type: SimEvent['type'],
  _summary: string,
  actors: PersonId[],
  houses: HouseId[],
  polities: PolityId[],
  extra?: { messageParams?: EventMessageParams; entityRefs?: EventEntityRef[] },
): SimEvent {
  const refs: EventEntityRef[] = extra?.entityRefs ?? [
    ...actors.map((pid) => ({ kind: 'person' as const, id: pid })),
    ...houses.map((hid) => ({ kind: 'house' as const, id: hid })),
    ...polities.map((pid) => ({ kind: 'polity' as const, id: pid })),
  ]
  return {
    id: `e-${year}-${id}` as EventId,
    year,
    weekOfYear: 1,
    type,
    importance: 'minor',
    messageKey: `test.${type.toLowerCase()}`,
    messageParams: extra?.messageParams ?? {},
    entityRefs: refs,
    reasons: [],
    effects: [],
  }
}

describe('buildActivityReport', () => {
  it('aggregates office churn, faction lifecycle, bailiff, and population', () => {
    // ---- World setup ----
    const polityId = 'dp-0' as PolityId
    const ownerHouseId = 'dh-0' as HouseId
    const outsiderHouseId = 'dh-1' as HouseId
    const rulerId = 'pe-0' as PersonId
    const adminPid = 'pe-1' as PersonId
    const factionLeaderId = 'pe-2' as PersonId
    const factionMemberId = 'pe-3' as PersonId
    const provinceId = 'pr-0' as import('../types/ids').ProvinceId

    let state = makeEmptyV016State()
    state = { ...state, currentYear: 1100, currentWeekOfYear: 12, absoluteWeek: 57211 }
    state = withProvince(state, provinceId)
    state = withHouse(state, ownerHouseId, {
      nameKey: 'OwnerHouse',
      memberIds: [rulerId, adminPid],
    })
    state = withHouse(state, outsiderHouseId, {
      nameKey: 'OutsiderHouse',
      memberIds: [factionLeaderId, factionMemberId],
    })
    state = withPolity(state, polityId, {
      ownerHouseId,
      capitalProvinceId: provinceId,
    })
    state = bindProvinceToHouseViaPolity(state, provinceId, polityId, ownerHouseId)
    state = withPerson(state, rulerId, { nameKey: 'Ruler', houseId: ownerHouseId })
    state = withPerson(state, adminPid, { nameKey: 'Admin', houseId: ownerHouseId })
    state = withPerson(state, factionLeaderId, { nameKey: 'FLeader', houseId: outsiderHouseId })
    state = withPerson(state, factionMemberId, { nameKey: 'FMember', houseId: outsiderHouseId })

    // Faction + memberships
    const factionId = 'f-0' as FactionId
    const faction: Faction = {
      id: factionId,
      leaderPersonId: factionLeaderId,
      polityId: createPolityId('c', 0),
      active: true,
      foundingWeek: 50400, // 1050 * WEEKS_PER_YEAR(48) → foundedYear 1050
    }
    const leaderMembershipId = 'fm-0' as FactionMembershipId
    const memberMembershipId = 'fm-1' as FactionMembershipId
    const leaderMembership: FactionMembership = {
      id: leaderMembershipId,
      factionId,
      personId: factionLeaderId,
      active: true,
      joinedWeek: 54600,
      lastActiveWeek: 54600,
    }
    const memberMembership: FactionMembership = {
      id: memberMembershipId,
      factionId,
      personId: factionMemberId,
      active: true,
      joinedWeek: 55120,
      lastActiveWeek: 55120,
    }
    state = {
      ...state,
      factions: { ...state.factions, [factionId]: faction },
      factionMemberships: {
        ...state.factionMemberships,
        [leaderMembershipId]: leaderMembership,
        [memberMembershipId]: memberMembership,
      },
      factionIndex: {
        byParent: {},
        byLeader: { ...state.factionIndex.byLeader, [factionLeaderId]: [factionId] },
        byPolity: { ...state.factionIndex.byPolity, [createPolityId('c', 0)]: [factionId] },
        byMember: {
          ...state.factionIndex.byMember,
          [factionLeaderId]: [leaderMembershipId],
          [factionMemberId]: [memberMembershipId],
        },
      },
      nextFactionId: 1,
      nextFactionMembershipId: 2,
      diplomaticPlays: {},
      nextDiplomaticPlayId: 0,
    }

    // ---- Events stream ----
    const events: SimEvent[] = [
      // Polity Office: admin assigned (ownerHouse member), then term ended
      makeEvent(
        1,
        1050,
        'OFFICE_ASSIGNED',
        'Admin was appointed as Chancellor of TestPolity.',
        [adminPid],
        [ownerHouseId],
        [polityId],
        { messageParams: { role: nameParam('role', 'polity_administrator') } },
      ),
      makeEvent(2, 1054, 'OFFICE_TERM_ENDED', "Admin's term ended.", [adminPid], [], []),
      // Polity Office: advisor assigned via factional (outsider house member)
      makeEvent(
        3,
        1055,
        'OFFICE_ASSIGNED',
        'FMember was appointed as Court Advisor of TestPolity.',
        [factionMemberId],
        [outsiderHouseId],
        [polityId],
        { messageParams: { role: nameParam('role', 'polity_advisor') } },
      ),
      // House Office (no polityIds): owner-house treasurer
      makeEvent(
        4,
        1056,
        'OFFICE_ASSIGNED',
        'Admin was appointed as House Treasurer of OwnerHouse.',
        [adminPid],
        [ownerHouseId],
        [],
        { messageParams: { role: nameParam('role', 'house_treasurer') } },
      ),
      // Faction lifecycle
      makeEvent(
        5,
        1050,
        'FACTION_FOUNDED',
        'FLeader founded TestFaction.',
        [factionLeaderId],
        [outsiderHouseId],
        [],
      ),
      makeEvent(
        6,
        1060,
        'PERSON_RECRUITED_TO_FACTION',
        'FMember joined TestFaction.',
        [factionLeaderId, factionMemberId],
        [outsiderHouseId],
        [],
      ),
      // Bailiff
      makeEvent(
        7,
        1052,
        'BAILIFF_APPOINTED',
        'Admin was appointed bailiff of P0.',
        [adminPid],
        [ownerHouseId],
        [polityId],
      ),
      makeEvent(
        8,
        1058,
        'BAILIFF_APPOINTED',
        'FMember was appointed bailiff of P0.',
        [factionMemberId],
        [outsiderHouseId],
        [polityId],
      ),
      makeEvent(9, 1057, 'BAILIFF_VACATED', 'Admin stepped down.', [adminPid], [], []),
      // Population
      makeEvent(10, 1051, 'CHILD_BORN', 'A child was born.', [adminPid], [ownerHouseId], []),
      makeEvent(11, 1053, 'MARRIAGE_FORMED', 'A marriage was formed.', [], [], []),
      makeEvent(12, 1055, 'PERSON_DIED', 'A person died.', [rulerId], [], []),
      makeEvent(13, 1056, 'PERSON_BORN_IN_OBSCURITY', 'A stranger appeared.', [], [], []),
    ]

    const report = buildActivityReport(state, events, defaultConfig, [], {
      seed: 'test',
      years: 100,
    })

    // meta
    expect(report.meta.seed).toBe('test')
    expect(report.meta.years).toBe(100)
    expect(report.meta.finalYear).toBe(1100)

    // event counts
    expect(report.eventCounts['OFFICE_ASSIGNED']).toBe(3)
    expect(report.eventCounts['BAILIFF_APPOINTED']).toBe(2)

    // office aggregate by role: admin (Chancellor + Steward not present), treasurer (House
    // Treasurer), advisor (Court Advisor)
    expect(report.office.aggregateByRole['administrator']?.assignments).toBe(1)
    expect(report.office.aggregateByRole['treasurer']?.assignments).toBe(1)
    expect(report.office.aggregateByRole['advisor']?.assignments).toBe(1)

    // Polity report: 1 Polity, 2 assignments to polity (admin + advisor)
    expect(report.office.polity.length).toBe(1)
    const polityReport = report.office.polity[0]!
    expect(polityReport.officesByRole['administrator']?.assignments).toBe(1)
    expect(polityReport.officesByRole['advisor']?.assignments).toBe(1)
    // 1/2 went to ownerHouse
    expect(polityReport.ownerHouseHoldRatio).toBeCloseTo(0.5, 2)
    expect(polityReport.holderHouseDistribution[ownerHouseId]).toBe(1)
    expect(polityReport.holderHouseDistribution[outsiderHouseId]).toBe(1)

    // House report: ownerHouse has 1 treasurer assignment from House Office event
    const ownerHouseReport = report.office.house.find((h) => h.houseId === ownerHouseId)
    expect(ownerHouseReport).toBeDefined()
    expect(ownerHouseReport?.officesByRole['treasurer']?.assignments).toBe(1)

    // Faction report
    expect(report.faction.aggregate.totalFormed).toBe(1)
    expect(report.faction.aggregate.totalRecruitments).toBe(1)
    expect(report.faction.factions.length).toBe(1)
    const factionReport = report.faction.factions[0]!
    expect(factionReport.active).toBe(true)
    expect(factionReport.recruitments).toBe(1)
    expect(factionReport.foundedYear).toBe(1050)
    expect(factionReport.finalMemberCount).toBe(2)

    // Bailiff report
    expect(report.bailiff.totalAppointments).toBe(2)
    expect(report.bailiff.totalVacated).toBe(1)
    expect(report.bailiff.appointmentBySource.ownerHouse).toBe(1)
    expect(report.bailiff.appointmentBySource.otherHouse).toBe(1)
    // final bailiff is placeholder (installed by bindProvinceToHouseViaPolity fixture)
    expect(report.bailiff.finalPlaceholderCount).toBe(1)
    expect(report.bailiff.finalNormalCount).toBe(0)

    // Population
    expect(report.population.totalBirths).toBe(1)
    expect(report.population.totalDeaths).toBe(1)
    expect(report.population.totalMarriages).toBe(1)
    expect(report.population.totalBornInObscurity).toBe(1)
    expect(report.population.finalLivingNormal).toBeGreaterThan(0)
  })
})
