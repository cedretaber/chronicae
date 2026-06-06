import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { createWar } from '../mutations/warMutations'
import {
  getWarSidePrimaryPolityActor,
  getWarSidePolityActors,
  selectCaptainGeneralForWarSide,
  isEligibleBattleCommander,
  buildWarSideCommanderCandidates,
  finalizeWarCommanderCandidates,
  getWarGoalProvince,
} from './warManeuverSelectors'
import type { WorldState } from '../types/world'
import type { Person, PersonKind } from '../types/person'
import type { Holding } from '../types/landContract'
import type {
  PersonId,
  PolityId,
  ProvinceId,
  HoldingId,
  FactionId,
  FactionMembershipId,
} from '../types/ids'
import type { WarGoal } from '../types/war'

const POL = 'po-1' as PolityId

// 全 abilities を score にした Person。getRoleScore('warCommand') は abilities の加重和なので
//   score が大きいほど warCommand が高く、score が等しければ warCommand も等しい (tie-break 検証用)。
function makePerson(
  id: string,
  score: number,
  opts?: { alive?: boolean; kind?: PersonKind; lifeStage?: Person['lifeStage'] },
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
    lifeStage: opts?.lifeStage ?? 'mature_adulthood',
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
    expect(buildWarSideCommanderCandidates(s, [POL], 'pe-cmd1' as PersonId)).toEqual([
      'pe-cmd1',
      'pe-cmd2',
    ])
  })

  it('includes the leader when leader === captainGeneral (the "unless" branch)', () => {
    const s = setupKingdom()
    expect(buildWarSideCommanderCandidates(s, [POL], 'pe-king' as PersonId)).toEqual([
      'pe-king',
      'pe-cmd1',
      'pe-cmd2',
    ])
  })

  // v0.43 追補: eligibility は人物条件のみ (military office 保有は要件でなくなった)。
  it('eligibility is person-only: living adult non-placeholder (office not required)', () => {
    const s = setupKingdom()
    s.persons['pe-outsider' as PersonId] = makePerson('pe-outsider', 99)
    s.persons['pe-dead' as PersonId] = makePerson('pe-dead', 80, { alive: false })
    s.persons['pe-ph' as PersonId] = makePerson('pe-ph', 80, { kind: 'placeholder' })
    s.persons['pe-child' as PersonId] = makePerson('pe-child', 99, { lifeStage: 'childhood' })
    expect(isEligibleBattleCommander(s, 'pe-cmd1' as PersonId)).toBe(true)
    expect(isEligibleBattleCommander(s, 'pe-outsider' as PersonId)).toBe(true) // 在野でも人物としては適格
    expect(isEligibleBattleCommander(s, 'pe-dead' as PersonId)).toBe(false)
    expect(isEligibleBattleCommander(s, 'pe-ph' as PersonId)).toBe(false)
    expect(isEligibleBattleCommander(s, 'pe-child' as PersonId)).toBe(false)
  })

  it('a person outside the court pool (no office / house / faction tie) is not a candidate', () => {
    const s = setupKingdom()
    s.persons['pe-outsider' as PersonId] = makePerson('pe-outsider', 99)
    expect(buildWarSideCommanderCandidates(s, [POL], undefined)).toEqual(['pe-cmd1', 'pe-cmd2'])
  })

  it('a dead military holder is not a candidate', () => {
    const s = setupKingdom()
    s.persons['pe-cmd1' as PersonId] = makePerson('pe-cmd1', 80, { alive: false })
    expect(buildWarSideCommanderCandidates(s, [POL], undefined)).toEqual(['pe-cmd2'])
  })

  // v0.43 追補: 非成人は military office を持っていても候補にならない。
  it('a non-adult military holder is not a candidate', () => {
    let s = setupKingdom()
    s.persons['pe-child' as PersonId] = makePerson('pe-child', 99, { lifeStage: 'childhood' })
    s = addMilitary(s, 'pe-child')
    expect(buildWarSideCommanderCandidates(s, [POL], undefined)).toEqual(['pe-cmd1', 'pe-cmd2'])
  })

  // v0.43 追補: anchor 派閥のメンバー (食客) は候補に入る (能力順で役職持ちより上にも来る)。
  it('includes faction members (食客) of factions anchored to the polity', () => {
    const s = setupKingdom()
    s.persons['pe-client' as PersonId] = makePerson('pe-client', 99)
    s.factions['fa-1' as FactionId] = {
      id: 'fa-1' as FactionId,
      leaderPersonId: 'pe-cmd1' as PersonId,
      polityId: POL,
      active: true,
      foundingWeek: 0,
    }
    s.factionMemberships['fm-1' as FactionMembershipId] = {
      id: 'fm-1' as FactionMembershipId,
      factionId: 'fa-1' as FactionId,
      personId: 'pe-client' as PersonId,
      active: true,
      joinedWeek: 0,
    }
    s.factionIndex.byPolity[POL] = ['fa-1' as FactionId]
    expect(buildWarSideCommanderCandidates(s, [POL], undefined)).toEqual([
      'pe-client',
      'pe-cmd1',
      'pe-cmd2',
    ])
  })

  it('dedups a person holding multiple military offices', () => {
    let s = setupKingdom()
    s = addMilitary(s, 'pe-cmd1') // pe-cmd1 holds 2 military offices
    const candidates = buildWarSideCommanderCandidates(s, [POL], undefined)
    expect(candidates.filter((id) => (id as string) === 'pe-cmd1')).toHaveLength(1)
  })
})

// v0.43 追補: 両属除外 + cap (両 side のフル候補が揃ってから適用する最終段)。
describe('finalizeWarCommanderCandidates', () => {
  const ids = (xs: string[]): PersonId[] => xs.map((x) => x as PersonId)

  it('removes dual-listed persons from both sides', () => {
    const r = finalizeWarCommanderCandidates(
      ids(['pe-a', 'pe-x', 'pe-b']),
      ids(['pe-x', 'pe-c']),
      8,
    )
    expect(r.attacker).toEqual(['pe-a', 'pe-b'])
    expect(r.defender).toEqual(['pe-c'])
  })

  it('caps each side after dual exclusion (a dual person beyond the cap is still excluded)', () => {
    const r = finalizeWarCommanderCandidates(
      ids(['pe-a', 'pe-b', 'pe-c', 'pe-x']), // pe-x は cap 外でも両属として defender からも消える
      ids(['pe-x', 'pe-d', 'pe-e', 'pe-f']),
      2,
    )
    expect(r.attacker).toEqual(['pe-a', 'pe-b'])
    expect(r.defender).toEqual(['pe-d', 'pe-e'])
  })

  it('keeps order and passes through when there is no overlap', () => {
    const r = finalizeWarCommanderCandidates(ids(['pe-a']), ids(['pe-b']), 8)
    expect(r.attacker).toEqual(['pe-a'])
    expect(r.defender).toEqual(['pe-b'])
  })
})

// v0.43 追補: 指揮官候補は side の全 polity participant (supporter 含む) から選出される。
describe('buildWarSideCommanderCandidates (multi-polity / supporter 開放)', () => {
  const POL2 = 'po-2' as PolityId

  function addMilitaryTo(state: WorldState, polityId: PolityId, personId: string): WorldState {
    return createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'military',
      personId as PersonId,
    )
  }
  function addLeaderTo(state: WorldState, polityId: PolityId, personId: string): WorldState {
    return createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'leader',
      personId as PersonId,
    )
  }

  // primary (POL): pe-cmd1(80)。supporter (POL2): pe-sup1(90), pe-sup2(70) + leader pe-sking(95)。
  function setupCoalition(): WorldState {
    let s = makeEmptyV016State()
    s.persons['pe-cmd1' as PersonId] = makePerson('pe-cmd1', 80)
    s.persons['pe-sup1' as PersonId] = makePerson('pe-sup1', 90)
    s.persons['pe-sup2' as PersonId] = makePerson('pe-sup2', 70)
    s.persons['pe-sking' as PersonId] = makePerson('pe-sking', 95)
    s = addMilitaryTo(s, POL, 'pe-cmd1')
    s = addMilitaryTo(s, POL2, 'pe-sup1')
    s = addMilitaryTo(s, POL2, 'pe-sup2')
    s = addMilitaryTo(s, POL2, 'pe-sking')
    s = addLeaderTo(s, POL2, 'pe-sking')
    return s
  }

  it('includes supporter-polity military holders, sorted by warCommand across polities', () => {
    const s = setupCoalition()
    // pe-sup1(90) > pe-cmd1(80) > pe-sup2(70)。supporter 人材が primary より上位にも入れる。
    expect(buildWarSideCommanderCandidates(s, [POL, POL2], undefined)).toEqual([
      'pe-sup1',
      'pe-cmd1',
      'pe-sup2',
    ])
  })

  it('excludes the supporter-polity leader (CG is a primary person, never the supporter leader)', () => {
    const s = setupCoalition()
    // CG = pe-cmd1 (primary 側) のとき、supporter leader pe-sking(95) は最高スコアでも除外。
    const candidates = buildWarSideCommanderCandidates(s, [POL, POL2], 'pe-cmd1' as PersonId)
    expect(candidates).toEqual(['pe-sup1', 'pe-cmd1', 'pe-sup2'])
  })

  it('breaks cross-polity warCommand ties by personId ascending', () => {
    let s = makeEmptyV016State()
    s.persons['pe-b' as PersonId] = makePerson('pe-b', 70)
    s.persons['pe-a' as PersonId] = makePerson('pe-a', 70)
    s = addMilitaryTo(s, POL, 'pe-b')
    s = addMilitaryTo(s, POL2, 'pe-a')
    expect(buildWarSideCommanderCandidates(s, [POL, POL2], undefined)).toEqual(['pe-a', 'pe-b'])
  })

  it('dedups a person holding military offices in both polities', () => {
    let s = makeEmptyV016State()
    s.persons['pe-dual' as PersonId] = makePerson('pe-dual', 80)
    s = addMilitaryTo(s, POL, 'pe-dual')
    s = addMilitaryTo(s, POL2, 'pe-dual')
    expect(buildWarSideCommanderCandidates(s, [POL, POL2], undefined)).toEqual(['pe-dual'])
  })

  it('single-polity input preserves the pre-v0.43 behavior', () => {
    const s = setupCoalition()
    expect(buildWarSideCommanderCandidates(s, [POL], undefined)).toEqual(['pe-cmd1'])
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

describe('getWarSidePolityActors', () => {
  it('returns primary first then supporters in participants order, per side', () => {
    const s = makeEmptyV016State()
    const war = createWar(s, {
      attacker: { kind: 'polity', id: POL },
      defender: { kind: 'polity', id: 'po-2' as PolityId },
      attackerSupporters: [
        { actor: { kind: 'polity', id: 'po-9' as PolityId } },
        { actor: { kind: 'polity', id: 'po-3' as PolityId } },
      ],
      warGoals: [],
      targetWarScore: 60,
      startedWeek: s.absoluteWeek,
    })
    expect(getWarSidePolityActors(war, 'attacker')).toEqual(['po-1', 'po-9', 'po-3'])
    expect(getWarSidePolityActors(war, 'defender')).toEqual(['po-2'])
  })
})
