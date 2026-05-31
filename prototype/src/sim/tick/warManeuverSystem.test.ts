import { describe, it, expect } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import { createTickContext, type TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig, type SimulationConfig } from '../config/defaultConfig'
import { createWar } from '../mutations/warMutations'
import { getHoldingTerminalPolityId } from '../selectors/landContractSelectors'
import { generateCandidateBattlefield } from '../selectors/warManeuverSelectors'
import { getRegimentEffectivePower } from '../selectors/regimentSelectors'
import { runWarManeuverSystem } from './warManeuverSystem'
import { runPeaceSettlementSystem } from './peaceSettlementSystem'
import { politicalActorKey } from '../selectors/actorSelectors'
import type { WorldState } from '../types/world'
import type { War, BattlefieldKind } from '../types/war'
import type { Province } from '../types/province'
import type { HoldingId, PolityId, ProvinceId, PersonId, RegimentId } from '../types/ids'

// v0.35 §19: WarManeuverSystem の回帰テスト。
//   分岐 (両者回避 / 両者受諾 / 片側回避) は generated world では rng/戦力/traits 依存で不定なため、
//   config を極端化して randomness=0 + terrain/urgency で決定論的に強制する。
//   lastWarWeek / target-skip / soft CG / determinism は不変条件として generated world で検証する。

function freshWorld(seed = 'war-maneuver'): WorldState {
  return generateWorld(seed).world
}

function makeCtx(
  world: WorldState,
  config: SimulationConfig = defaultConfig,
  seed = 'war-maneuver',
): TickContext {
  return createTickContext({ state: world, rng: createRng(seed), config })
}

// holding と、その terminal owner / 別の active polity を 1 組返す (warLifecycle.test と同パターン)。
function pickHoldingAndPolities(world: WorldState): {
  holdingId: HoldingId
  owner: PolityId
  other: PolityId
} {
  const activePolities = Object.values(world.polities)
    .filter((p) => p && p.active)
    .map((p) => p.id)
  for (const hid of Object.keys(world.holdings) as HoldingId[]) {
    const owner = getHoldingTerminalPolityId(world, hid)
    if (!owner || !world.polities[owner]?.active) continue
    const other = activePolities.find((id) => (id as string) !== (owner as string))
    if (!other) continue
    return { holdingId: hid, owner, other }
  }
  throw new Error('no suitable holding/polities in generated world')
}

// attacker=other, defender=owner の transfer-goal war を 1 件注入する。
function injectWar(
  world: WorldState,
  targetWarScore = 100,
): { war: War; owner: PolityId; other: PolityId } {
  const { holdingId, owner, other } = pickHoldingAndPolities(world)
  const war = createWar(world, {
    attacker: { kind: 'polity', id: other },
    defender: { kind: 'polity', id: owner },
    warGoals: [
      {
        kind: 'transfer_land_contract',
        holdingId,
        fromPolityId: owner,
        toPolityId: other,
        requiredWarScore: 60,
      },
    ],
    targetWarScore,
    startedWeek: world.absoluteWeek,
  })
  return { war, owner, other }
}

function terrainAll(v: number): Record<BattlefieldKind, number> {
  return {
    open_field: v,
    forest_battle: v,
    hill_battle: v,
    mountain_pass: v,
    wetland_battle: v,
    river_crossing: v,
    coastal_battle: v,
    siege: v,
  }
}

// engagement / avoidance を決定論化する基底 (randomness=0)。terrain / urgency で分岐を強制する。
function deterministicConfig(overrides: Partial<SimulationConfig>): SimulationConfig {
  return {
    ...defaultConfig,
    warEngagementRandomness: 0,
    warEngagementCautionEffect: 0,
    warEngagementAmbitionEffect: 0,
    warEngagementWarScoreUrgencyEffect: 0,
    warBattleRandomness: 0,
    ...overrides,
  }
}

describe('WarManeuverSystem lastWarWeek 継承 (§19.1)', () => {
  it('両 active polity の lastWarWeek を absoluteWeek に更新する', () => {
    const world = freshWorld()
    const { owner, other } = injectWar(world)
    const next = runWarManeuverSystem(makeCtx(world))
    expect(next.state.polities[owner]?.lastWarWeek).toBe(world.absoluteWeek)
    expect(next.state.polities[other]?.lastWarWeek).toBe(world.absoluteWeek)
  })

  it('province 未解決でも lastWarWeek は更新する (step 2 を step 5 skip より前に実行)', () => {
    const world = freshWorld()
    const { war, owner, other } = injectWar(world)
    // warGoal の holding を欠落 id にし、getWarGoalProvince を未解決にする。
    war.warGoals[0]!.holdingId = 'hl-999999' as HoldingId
    const next = runWarManeuverSystem(makeCtx(world))
    expect(next.state.polities[owner]?.lastWarWeek).toBe(world.absoluteWeek)
    expect(next.state.polities[other]?.lastWarWeek).toBe(world.absoluteWeek)
    // province 未解決 → warScore 不変・maneuver event なし
    expect(next.state.wars[war.id]?.warScore).toBe(0)
  })

  it('target 到達済み (skip) でも lastWarWeek は更新する', () => {
    const world = freshWorld()
    const { war, owner, other } = injectWar(world, 60)
    war.warScore = 60 // == targetWarScore → skip
    const next = runWarManeuverSystem(makeCtx(world))
    expect(next.state.polities[owner]?.lastWarWeek).toBe(world.absoluteWeek)
    expect(next.state.polities[other]?.lastWarWeek).toBe(world.absoluteWeek)
    expect(next.state.wars[war.id]?.warScore).toBe(60) // 凍結
  })
})

describe('WarManeuverSystem dead-participant guard', () => {
  it('inactive participant の War は触らない (warScore 不変・lastWarWeek 未更新)', () => {
    const world = freshWorld()
    const { war, owner } = injectWar(world)
    const d = world.polities[owner]!
    world.polities[owner] = { ...d, active: false }
    const next = runWarManeuverSystem(makeCtx(world))
    expect(next.state.wars[war.id]?.warScore).toBe(0)
    expect(next.state.polities[owner]?.lastWarWeek).toBeUndefined()
  })
})

describe('WarManeuverSystem target-skip + PeaceSettlement integration (§19.9 / §19.6)', () => {
  it('target 到達済みは maneuver で warScore 凍結、次 PeaceSettlement で attacker_won', () => {
    const world = freshWorld()
    const { war } = injectWar(world, 60)
    war.warScore = 60
    let ctx = makeCtx(world)
    ctx = runWarManeuverSystem(ctx)
    expect(ctx.state.wars[war.id]?.warScore).toBe(60) // 凍結
    expect(ctx.state.wars[war.id]?.status).toBe('active')
    // 同 tick の PeaceSettlement で victory 確定 (white_peace 化しない)。
    ctx = runPeaceSettlementSystem(ctx)
    expect(ctx.state.wars[war.id]?.status).toBe('attacker_won')
  })
})

describe('WarManeuverSystem engagement 強制分岐 (config override)', () => {
  it('both avoid → 両 avoidanceCount +1、warScore 不変、BATTLE_AVOIDED(both)', () => {
    const world = freshWorld()
    const { war } = injectWar(world)
    // terrain avoidability を大きく + にすると avoidDesire > 0 で両者回避。
    const config = deterministicConfig({ warAvoidanceTerrainModifierByBattlefield: terrainAll(10) })
    const next = runWarManeuverSystem(makeCtx(world, config))
    const w = next.state.wars[war.id]!
    expect(w.attacker.avoidanceCount).toBe(1)
    expect(w.defender.avoidanceCount).toBe(1)
    expect(w.warScore).toBe(0)
    const avoided = next.events.filter((e) => e.type === 'BATTLE_AVOIDED')
    expect(avoided).toHaveLength(1)
    expect(avoided[0]?.messageParams['avoidingSide']).toBe('both')
    expect(next.events.some((e) => e.type === 'BATTLE_OCCURRED')).toBe(false)
  })

  it('both accept → BATTLE_OCCURRED(mutual_engagement)', () => {
    const world = freshWorld()
    const { war } = injectWar(world)
    // terrain avoidability を大きく - にすると avoidDesire < 0 で両者受諾 → 戦闘。
    const config = deterministicConfig({
      warAvoidanceTerrainModifierByBattlefield: terrainAll(-10),
    })
    const next = runWarManeuverSystem(makeCtx(world, config))
    const occurred = next.events.filter((e) => e.type === 'BATTLE_OCCURRED')
    expect(occurred).toHaveLength(1)
    expect(occurred[0]?.messageParams['initiationKind']).toBe('mutual_engagement')
    const w = next.state.wars[war.id]!
    expect(w.warScore).toBeGreaterThanOrEqual(-100)
    expect(w.warScore).toBeLessThanOrEqual(100)
  })

  it('attacker 回避成功 → warScore が penalty 分だけ減る (§19.5)', () => {
    const world = freshWorld()
    const { war } = injectWar(world, 100)
    war.warScore = 50 // attacker 優勢 → defender に urgency、attacker に urgency なし
    // terrain +0.6 で両者の avoidDesire を底上げ、urgencyEffect 4 で defender だけ accept に倒す。
    // baseChance 1.0 + warCommandEffect 0 で回避は必ず成功。
    const config = deterministicConfig({
      warAvoidanceTerrainModifierByBattlefield: terrainAll(0.6),
      warEngagementWarScoreUrgencyEffect: 4,
      warAvoidanceBaseChance: 1.0,
      warAvoidanceWarCommandEffect: 0,
      warAvoidanceCountPenalty: 0,
      warAvoidanceWarScorePenalty: 1.0,
    })
    const next = runWarManeuverSystem(makeCtx(world, config))
    const w = next.state.wars[war.id]!
    expect(w.warScore).toBe(49) // 50 - 1.0
    expect(w.attacker.avoidanceCount).toBe(1)
    expect(w.defender.avoidanceCount).toBe(0)
    const avoided = next.events.filter((e) => e.type === 'BATTLE_AVOIDED')
    expect(avoided).toHaveLength(1)
    expect(avoided[0]?.messageParams['avoidingSide']).toBe('attacker')
  })

  it('defender 回避成功 → warScore が penalty 分だけ増える (§19.5)', () => {
    const world = freshWorld()
    const { war } = injectWar(world, 100)
    war.warScore = -50 // defender 優勢 → attacker に urgency
    const config = deterministicConfig({
      warAvoidanceTerrainModifierByBattlefield: terrainAll(0.6),
      warEngagementWarScoreUrgencyEffect: 4,
      warAvoidanceBaseChance: 1.0,
      warAvoidanceWarCommandEffect: 0,
      warAvoidanceCountPenalty: 0,
      warAvoidanceWarScorePenalty: 1.0,
    })
    const next = runWarManeuverSystem(makeCtx(world, config))
    const w = next.state.wars[war.id]!
    expect(w.warScore).toBe(-49) // -50 + 1.0
    expect(w.defender.avoidanceCount).toBe(1)
    expect(w.attacker.avoidanceCount).toBe(0)
    const avoided = next.events.filter((e) => e.type === 'BATTLE_AVOIDED')
    expect(avoided[0]?.messageParams['avoidingSide']).toBe('defender')
  })
})

describe('WarManeuverSystem soft captain general (§19.2)', () => {
  it('captainGeneral が死亡人物でも War は cancel されず、再選出 or undefined になる', () => {
    const world = freshWorld()
    const { war } = injectWar(world)
    // 死亡人物を attacker の captainGeneral に差し込む (dangling soft ref)。
    const deadId = 'pe-dead-cg' as PersonId
    const template = Object.values(world.persons).find((p) => p && p.alive)!
    world.persons[deadId] = { ...template, id: deadId, nameKey: 'dead-cg', alive: false }
    war.attacker.captainGeneralPersonId = deadId
    const next = runWarManeuverSystem(makeCtx(world))
    const w = next.state.wars[war.id]!
    expect(w.status).toBe('active') // soft ref: cancel しない
    expect(w.attacker.captainGeneralPersonId).not.toBe(deadId) // 再選出 or undefined
  })
})

describe('WarManeuverSystem deterministic replay (§19.7)', () => {
  function runWeeks(seed: string, weeks: number): string[] {
    const world = freshWorld('replay-world')
    injectWar(world)
    let ctx = makeCtx(world, defaultConfig, seed)
    const types: string[] = []
    for (let i = 0; i < weeks; i++) {
      ctx = { ...ctx, state: { ...ctx.state, absoluteWeek: ctx.state.absoluteWeek + 1 } }
      const before = ctx.events.length
      ctx = runWarManeuverSystem(ctx)
      for (let j = before; j < ctx.events.length; j++) types.push(ctx.events[j]!.type)
    }
    return types
  }

  it('同 seed・同初期状態 → BATTLE event 列が一致する', () => {
    const a = runWeeks('seed-X', 12)
    const b = runWeeks('seed-X', 12)
    expect(a).toEqual(b)
  })
})

describe('PeaceSettlement stale WarGoal 安全終結 (§8.8)', () => {
  it('active war の tax goal landContract が消えたら white_peace で終結する (年117 crash 回帰)', () => {
    const world = freshWorld()
    const contract = Object.values(world.landContracts).find((c) => c && c.holdingId !== undefined)!
    const polities = Object.values(world.polities).filter((p) => p && p.active)
    const war = createWar(world, {
      attacker: { kind: 'polity', id: polities[0]!.id },
      defender: { kind: 'polity', id: polities[1]!.id },
      warGoals: [
        {
          kind: 'change_contract_tax_rate',
          holdingId: contract.holdingId!,
          landContractId: contract.id,
          baseTaxRateToGrantor: 0.2,
          newTaxRateToGrantor: 0.3,
          requiredWarScore: 50,
        },
      ],
      targetWarScore: 50,
      startedWeek: world.absoluteWeek,
    })
    // 互角戦で長期化中に別システムが landContract を消した状況を再現。
    delete world.landContracts[contract.id]
    const next = runPeaceSettlementSystem(makeCtx(world))
    expect(next.state.wars[war.id]?.status).toBe('white_peace')
    expect(next.state.wars[war.id]?.endedWeek).toBe(world.absoluteWeek)
  })
})

describe('generateCandidateBattlefield (§6.3)', () => {
  function province(terrain: Province['terrain'], features: Province['features']): Province {
    return {
      id: 'pr-x' as ProvinceId,
      stateId: 'sr-x' as Province['stateId'],
      nameKey: 'pr-x',
      x: 0,
      y: 0,
      neighbors: [],
      terrain,
      features,
      holdingIds: [],
    }
  }

  it('terrain → base battlefield をマッピングする (feature 無し)', () => {
    const rng = createRng('bf')
    expect(generateCandidateBattlefield(province('plains', []), rng, defaultConfig).value).toBe(
      'open_field',
    )
    expect(generateCandidateBattlefield(province('forest', []), rng, defaultConfig).value).toBe(
      'forest_battle',
    )
    expect(generateCandidateBattlefield(province('hills', []), rng, defaultConfig).value).toBe(
      'hill_battle',
    )
    expect(generateCandidateBattlefield(province('mountains', []), rng, defaultConfig).value).toBe(
      'mountain_pass',
    )
    expect(generateCandidateBattlefield(province('wetlands', []), rng, defaultConfig).value).toBe(
      'wetland_battle',
    )
  })

  it('同 rng・同 province → 同 kind (決定性)', () => {
    const rng = createRng('bf')
    const p = province('plains', ['major_river'])
    const a = generateCandidateBattlefield(p, rng, defaultConfig)
    const b = generateCandidateBattlefield(p, rng, defaultConfig)
    expect(a.value).toBe(b.value)
  })

  it('major_river は確率 1.0 で river_crossing、0.0 で base に落ちる', () => {
    const rng = createRng('bf')
    const p = province('plains', ['major_river'])
    expect(
      generateCandidateBattlefield(p, rng, {
        ...defaultConfig,
        warBattlefieldRiverCrossingChance: 1,
      }).value,
    ).toBe('river_crossing')
    expect(
      generateCandidateBattlefield(p, rng, {
        ...defaultConfig,
        warBattlefieldRiverCrossingChance: 0,
      }).value,
    ).toBe('open_field')
  })

  it('coastal は major_river 不在時に確率 1.0 で coastal_battle', () => {
    const rng = createRng('bf')
    const p = province('plains', ['coastal'])
    expect(
      generateCandidateBattlefield(p, rng, {
        ...defaultConfig,
        warBattlefieldCoastalBattleChance: 1,
      }).value,
    ).toBe('coastal_battle')
  })

  it('lake は無効 (base terrain のまま)', () => {
    const rng = createRng('bf')
    expect(
      generateCandidateBattlefield(province('hills', ['lake']), rng, defaultConfig).value,
    ).toBe('hill_battle')
  })
})

// v0.36 §9 / §11 / §12: WarManeuver の Regiment 接続。
//   freshWorld は generateWorld で Regiment 生成済。injectWar の defender=owner は当該 holding 由来の
//   Regiment を必ず所有するため、defender 側で mobilize / power / damage / destroy を検証する。
describe('WarManeuverSystem Regiment 接続 (§9 / §11 / §12)', () => {
  function ownerRegimentIds(world: WorldState, owner: PolityId): RegimentId[] {
    return world.regimentIndex.byOwner[politicalActorKey({ kind: 'polity', id: owner })] ?? []
  }

  it('per-war prologue で owner Regiment を defender side に mobilize し byWar に登録する (§9.1)', () => {
    const world = freshWorld()
    const { war, owner } = injectWar(world)
    const ownerRegs = ownerRegimentIds(world, owner)
    expect(ownerRegs.length).toBeGreaterThan(0)

    const next = runWarManeuverSystem(makeCtx(world))
    for (const rid of ownerRegs) {
      const r = next.state.regiments[rid]!
      expect(r.currentWarId).toBe(war.id)
      expect(r.currentSide).toBe('defender')
      expect(r.mobilizedByPolityId).toBe(owner)
    }
    const byWar = next.state.regimentIndex.byWar[war.id] ?? []
    expect(byWar.length).toBeGreaterThanOrEqual(ownerRegs.length)
  })

  it('both accept battle で Battle entity を生成し power=Regiment 合計・org を損耗させる (§11.3 / §12)', () => {
    const world = freshWorld()
    const { war, owner } = injectWar(world)
    const ownerRegs = ownerRegimentIds(world, owner)
    // defenderBasePower は getRegimentPowerForWarSide = Σ effectivePower を格納する (命名は basePower だが中身は
    //   side 集計 effectivePower)。v0.37 B1 で初期 org=baseline(50) になり effectivePower≠basePower のため、
    //   effectivePower 集計で期待値を組む。
    const expectedDefPower = ownerRegs.reduce(
      (sum, rid) => sum + getRegimentEffectivePower(world.regiments[rid]!),
      0,
    )

    const config = deterministicConfig({
      warAvoidanceTerrainModifierByBattlefield: terrainAll(-10),
    })
    const next = runWarManeuverSystem(makeCtx(world, config))
    expect(next.events.some((e) => e.type === 'BATTLE_OCCURRED')).toBe(true)

    const bids = next.state.battleIndex.byWar[war.id] ?? []
    expect(bids).toHaveLength(1)
    const battle = next.state.battles[bids[0]!]!
    expect(battle.warId).toBe(war.id)
    expect(battle.defenderRegimentIds).toHaveLength(ownerRegs.length)
    // defenderBasePower = defender Regiment effectivePower 合計 (旧 fallback でない)
    expect(battle.defenderBasePower).toBeCloseTo(expectedDefPower)

    // org 損耗: defender 全 mobilized Regiment の organization < 100 (winner でも min 4 削れる)
    for (const rid of ownerRegs) {
      expect(next.state.regiments[rid]!.organization).toBeLessThan(100)
    }
    const defResults = battle.regimentResults.filter((rr) => rr.side === 'defender')
    expect(defResults).toHaveLength(ownerRegs.length)
    expect(defResults.every((rr) => rr.organizationDamage > 0)).toBe(true)

    // v0.36 §16: BATTLE_OCCURRED の counts-only enrich。battleId / 両 side 連隊数が Battle entity と一致する。
    const occurred = next.events.find((e) => e.type === 'BATTLE_OCCURRED')!
    expect(occurred.messageParams.battleId).toBe(battle.id)
    expect(occurred.messageParams.defenderRegimentCount).toBe(battle.defenderRegimentIds.length)
    expect(occurred.messageParams.defenderRegimentCount).toBe(ownerRegs.length)
    expect(occurred.messageParams.attackerRegimentCount).toBe(battle.attackerRegimentIds.length)
  })

  it('strength が destroyedThreshold 以下になった Regiment を destroyed 化し byWar から外す (§12.6)', () => {
    const world = freshWorld()
    const { war, owner } = injectWar(world)
    const ownerRegs = ownerRegimentIds(world, owner)
    // defender Regiment を strength=1 に弱体化。どの battle 結果でも strength damage 5 で 0→destroyed。
    for (const rid of ownerRegs) {
      world.regiments[rid] = { ...world.regiments[rid]!, strength: 1 }
    }
    const config = deterministicConfig({
      warAvoidanceTerrainModifierByBattlefield: terrainAll(-10),
      regimentStrengthDamageWinnerMin: 5,
      regimentStrengthDamageWinnerMax: 5,
      regimentStrengthDamageLoserMin: 5,
      regimentStrengthDamageLoserMax: 5,
      regimentStrengthDamageInconclusiveMin: 5,
      regimentStrengthDamageInconclusiveMax: 5,
    })
    const next = runWarManeuverSystem(makeCtx(world, config))
    expect(next.events.some((e) => e.type === 'BATTLE_OCCURRED')).toBe(true)

    const byWar = next.state.regimentIndex.byWar[war.id] ?? []
    for (const rid of ownerRegs) {
      const r = next.state.regiments[rid]!
      expect(r.status).toBe('destroyed')
      expect(r.currentWarId).toBeUndefined()
      expect(byWar.includes(rid)).toBe(false)
    }
    // byOwner には残る (§10.4 (d) の 0-power 判定に必要)
    const ownerKey = politicalActorKey({ kind: 'polity', id: owner })
    expect(next.state.regimentIndex.byOwner[ownerKey] ?? []).toHaveLength(ownerRegs.length)
  })
})
