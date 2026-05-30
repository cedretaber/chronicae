import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { createWar } from '../mutations/warMutations'
import {
  getWarSidePrimaryPolityActor,
  selectCaptainGeneralForWarSide,
  isEligibleBattleCommander,
  buildWarSideCommanderCandidates,
  getWarGoalProvince,
} from './warManeuverSelectors'
import type { WorldState } from '../types/world'
import type { Person, PersonKind } from '../types/person'
import type { Holding } from '../types/landContract'
import type { PersonId, PolityId, ProvinceId, HoldingId } from '../types/ids'
import type { WarGoal } from '../types/war'

const POL = 'po-1' as PolityId

// 全 abilities を score にした Person。getRoleScore('warCommand') は abilities の加重和なので
//   score が大きいほど warCommand が高く、score が等しければ warCommand も等しい (tie-break 検証用)。
function makePerson(
  id: string,
  score: number,
  opts?: { alive?: boolean; kind?: PersonKind },
): Person {
  const abilities = {
    valor: score,
    command: score,
    numeracy: score,
    learning: score,
    charisma: score,
    insight: score,
  }
  return {
    id: id as PersonId,
    nameKey: id,
    sex: 'male',
    age: 40,
    alive: opts?.alive ?? true,
    ...(opts?.kind ? { kind: opts.kind } : {}),
    childIds: [],
    birthStatus: 'unknown',
    abilities,
    aptitudes: abilities,
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 0,
    wealth: 0,
    attitudes: {},
  }
}

function addMilitary(state: WorldState, personId: string): WorldState {
  return createOfficeAssignment(
    state,
    { kind: 'polity', id: POL },
    'military',
    personId as PersonId,
  )
}
function addLeader(state: WorldState, personId: string): WorldState {
  return createOfficeAssignment(state, { kind: 'polity', id: POL }, 'leader', personId as PersonId)
}

describe('selectCaptainGeneralForWarSide', () => {
  it('picks the highest-warCommand military holder (even when a non-military leader scores higher)', () => {
    let s = makeEmptyV016State()
    s.persons['pe-mil1' as PersonId] = makePerson('pe-mil1', 80)
    s.persons['pe-mil2' as PersonId] = makePerson('pe-mil2', 60)
    s.persons['pe-leader' as PersonId] = makePerson('pe-leader', 90)
    s = addMilitary(s, 'pe-mil1')
    s = addMilitary(s, 'pe-mil2')
    s = addLeader(s, 'pe-leader')
    expect(selectCaptainGeneralForWarSide(s, POL)).toBe('pe-mil1')
  })

  it('excludes a dead military holder', () => {
    let s = makeEmptyV016State()
    s.persons['pe-mil1' as PersonId] = makePerson('pe-mil1', 80, { alive: false })
    s.persons['pe-mil2' as PersonId] = makePerson('pe-mil2', 60)
    s = addMilitary(s, 'pe-mil1')
    s = addMilitary(s, 'pe-mil2')
    expect(selectCaptainGeneralForWarSide(s, POL)).toBe('pe-mil2')
  })

  it('excludes a placeholder military holder', () => {
    let s = makeEmptyV016State()
    s.persons['pe-ph' as PersonId] = makePerson('pe-ph', 100, { kind: 'placeholder' })
    s.persons['pe-mil1' as PersonId] = makePerson('pe-mil1', 80)
    s = addMilitary(s, 'pe-ph')
    s = addMilitary(s, 'pe-mil1')
    expect(selectCaptainGeneralForWarSide(s, POL)).toBe('pe-mil1')
  })

  it('breaks warCommand ties by personId ascending', () => {
    let s = makeEmptyV016State()
    s.persons['pe-b' as PersonId] = makePerson('pe-b', 70)
    s.persons['pe-a' as PersonId] = makePerson('pe-a', 70)
    s = addMilitary(s, 'pe-b')
    s = addMilitary(s, 'pe-a')
    expect(selectCaptainGeneralForWarSide(s, POL)).toBe('pe-a')
  })

  it('falls back to the polity leader when there is no military holder', () => {
    let s = makeEmptyV016State()
    s.persons['pe-leader' as PersonId] = makePerson('pe-leader', 50)
    s = addLeader(s, 'pe-leader')
    expect(selectCaptainGeneralForWarSide(s, POL)).toBe('pe-leader')
  })

  it('returns undefined when neither a military holder nor an eligible leader exists', () => {
    let s = makeEmptyV016State()
    s.persons['pe-leader' as PersonId] = makePerson('pe-leader', 50, { alive: false })
    s = addLeader(s, 'pe-leader')
    expect(selectCaptainGeneralForWarSide(s, POL)).toBeUndefined()
    expect(selectCaptainGeneralForWarSide(makeEmptyV016State(), POL)).toBeUndefined()
  })
})

describe('isEligibleBattleCommander / buildWarSideCommanderCandidates', () => {
  // 'pe-king' は leader と military を兼任。'pe-cmd1'/'pe-cmd2' は military のみ。
  function setupKingdom(): WorldState {
    let s = makeEmptyV016State()
    s.persons['pe-cmd1' as PersonId] = makePerson('pe-cmd1', 80)
    s.persons['pe-cmd2' as PersonId] = makePerson('pe-cmd2', 60)
    s.persons['pe-king' as PersonId] = makePerson('pe-king', 90)
    s = addMilitary(s, 'pe-cmd1')
    s = addMilitary(s, 'pe-cmd2')
    s = addMilitary(s, 'pe-king')
    s = addLeader(s, 'pe-king')
    return s
  }

  it('excludes the leader when leader !== captainGeneral', () => {
    const s = setupKingdom()
    expect(isEligibleBattleCommander(s, POL, 'pe-king' as PersonId, 'pe-cmd1' as PersonId)).toBe(
      false,
    )
    expect(buildWarSideCommanderCandidates(s, POL, 'pe-cmd1' as PersonId)).toEqual([
      'pe-cmd1',
      'pe-cmd2',
    ])
  })

  it('includes the leader when leader === captainGeneral (the "unless" branch)', () => {
    const s = setupKingdom()
    expect(isEligibleBattleCommander(s, POL, 'pe-king' as PersonId, 'pe-king' as PersonId)).toBe(
      true,
    )
    expect(buildWarSideCommanderCandidates(s, POL, 'pe-king' as PersonId)).toEqual([
      'pe-king',
      'pe-cmd1',
      'pe-cmd2',
    ])
  })

  it('non-leader military holders are eligible regardless of captainGeneral', () => {
    const s = setupKingdom()
    expect(isEligibleBattleCommander(s, POL, 'pe-cmd1' as PersonId, undefined)).toBe(true)
    expect(isEligibleBattleCommander(s, POL, 'pe-cmd2' as PersonId, 'pe-cmd1' as PersonId)).toBe(
      true,
    )
  })

  it('a non-military person is not an eligible commander', () => {
    const s = setupKingdom()
    s.persons['pe-outsider' as PersonId] = makePerson('pe-outsider', 99)
    expect(isEligibleBattleCommander(s, POL, 'pe-outsider' as PersonId, undefined)).toBe(false)
  })

  it('a dead military holder is not an eligible commander', () => {
    const s = setupKingdom()
    s.persons['pe-cmd1' as PersonId] = makePerson('pe-cmd1', 80, { alive: false })
    expect(isEligibleBattleCommander(s, POL, 'pe-cmd1' as PersonId, undefined)).toBe(false)
    expect(buildWarSideCommanderCandidates(s, POL, undefined)).toEqual(['pe-cmd2'])
  })

  it('dedups a person holding multiple military offices', () => {
    let s = setupKingdom()
    s = addMilitary(s, 'pe-cmd1') // pe-cmd1 holds 2 military offices
    const candidates = buildWarSideCommanderCandidates(s, POL, undefined)
    expect(candidates.filter((id) => (id as string) === 'pe-cmd1')).toHaveLength(1)
  })
})

describe('getWarGoalProvince', () => {
  function setupWarWithGoal(
    holdingId: string,
    goalProvinceId?: string,
  ): { s: WorldState; warGoals: WarGoal[] } {
    const s = makeEmptyV016State()
    if (goalProvinceId) {
      s.holdings[holdingId as HoldingId] = {
        id: holdingId as HoldingId,
        provinceId: goalProvinceId as ProvinceId,
      } as unknown as Holding
    }
    const warGoals: WarGoal[] = [
      {
        kind: 'transfer_land_contract',
        holdingId: holdingId as HoldingId,
        fromPolityId: 'po-2' as PolityId,
        toPolityId: POL,
        requiredWarScore: 60,
      },
    ]
    return { s, warGoals }
  }

  it('resolves holdingId -> holding.provinceId', () => {
    const { s, warGoals } = setupWarWithGoal('hl-1', 'pr-1')
    const war = createWar(s, {
      attacker: { kind: 'polity', id: POL },
      defender: { kind: 'polity', id: 'po-2' as PolityId },
      warGoals,
      targetWarScore: 60,
      startedWeek: s.absoluteWeek,
    })
    expect(getWarGoalProvince(s, war)).toBe('pr-1')
  })

  it('returns undefined when the holding is missing', () => {
    const { s, warGoals } = setupWarWithGoal('hl-missing')
    const war = createWar(s, {
      attacker: { kind: 'polity', id: POL },
      defender: { kind: 'polity', id: 'po-2' as PolityId },
      warGoals,
      targetWarScore: 60,
      startedWeek: s.absoluteWeek,
    })
    expect(getWarGoalProvince(s, war)).toBeUndefined()
  })

  it('returns undefined when there are no war goals', () => {
    const s = makeEmptyV016State()
    const war = createWar(s, {
      attacker: { kind: 'polity', id: POL },
      defender: { kind: 'polity', id: 'po-2' as PolityId },
      warGoals: [],
      targetWarScore: 60,
      startedWeek: s.absoluteWeek,
    })
    expect(getWarGoalProvince(s, war)).toBeUndefined()
  })
})

describe('getWarSidePrimaryPolityActor', () => {
  it('returns the primary participant polity id for each side', () => {
    const s = makeEmptyV016State()
    const war = createWar(s, {
      attacker: { kind: 'polity', id: POL },
      defender: { kind: 'polity', id: 'po-2' as PolityId },
      warGoals: [],
      targetWarScore: 60,
      startedWeek: s.absoluteWeek,
    })
    expect(getWarSidePrimaryPolityActor(war, 'attacker')).toBe('po-1')
    expect(getWarSidePrimaryPolityActor(war, 'defender')).toBe('po-2')
  })
})
