import { describe, it, expect } from 'vitest'
import { runCrisisSystem } from './crisisSystem'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  withPerson,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createTickContext } from './context'
import type { WorldState } from '../types/world'
import type {
  HoldingId,
  PolityId,
  HouseId,
  PersonId,
  PopGroupId,
  ProvinceId,
  HoldingOfficeAssignmentId,
  OfficeAssignmentId,
} from '../types/ids'

const PROVINCE = 'pr-1' as ProvinceId
const POLITY = 'c-1' as PolityId
const HOUSE = 'h-1' as HouseId
const LEADER = 'p-leader' as PersonId
const HOLDING = 'hl-0' as HoldingId // withProvince が最初に作る holding
const POP = 'pg-1' as PopGroupId

// famine を必ず当て、pressure 連動を消した config
const FORCE_FAMINE = {
  famineBaseChancePerYear: 1,
  plagueBaseChancePerYear: 0,
  droughtBaseChancePerYear: 0,
  bountifulHarvestBaseChancePerYear: 0,
  populationPressureThreshold: 999999,
  crisisSeverityPressureBonus: 0,
}

// LEADER を POLITY の leader office に就ける (getPolityLeader が返すように)。
function withPolityLeaderOffice(s: WorldState): WorldState {
  const officeId = 'oa-leader' as OfficeAssignmentId
  const orgKey = 'polity:' + POLITY
  return {
    ...s,
    officeAssignments: {
      ...s.officeAssignments,
      [officeId]: {
        id: officeId,
        organization: { kind: 'polity', id: POLITY },
        role: 'leader',
        holderPersonId: LEADER,
        active: true,
        startYear: 1,
        slotIndex: 0,
        unpaidCount: 0,
      },
    },
    officeIndex: {
      byOrganization: {
        ...s.officeIndex.byOrganization,
        [orgKey]: [...(s.officeIndex.byOrganization[orgKey] ?? []), officeId],
      },
      byHolderPerson: {
        ...s.officeIndex.byHolderPerson,
        [LEADER as string]: [...(s.officeIndex.byHolderPerson[LEADER as string] ?? []), officeId],
      },
    },
    nextOfficeAssignmentId: s.nextOfficeAssignmentId + 1,
  }
}

function buildWorld(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, PROVINCE)
  s = withPolity(s, POLITY, { treasury: 1000, capitalProvinceId: PROVINCE })
  s = withHouse(s, HOUSE, { seatProvinceId: PROVINCE })
  s = withPerson(s, LEADER, { houseId: HOUSE })
  s = bindProvinceToHouseViaPolity(s, PROVINCE, POLITY, HOUSE)
  s = withPolityLeaderOffice(s)
  // peasants/agriculture POP を hl-0 に
  s = {
    ...s,
    popGroups: {
      ...s.popGroups,
      [POP]: {
        id: POP,
        holdingId: HOLDING,
        class: 'peasants',
        occupation: 'agriculture',
        size: 1000,
        wealth: 50,
        unrest: 10,
        attitudes: {},
      },
    },
    popIndex: { byHolding: { ...s.popIndex.byHolding, [HOLDING]: [POP] } },
  }
  // 年初週 (48 % 48 === 0)
  s = { ...s, currentYear: 1, currentWeekOfYear: 0, absoluteWeek: 48 }
  return s
}

function makeCtx(state: WorldState) {
  return createTickContext({
    state,
    rng: createRng('crisis-spawn'),
    config: { ...defaultConfig, ...FORCE_FAMINE },
  })
}

describe('runCrisisSystem spawn (A5)', () => {
  it('該当 holding に famine Crisis を生成し、代官不在でも owner polity の指導者が担当者になる', () => {
    const ctx = makeCtx(buildWorld())
    const next = runCrisisSystem(ctx)
    const crises = Object.values(next.state.crises)
    expect(crises.length).toBe(1)
    expect(crises[0]!.kind).toBe('famine')
    expect(crises[0]!.holdingId).toBe(HOLDING)
    expect(crises[0]!.status).toBe('active')
    expect(next.state.crisisIndex.byHolding[HOLDING]).toHaveLength(1)
    // 代官不在でも Pressure 同様、owner polity の指導者を creator に対処 Project を生成する (§3.2)
    const handleProjects = Object.values(next.state.projects).filter(
      (p) => p && p.kind === 'handle_crisis',
    )
    expect(handleProjects.length).toBe(1)
    expect(handleProjects[0]!.creatorPersonId).toBe(LEADER)
    expect(crises[0]!.responseProjectId).toBe(handleProjects[0]!.id)
  })

  it('代官も指導者もいなければ対処 Project は生成されない (真の放置)', () => {
    let s = buildWorld()
    // leader office を無効化して指導者を消す
    s = {
      ...s,
      officeAssignments: {
        ...s.officeAssignments,
        ['oa-leader' as OfficeAssignmentId]: {
          ...s.officeAssignments['oa-leader' as OfficeAssignmentId]!,
          active: false,
        },
      },
    }
    const next = runCrisisSystem(makeCtx(s))
    expect(Object.values(next.state.crises).length).toBe(1)
    const handleProjects = Object.values(next.state.projects).filter(
      (p) => p && p.kind === 'handle_crisis',
    )
    expect(handleProjects.length).toBe(0)
  })

  it('同 kind active Crisis があれば再 spawn を dedup する', () => {
    const ctx = makeCtx(buildWorld())
    const once = runCrisisSystem(ctx)
    // 同じ年初週でもう一度 (rng は進むが crisis は増えない)
    const twice = runCrisisSystem({ ...once, config: ctx.config })
    expect(Object.values(twice.state.crises).length).toBe(1)
  })

  it('代官がいれば handle_crisis Project を生成し Crisis に紐づける', () => {
    let s = buildWorld()
    // hl-0 に active な bailiff を割り当てる
    const bailiff = 'p-bailiff' as PersonId
    s = withPerson(s, bailiff, { houseId: HOUSE })
    const officeId = 'ho-1' as HoldingOfficeAssignmentId
    s = {
      ...s,
      holdingOfficeAssignments: {
        ...s.holdingOfficeAssignments,
        [officeId]: {
          id: officeId,
          holdingId: HOLDING,
          role: 'bailiff',
          holderPersonId: bailiff,
          appointingPolityId: POLITY,
          active: true,
          startWeek: 0,
          unpaidCount: 0,
          contractedRemittanceRate: 0.5,
          expectedFeeRate: 0.1,
        },
      },
      holdingOfficeIndex: {
        ...s.holdingOfficeIndex,
        byHolding: { ...s.holdingOfficeIndex.byHolding, [HOLDING]: officeId },
      },
    }
    const next = runCrisisSystem(makeCtx(s))
    const handleProjects = Object.values(next.state.projects).filter(
      (p) => p && p.kind === 'handle_crisis',
    )
    expect(handleProjects.length).toBe(1)
    const crisis = Object.values(next.state.crises)[0]!
    expect(crisis.responseProjectId).toBe(handleProjects[0]!.id)
    expect(handleProjects[0]!.supervisorPersonId).toBe(bailiff)
    // targetProgress = 初期 severity
    expect(handleProjects[0]!.targetProgress).toBe(crisis.severity)
  })
})
