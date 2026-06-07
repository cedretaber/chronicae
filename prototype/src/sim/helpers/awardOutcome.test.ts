// v0.44 §7-§8: DiplomaticPlay / War terminal award のユニットテスト。
// - §7.6 side 別評価の反転 (demands_met / status_quo / escalated_to_war / revolt_*)
// - failed の target は何も付与しない / voided は経験のみ
// - actor-inactive 削除パスでは付与しない (cleanupTerminalDiplomacy 統合)
// - War: 重複人物は captain general 満額のみ / white_peace・cancelled は評判なし

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createDiplomaticPlayId,
  createWarId,
} from '../types/ids'
import type { PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { DiplomaticPlay, DiplomaticPlayTerminalOutcome } from '../types/diplomaticPlay'
import type { War } from '../types/war'
import type { TickContext, CreateSimEventInput } from '../tick/context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import { awardDiplomaticPlayOutcomeMut, awardWarOutcomeCtx } from './awardHelpers'
import { runCleanupTerminalDiplomacy } from '../tick/cleanupTerminalDiplomacy'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
} from '../testFixtures'

const polityA = createPolityId('dp', 0)
const polityB = createPolityId('dp', 1)
const houseA = createHouseId('dh', 0)
const houseB = createHouseId('dh', 1)
const delegateA = createPersonId('pe', 0)
const delegateB = createPersonId('pe', 1)
const commanderC = createPersonId('pe', 2)
const provinceId = createProvinceId('p', 0)

// 経験を整数成長に固定: exp 4 × charisma weight 0.5 × 50/100 = 1 / insight 0.3 → 0.6 (frac)
// → 決定性のため ×100 で exp4: charisma2/insight1.2... まだ小数。
// diplomacy weights (.5/.3/.2) はどの倍率でも端数が出るため、成長は「>= 変化なし」レベルで
// 検証し、評判 (決定的) を主アサーションにする。
const testConfig: SimulationConfig = { ...defaultConfig }

function makeState(): WorldState {
  let state = makeEmptyV016State()
  state = withProvince(state, provinceId, {})
  state = withHouse(state, houseA, { seatProvinceId: provinceId })
  state = withHouse(state, houseB, { seatProvinceId: provinceId })
  state = withPerson(state, delegateA, { houseId: houseA })
  state = withPerson(state, delegateB, { houseId: houseB })
  state = withPerson(state, commanderC, { houseId: houseA })
  state = withPolity(state, polityA, { ownerHouseId: houseA, capitalProvinceId: provinceId })
  state = withPolity(state, polityB, { ownerHouseId: houseB, capitalProvinceId: provinceId })
  return state
}

function makePlay(
  outcome: DiplomaticPlayTerminalOutcome | undefined,
  status: DiplomaticPlay['status'],
): DiplomaticPlay {
  return {
    id: createDiplomaticPlayId(0),
    kind: 'land_claim',
    initiator: { kind: 'polity', id: polityA },
    target: { kind: 'polity', id: polityB },
    initiatorSupporters: [],
    targetSupporters: [],
    offerHistoryIds: [],
    status,
    ...(outcome !== undefined ? { terminalOutcome: outcome } : {}),
    startedWeek: 0,
    deadlineWeek: 100,
    progress: 0,
    tension: 0,
    initiatorDelegatePersonId: delegateA,
    targetDelegatePersonId: delegateB,
    initiatorPreparation: 0,
    initiatorLeverage: 0,
    initiatorCommitment: 0,
    targetPreparation: 0,
    targetLeverage: 0,
    targetCommitment: 0,
    initiatorActiveTaskIds: [],
    targetActiveTaskIds: [],
  }
}

function collectEmits(): { events: CreateSimEventInput[]; emit: (e: CreateSimEventInput) => void } {
  const events: CreateSimEventInput[] = []
  return { events, emit: (e) => events.push(e) }
}

function repScoresByPerson(ws: WorldState): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const rep of Object.values(ws.personReputations)) {
    if (!rep) continue
    const key = rep.personId as string
    out[key] = [...(out[key] ?? []), rep.baseScore]
  }
  return out
}

function awardPlay(outcome: DiplomaticPlayTerminalOutcome): WorldState {
  const state = makeState()
  const ws = { ...state, persons: { ...state.persons } }
  const { emit } = collectEmits()
  awardDiplomaticPlayOutcomeMut(ws, testConfig, makePlay(outcome, 'settled'), createRng('t'), emit)
  return ws
}

describe('awardDiplomaticPlayOutcomeMut: side 反転 (§7.6)', () => {
  it('demands_met: initiator 成功 (+10) / target 失敗 (-8)', () => {
    const scores = repScoresByPerson(awardPlay('demands_met'))
    expect(scores[delegateA as string]).toEqual([testConfig.personReputationDiplomacySuccessBase])
    expect(scores[delegateB as string]).toEqual([testConfig.personReputationDiplomacyFailureBase])
  })

  it('status_quo: initiator 小失敗 (-3) / target 小成功 (+4)', () => {
    const scores = repScoresByPerson(awardPlay('status_quo'))
    expect(scores[delegateA as string]).toEqual([
      -Math.abs(testConfig.personReputationDiplomacyStatusQuoFailureBase),
    ])
    expect(scores[delegateB as string]).toEqual([testConfig.personReputationDiplomacyStatusQuoBase])
  })

  it('escalated_to_war: initiator 失敗 / target 小成功 (§7.9)', () => {
    const scores = repScoresByPerson(awardPlay('escalated_to_war'))
    expect(scores[delegateA as string]).toEqual([testConfig.personReputationDiplomacyFailureBase])
    expect(scores[delegateB as string]).toEqual([testConfig.personReputationDiplomacyStatusQuoBase])
  })

  it('revolt_succeeded: initiator 成功 / target 失敗', () => {
    const scores = repScoresByPerson(awardPlay('revolt_succeeded'))
    expect(scores[delegateA as string]).toEqual([testConfig.personReputationDiplomacySuccessBase])
    expect(scores[delegateB as string]).toEqual([testConfig.personReputationDiplomacyFailureBase])
  })

  it('revolt_suppressed: initiator 失敗 / target 成功', () => {
    const scores = repScoresByPerson(awardPlay('revolt_suppressed'))
    expect(scores[delegateA as string]).toEqual([testConfig.personReputationDiplomacyFailureBase])
    expect(scores[delegateB as string]).toEqual([testConfig.personReputationDiplomacySuccessBase])
  })

  it('failed: initiator のみ失敗評判・target には何も付与しない', () => {
    const scores = repScoresByPerson(awardPlay('failed'))
    expect(scores[delegateA as string]).toEqual([testConfig.personReputationDiplomacyFailureBase])
    expect(scores[delegateB as string]).toBeUndefined()
  })

  it('voided: 両者とも評判なし (経験のみ)', () => {
    const ws = awardPlay('voided')
    expect(Object.keys(ws.personReputations)).toHaveLength(0)
  })

  it('delegate 死亡側は skip する (alive guard §13.3)', () => {
    let state = makeState()
    const a = state.persons[delegateA]!
    state = { ...state, persons: { ...state.persons, [delegateA]: { ...a, alive: false } } }
    const ws = { ...state, persons: { ...state.persons } }
    const { emit } = collectEmits()
    awardDiplomaticPlayOutcomeMut(
      ws,
      testConfig,
      makePlay('demands_met', 'settled'),
      createRng('t'),
      emit,
    )
    const scores = repScoresByPerson(ws)
    expect(scores[delegateA as string]).toBeUndefined()
    expect(scores[delegateB as string]).toEqual([testConfig.personReputationDiplomacyFailureBase])
  })
})

describe('cleanupTerminalDiplomacy 統合 (§7.1)', () => {
  function makeCtx(state: WorldState): TickContext {
    return {
      state,
      rng: createRng('test'),
      config: testConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 10,
      nextHouseIndex: 10,
      nextPolityIndex: 10,
    }
  }

  function withPlay(state: WorldState, play: DiplomaticPlay): WorldState {
    return { ...state, diplomaticPlays: { ...state.diplomaticPlays, [play.id]: play } }
  }

  it('terminal play は削除と同時に award される', () => {
    const state = withPlay(makeState(), makePlay('demands_met', 'settled'))
    const result = runCleanupTerminalDiplomacy(makeCtx(state))
    expect(Object.keys(result.state.diplomaticPlays)).toHaveLength(0)
    const scores = repScoresByPerson(result.state)
    expect(scores[delegateA as string]).toEqual([testConfig.personReputationDiplomacySuccessBase])
  })

  it('actor-inactive 削除パスでは award しない (§7.1)', () => {
    // initiator polity を inactive 化 → play は active のまま削除される
    let state = withPlay(makeState(), makePlay(undefined, 'active'))
    const polity = state.polities[polityA]!
    state = { ...state, polities: { ...state.polities, [polityA]: { ...polity, active: false } } }
    const result = runCleanupTerminalDiplomacy(makeCtx(state))
    expect(Object.keys(result.state.diplomaticPlays)).toHaveLength(0)
    expect(Object.keys(result.state.personReputations)).toHaveLength(0)
  })

  it('terminalOutcome 未設定の terminal play は award しない (integrity §12.3 検出対象)', () => {
    const state = withPlay(makeState(), makePlay(undefined, 'settled'))
    const result = runCleanupTerminalDiplomacy(makeCtx(state))
    expect(Object.keys(result.state.diplomaticPlays)).toHaveLength(0)
    expect(Object.keys(result.state.personReputations)).toHaveLength(0)
  })
})

describe('awardWarOutcomeCtx (§8)', () => {
  function makeWar(
    status: War['status'],
    attackerOverrides?: { captainGeneralPersonId?: PersonId; commanderPersonIds?: PersonId[] },
  ): War {
    return {
      id: createWarId(0),
      attacker: {
        key: 'attacker',
        participants: [{ actor: { kind: 'polity', id: polityA }, joinedWeek: 0, primary: true }],
        captainGeneralPersonId: delegateA,
        commanderPersonIds: [commanderC],
        avoidanceCount: 0,
        ...attackerOverrides,
      },
      defender: {
        key: 'defender',
        participants: [{ actor: { kind: 'polity', id: polityB }, joinedWeek: 0, primary: true }],
        captainGeneralPersonId: delegateB,
        commanderPersonIds: [],
        avoidanceCount: 0,
      },
      warGoals: [],
      warScore: 0,
      targetWarScore: 100,
      status,
      startedWeek: 0,
    } as unknown as War
  }

  function makeCtx(state: WorldState): TickContext {
    return {
      state,
      rng: createRng('test'),
      config: testConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 10,
      nextHouseIndex: 10,
      nextPolityIndex: 10,
    }
  }

  it('attacker_won: 勝者 captain +12 / 勝者 commander +12×0.6 / 敗者 captain -8', () => {
    const result = awardWarOutcomeCtx(makeCtx(makeState()), makeWar('attacker_won'))
    const scores = repScoresByPerson(result.state)
    expect(scores[delegateA as string]).toEqual([testConfig.personReputationWarVictoryBase])
    expect(scores[commanderC as string]).toEqual([
      testConfig.personReputationWarVictoryBase * testConfig.warCommanderAwardFactor,
    ])
    expect(scores[delegateB as string]).toEqual([testConfig.personReputationWarDefeatBase])
  })

  it('defender_won: 評価が反転する', () => {
    const result = awardWarOutcomeCtx(makeCtx(makeState()), makeWar('defender_won'))
    const scores = repScoresByPerson(result.state)
    expect(scores[delegateA as string]).toEqual([testConfig.personReputationWarDefeatBase])
    expect(scores[delegateB as string]).toEqual([testConfig.personReputationWarVictoryBase])
  })

  it('captain general が commander にも含まれる場合は満額 1 回のみ (§8.2 dedup)', () => {
    const war = makeWar('attacker_won', {
      captainGeneralPersonId: delegateA,
      commanderPersonIds: [delegateA, commanderC],
    })
    const result = awardWarOutcomeCtx(makeCtx(makeState()), war)
    const scores = repScoresByPerson(result.state)
    expect(scores[delegateA as string]).toEqual([testConfig.personReputationWarVictoryBase])
  })

  it('white_peace: 評判なし', () => {
    const result = awardWarOutcomeCtx(makeCtx(makeState()), makeWar('white_peace'))
    expect(Object.keys(result.state.personReputations)).toHaveLength(0)
  })

  it('cancelled: 評判なし (固定小経験のみ)', () => {
    const result = awardWarOutcomeCtx(makeCtx(makeState()), makeWar('cancelled'))
    expect(Object.keys(result.state.personReputations)).toHaveLength(0)
  })
})
