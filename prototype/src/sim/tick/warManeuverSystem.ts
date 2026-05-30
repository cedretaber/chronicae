import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { WarSide, WarSideKey, BattleResult, BattleInitiationKind } from '../types/war'
import type { WarId, PersonId, PolityId } from '../types/ids'
import type { Regiment } from '../types/regiment'
import type { BattleRegimentResult } from '../types/battle'
import type { RngState } from '../rng/rng'
import type { SimulationConfig } from '../config/defaultConfig'
import { randomFloat, randomInt } from '../rng/rng'
import { clamp } from '../utils/math'
import {
  updateWar,
  updateWarSideMut,
  getWarPrimaryAttacker,
  getWarPrimaryDefender,
} from '../mutations/warMutations'
import {
  mobilizeRegimentsForWar,
  updateRegimentMut,
  destroyRegimentMut,
} from '../mutations/regimentMutations'
import { createBattle } from '../mutations/battleMutations'
import { isActorActive } from '../selectors/actorSelectors'
import { getRoleScore } from '../selectors/abilitySelectors'
import { getRegimentPowerForWarSide, getRegimentsForWarSide } from '../selectors/regimentSelectors'
import {
  getWarSidePrimaryPolityActor,
  selectCaptainGeneralForWarSide,
  buildWarSideCommanderCandidates,
  getWarGoalProvince,
  generateCandidateBattlefield,
  isEligibleWarPerson,
} from '../selectors/warManeuverSelectors'
import { emitBattleOccurred, emitBattleAvoided, emitCaptainGeneralChanged } from './warEvents'

// v0.35 §7 WarManeuverSystem — 旧 WarProgressSystem を置換する (intervalWeeks 1 / 毎週)。
//
// 毎週 active War ごとに「総大将が戦場を選び、両軍が戦うか避けるか判断し、現場指揮官と地形により
//   Battle / Avoidance が発生して warScore が動く」を解決する。終結判定は PeaceSettlementSystem の責務。
//
// 規約:
//   - clone-once → mutate-in-loop (updateWar / updateWarSideMut は mutating/void)
//   - rng は ctx.rng から threading (conflictResolutionSystem パターン)。state draft と rng の 2 可変状態を運ぶ
//   - active War は Object.keys().sort() で deterministic iteration
//   - lastWarWeek 更新責務を旧 WarProgress から継承 (§2.1。戦闘有無に関わらず毎週、active polity 両陣営)
//   - captainGeneral / commander は soft reference。冒頭で lazy 再選出/再構築 (§2.2)
//   - per-tick drift は撤廃。warScore は battle / avoidance 時のみ動く (§7.1)

// commander の warCommand による戦力補正 (§10.4)。undefined は 1.0。
function commanderModifier(
  state: WorldState,
  config: SimulationConfig,
  commanderId: PersonId | undefined,
): number {
  if (commanderId === undefined) return 1.0
  const score = getRoleScore(state, commanderId, 'warCommand')
  return clamp(
    1 + ((score - 50) / 100) * config.warCommanderWarCommandEffect,
    config.minWarCommanderModifier,
    config.maxWarCommanderModifier,
  )
}

// 総大将の warScore 効率 (§10.7)。勝者側に乗算。undefined は 1.0。
function captainGeneralEfficiency(
  state: WorldState,
  config: SimulationConfig,
  captainGeneralId: PersonId | undefined,
): number {
  if (captainGeneralId === undefined) return 1.0
  const score = getRoleScore(state, captainGeneralId, 'warCommand')
  return 1 + ((score - 50) / 100) * config.captainGeneralWarScoreEffect
}

type EngagementOpts = {
  side: WarSideKey
  warScore: number
  ownPower: number
  enemyPower: number
  captainGeneralId: PersonId | undefined
  avoidanceCount: number
  terrainAvoidability: number
}

// §8 Engagement decision。avoidDesire > 0 で avoid。avoidanceCount >= max は強制 accept (§9.1)。
//   captainGeneral undefined は中立値 (ambition=caution=0.5) で通常計算 (§8.2)。常に 1 draw 消費 (固定)。
function decideEngagement(
  state: WorldState,
  config: SimulationConfig,
  rng: RngState,
  opts: EngagementOpts,
): { avoid: boolean; rng: RngState } {
  const { value: noise, rng: nextRng } = randomFloat(rng)
  const forceRatio = opts.ownPower / (opts.ownPower + opts.enemyPower + 1)
  const forceDisadvantage = Math.max(0, 0.5 - forceRatio)
  const cg = opts.captainGeneralId ? state.persons[opts.captainGeneralId] : undefined
  const ambition = cg?.traits.ambition ?? 0.5
  const caution = cg?.traits.caution ?? 0.5
  // 負けている側ほど urgency 高 (いずれ戦わざるを得ない圧力)。attacker は warScore 負、defender は正で負け。
  const losing = opts.side === 'attacker' ? -opts.warScore / 100 : opts.warScore / 100
  const urgency = Math.max(0, losing) * config.warEngagementWarScoreUrgencyEffect
  const avoidDesire =
    forceDisadvantage +
    caution * config.warEngagementCautionEffect +
    opts.terrainAvoidability -
    urgency -
    ambition * config.warEngagementAmbitionEffect -
    opts.avoidanceCount * config.warAvoidanceCountPenalty +
    (noise - 0.5) * config.warEngagementRandomness
  const forcedAccept = opts.avoidanceCount >= config.maxWarAvoidanceCount
  return { avoid: !forcedAccept && avoidDesire > 0, rng: nextRng }
}

type AvoidanceOpts = {
  ownPower: number
  enemyPower: number
  ownCaptainGeneralId: PersonId | undefined
  enemyCaptainGeneralId: PersonId | undefined
  ownAvoidanceCount: number
  terrainAvoidability: number
}

// §9.2 回避成功判定 (片側のみ avoid のとき)。1 draw 消費。
function resolveAvoidanceSuccess(
  state: WorldState,
  config: SimulationConfig,
  rng: RngState,
  opts: AvoidanceOpts,
): { success: boolean; rng: RngState } {
  const ownCgScore =
    opts.ownCaptainGeneralId !== undefined
      ? getRoleScore(state, opts.ownCaptainGeneralId, 'warCommand')
      : 50
  const enemyCgScore =
    opts.enemyCaptainGeneralId !== undefined
      ? getRoleScore(state, opts.enemyCaptainGeneralId, 'warCommand')
      : 50
  const forceRatio = opts.ownPower / (opts.ownPower + opts.enemyPower + 1)
  const forceDisadvantage = Math.max(0, 0.5 - forceRatio)
  const chance =
    config.warAvoidanceBaseChance +
    ((ownCgScore - 50) / 100) * config.warAvoidanceWarCommandEffect +
    opts.terrainAvoidability +
    forceDisadvantage -
    opts.ownAvoidanceCount * config.warAvoidanceCountPenalty -
    Math.max(0, (enemyCgScore - 50) / 100) * config.warAvoidanceWarCommandEffect
  const { value, rng: nextRng } = randomFloat(rng)
  return { success: value < clamp(chance, 0, 1), rng: nextRng }
}

type BattleParams = {
  attackerPower: number
  defenderPower: number
  attackerCommanderId: PersonId | undefined
  defenderCommanderId: PersonId | undefined
  attackerCaptainGeneralId: PersonId | undefined
  defenderCaptainGeneralId: PersonId | undefined
}

// §10 Battle resolution。2 draw 消費 (side ごと randomness)。
//   warScoreDelta は cg 効率を勝者側に乗算後、maxWarScoreDeltaPerBattle で clamp 済みで返す。
function resolveBattle(
  state: WorldState,
  config: SimulationConfig,
  rng: RngState,
  p: BattleParams,
): {
  result: BattleResult
  warScoreDelta: number
  attackerEffectivePower: number
  defenderEffectivePower: number
  rng: RngState
} {
  const atkCmd = commanderModifier(state, config, p.attackerCommanderId)
  const defCmd = commanderModifier(state, config, p.defenderCommanderId)
  const { value: atkNoise, rng: rng1 } = randomFloat(rng)
  const { value: defNoise, rng: rng2 } = randomFloat(rng1)
  const atkRand = 1 + (atkNoise - 0.5) * 2 * config.warBattleRandomness
  const defRand = 1 + (defNoise - 0.5) * 2 * config.warBattleRandomness
  const attackerEffectivePower = p.attackerPower * atkCmd * atkRand
  const defenderEffectivePower = p.defenderPower * defCmd * defRand
  const advantage = attackerEffectivePower / (attackerEffectivePower + defenderEffectivePower + 1)
  let rawDelta = (advantage - 0.5) * config.warBattleScoreScale
  const result: BattleResult =
    rawDelta > config.battleVictoryThreshold
      ? 'attacker_victory'
      : rawDelta < -config.battleVictoryThreshold
        ? 'defender_victory'
        : 'inconclusive'
  // §10.7: 勝者側 captainGeneral の効率で warScoreDelta をスケール。
  if (rawDelta > 0) {
    rawDelta *= captainGeneralEfficiency(state, config, p.attackerCaptainGeneralId)
  } else if (rawDelta < 0) {
    rawDelta *= captainGeneralEfficiency(state, config, p.defenderCaptainGeneralId)
  }
  const warScoreDelta = clamp(
    rawDelta,
    -config.maxWarScoreDeltaPerBattle,
    config.maxWarScoreDeltaPerBattle,
  )
  return { result, warScoreDelta, attackerEffectivePower, defenderEffectivePower, rng: rng2 }
}

type BattleDamageRole = 'winner' | 'loser' | 'inconclusive'

// §12: 1 side の battle 後損耗。role から org/strength の damage を各 1 値 rng で決め (2 draw 消費)、
//   その side の mobilized active Regiment 全部に同量適用する (頭割りでない。§12.4)。
//   clamp 済 strength が destroyedThreshold 以下なら destroy (§12.6)。各 Regiment の before/after で
//   BattleRegimentResult を返す (morale* は v0.36 では設定しない。§7.1)。
function applySideBattleDamage(
  ws: WorldState,
  config: SimulationConfig,
  rng: RngState,
  side: WarSideKey,
  regiments: Regiment[],
  role: BattleDamageRole,
): { rng: RngState; results: BattleRegimentResult[] } {
  const [orgMin, orgMax, strMin, strMax] =
    role === 'winner'
      ? [
          config.regimentOrganizationDamageWinnerMin,
          config.regimentOrganizationDamageWinnerMax,
          config.regimentStrengthDamageWinnerMin,
          config.regimentStrengthDamageWinnerMax,
        ]
      : role === 'loser'
        ? [
            config.regimentOrganizationDamageLoserMin,
            config.regimentOrganizationDamageLoserMax,
            config.regimentStrengthDamageLoserMin,
            config.regimentStrengthDamageLoserMax,
          ]
        : [
            config.regimentOrganizationDamageInconclusiveMin,
            config.regimentOrganizationDamageInconclusiveMax,
            config.regimentStrengthDamageInconclusiveMin,
            config.regimentStrengthDamageInconclusiveMax,
          ]
  const orgDraw = randomInt(rng, orgMin, orgMax)
  const strDraw = randomInt(orgDraw.rng, strMin, strMax)
  const orgDamage = orgDraw.value
  const strengthDamage = strDraw.value

  const results: BattleRegimentResult[] = []
  for (const r of regiments) {
    const orgBefore = r.organization
    const strBefore = r.strength
    const orgAfter = clamp(orgBefore - orgDamage, 0, 100)
    const strAfter = clamp(strBefore - strengthDamage, 0, r.maxStrength)
    updateRegimentMut(ws, r.id, { organization: orgAfter, strength: strAfter })
    if (strAfter <= config.regimentDestroyedStrengthThreshold) {
      destroyRegimentMut(ws, r.id)
    }
    results.push({
      regimentId: r.id,
      side,
      strengthBefore: strBefore,
      strengthAfter: strAfter,
      strengthDamage: strBefore - strAfter,
      organizationBefore: orgBefore,
      organizationAfter: orgAfter,
      organizationDamage: orgBefore - orgAfter,
    })
  }
  return { rng: strDraw.rng, results }
}

// step 3: captainGeneral lazy refresh (§4.4)。現 CG が eligible なら据置。
//   不適格/undefined なら再選出。変化時 event (初回任命 old===undefined は event なし)。
function refreshCaptainGeneral(
  ctx: TickContext,
  ws: WorldState,
  wid: WarId,
  sideKey: WarSideKey,
): TickContext {
  const war = ws.wars[wid]
  if (!war) return ctx
  const polityId = getWarSidePrimaryPolityActor(war, sideKey)
  if (polityId === undefined) return ctx // house actor: CG 管理 no-op (§16)
  const side = sideKey === 'attacker' ? war.attacker : war.defender
  const current = side.captainGeneralPersonId
  if (current !== undefined && isEligibleWarPerson(ws, current)) return ctx
  const newCG = selectCaptainGeneralForWarSide(ws, polityId)
  if (newCG === current) return ctx // 双方 undefined or 変化なし
  if (newCG === undefined) {
    // soft ref を消す (exactOptionalPropertyTypes: undefined 代入でなく key 削除)。
    const cleared: WarSide = { ...side }
    delete cleared.captainGeneralPersonId
    updateWar(ws, wid, { [sideKey]: cleared })
  } else {
    updateWarSideMut(ws, wid, sideKey, { captainGeneralPersonId: newCG })
  }
  // 初回任命 (current undefined) は event 不要 (§4.4)。
  if (current !== undefined) {
    return emitCaptainGeneralChanged(ctx, war, sideKey, current, newCG)
  }
  return ctx
}

// step 4: commander candidates lazy refresh (§5.2)。変化時のみ WarSide 更新。event なし。
function refreshCommanders(
  ws: WorldState,
  wid: WarId,
  sideKey: WarSideKey,
  polityId: PolityId,
): void {
  const war = ws.wars[wid]
  if (!war) return
  const side = sideKey === 'attacker' ? war.attacker : war.defender
  const candidates = buildWarSideCommanderCandidates(ws, polityId, side.captainGeneralPersonId)
  const same =
    candidates.length === side.commanderPersonIds.length &&
    candidates.every((id, i) => id === side.commanderPersonIds[i])
  if (!same) updateWarSideMut(ws, wid, sideKey, { commanderPersonIds: candidates })
}

export function runWarManeuverSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek
  const activeWarIds = Object.keys(ctx.state.wars)
    .sort()
    .filter((id) => ctx.state.wars[id as WarId]?.status === 'active')
  if (activeWarIds.length === 0) return ctx

  // clone-once draft。以後 ws を破壊的に更新し、next.state は ws を参照し続ける。
  //   v0.36: regiment / battle の mut helper が in-place で touch するため records / index を clone する。
  const ws: WorldState = {
    ...ctx.state,
    wars: { ...ctx.state.wars },
    polities: { ...ctx.state.polities },
    regiments: { ...ctx.state.regiments },
    regimentIndex: {
      byOwner: { ...ctx.state.regimentIndex.byOwner },
      byWar: { ...ctx.state.regimentIndex.byWar },
      byHomeProvince: { ...ctx.state.regimentIndex.byHomeProvince },
      byHomeHolding: { ...ctx.state.regimentIndex.byHomeHolding },
    },
    battles: { ...ctx.state.battles },
    battleIndex: { byWar: { ...ctx.state.battleIndex.byWar } },
  }
  let next: TickContext = { ...ctx, state: ws }

  for (const idStr of activeWarIds) {
    const wid = idStr as WarId
    const war = ws.wars[wid]
    if (!war) continue
    const atkActor = getWarPrimaryAttacker(war)?.actor
    const defActor = getWarPrimaryDefender(war)?.actor
    if (!atkActor || !defActor) continue
    if (!isActorActive(ws, atkActor) || !isActorActive(ws, defActor)) continue

    // step 2: lastWarWeek 更新 (active polity actor 両陣営。house は no-op)。step 2 前で early-continue 禁止。
    for (const actor of [atkActor, defActor]) {
      if (actor.kind === 'polity') {
        const pol = ws.polities[actor.id]
        if (pol) ws.polities[actor.id] = { ...pol, lastWarWeek: absoluteWeek }
      }
    }

    // step 2.5: target 到達済みは warScore 凍結 (§7.2)。lastWarWeek は更新済。
    if (Math.abs(war.warScore) >= war.targetWarScore) continue

    // step 2.6 (v0.36 §9.1): per-war prologue で Regiment を mobilize する (idempotent / rng 非消費)。
    //   power 読み取り (§11.3) の直前に必ず動員され、「War 成立直後の初回 battle だけ fallback」事故を防ぐ。
    mobilizeRegimentsForWar(ws, wid, 'attacker', absoluteWeek)
    mobilizeRegimentsForWar(ws, wid, 'defender', absoluteWeek)

    // step 3: captainGeneral lazy refresh
    next = refreshCaptainGeneral(next, ws, wid, 'attacker')
    next = refreshCaptainGeneral(next, ws, wid, 'defender')
    const war2 = ws.wars[wid]
    if (!war2) continue

    const atkPolity = getWarSidePrimaryPolityActor(war2, 'attacker')
    const defPolity = getWarSidePrimaryPolityActor(war2, 'defender')
    if (atkPolity === undefined || defPolity === undefined) continue // house actor war: maneuver no-op

    // step 4: commander candidates lazy refresh
    refreshCommanders(ws, wid, 'attacker', atkPolity)
    refreshCommanders(ws, wid, 'defender', defPolity)
    const war3 = ws.wars[wid]
    if (!war3) continue

    // step 5: candidate province。未解決なら 6〜11 skip (warScore 不変・event なし)。
    const provinceId = getWarGoalProvince(ws, war3)
    if (provinceId === undefined) continue
    const province = ws.provinces[provinceId]
    if (!province) continue

    // step 6: candidate battlefield (rng)
    const bf = generateCandidateBattlefield(province, next.rng, config)
    next = { ...next, rng: bf.rng }
    const battlefieldKind = bf.value
    const terrainAvoidability =
      config.warAvoidanceTerrainModifierByBattlefield[battlefieldKind] ?? 0

    const atkCG = war3.attacker.captainGeneralPersonId
    const defCG = war3.defender.captainGeneralPersonId
    const atkCommander = war3.attacker.commanderPersonIds[0]
    const defCommander = war3.defender.commanderPersonIds[0]
    // v0.36 §11.3: power 入力を Regiment 化 (単一計算箇所。avoidance 判断・回避成功・battle すべての入力)。
    //   mobilize 済 (step 2.6) なので byWar から合計、Regiment record 無し actor は旧 power fallback (§10.4)。
    const atkPower = getRegimentPowerForWarSide(ws, config, war3, 'attacker')
    const defPower = getRegimentPowerForWarSide(ws, config, war3, 'defender')
    const atkAvoid0 = war3.attacker.avoidanceCount
    const defAvoid0 = war3.defender.avoidanceCount
    const before = war3.warScore

    // step 7-8: engagement decision (attacker → defender の固定順)
    const atkDec = decideEngagement(ws, config, next.rng, {
      side: 'attacker',
      warScore: before,
      ownPower: atkPower,
      enemyPower: defPower,
      captainGeneralId: atkCG,
      avoidanceCount: atkAvoid0,
      terrainAvoidability,
    })
    next = { ...next, rng: atkDec.rng }
    const defDec = decideEngagement(ws, config, next.rng, {
      side: 'defender',
      warScore: before,
      ownPower: defPower,
      enemyPower: atkPower,
      captainGeneralId: defCG,
      avoidanceCount: defAvoid0,
      terrainAvoidability,
    })
    next = { ...next, rng: defDec.rng }

    // step 9-11: 戦闘ブランチ (both accept / 回避失敗) を解決し warScore 更新 + BATTLE_OCCURRED。
    const runBattleBranch = (initiationKind: BattleInitiationKind, n: TickContext): TickContext => {
      const battle = resolveBattle(ws, config, n.rng, {
        attackerPower: atkPower,
        defenderPower: defPower,
        attackerCommanderId: atkCommander,
        defenderCommanderId: defCommander,
        attackerCaptainGeneralId: atkCG,
        defenderCaptainGeneralId: defCG,
      })
      let nn: TickContext = { ...n, rng: battle.rng }
      const after = clamp(before + battle.warScoreDelta, -100, 100)
      updateWar(ws, wid, { warScore: after })
      // 回避失敗 side の avoidanceCount を +1 (§9.4)。
      if (initiationKind === 'attacker_avoidance_failed') {
        updateWarSideMut(ws, wid, 'attacker', { avoidanceCount: atkAvoid0 + 1 })
      } else if (initiationKind === 'defender_avoidance_failed') {
        updateWarSideMut(ws, wid, 'defender', { avoidanceCount: defAvoid0 + 1 })
      }

      // v0.36 §12: damage 前に mobilized active Regiment を両 side 確定 (destroy が byWar を変えるため)。
      const atkRegiments = getRegimentsForWarSide(ws, wid, 'attacker').filter(
        (r) => r.status === 'active',
      )
      const defRegiments = getRegimentsForWarSide(ws, wid, 'defender').filter(
        (r) => r.status === 'active',
      )
      const atkRole: BattleDamageRole =
        battle.result === 'attacker_victory'
          ? 'winner'
          : battle.result === 'defender_victory'
            ? 'loser'
            : 'inconclusive'
      const defRole: BattleDamageRole =
        battle.result === 'defender_victory'
          ? 'winner'
          : battle.result === 'attacker_victory'
            ? 'loser'
            : 'inconclusive'
      const atkDmg = applySideBattleDamage(ws, config, nn.rng, 'attacker', atkRegiments, atkRole)
      const defDmg = applySideBattleDamage(
        ws,
        config,
        atkDmg.rng,
        'defender',
        defRegiments,
        defRole,
      )
      nn = { ...nn, rng: defDmg.rng }

      // v0.36 §7 / §11.3: Battle entity を記録 (cleanupWarSystem が war 削除時に piggyback cleanup)。
      createBattle(ws, {
        warId: wid,
        week: absoluteWeek,
        provinceId,
        battlefieldKind,
        initiationKind,
        result: battle.result,
        attackerRegimentIds: atkRegiments.map((r) => r.id),
        defenderRegimentIds: defRegiments.map((r) => r.id),
        regimentResults: [...atkDmg.results, ...defDmg.results],
        attackerBasePower: atkPower,
        defenderBasePower: defPower,
        attackerEffectivePower: battle.attackerEffectivePower,
        defenderEffectivePower: battle.defenderEffectivePower,
        warScoreDelta: after - before,
        warScoreAfter: after,
      })

      const w = ws.wars[wid]
      if (!w) return nn
      nn = emitBattleOccurred(nn, w, {
        provinceId,
        battlefieldKind,
        initiationKind,
        result: battle.result,
        ...(atkCG ? { attackerCaptainGeneralId: atkCG } : {}),
        ...(defCG ? { defenderCaptainGeneralId: defCG } : {}),
        ...(atkCommander ? { attackerCommanderId: atkCommander } : {}),
        ...(defCommander ? { defenderCommanderId: defCommander } : {}),
        attackerPower: atkPower,
        defenderPower: defPower,
        attackerEffectivePower: battle.attackerEffectivePower,
        defenderEffectivePower: battle.defenderEffectivePower,
        warScoreDelta: after - before,
        warScoreAfter: after,
      })
      return nn
    }

    if (atkDec.avoid && defDec.avoid) {
      // both avoid → warScore 不変、両 avoidanceCount +1、BATTLE_AVOIDED('both')
      updateWarSideMut(ws, wid, 'attacker', { avoidanceCount: atkAvoid0 + 1 })
      updateWarSideMut(ws, wid, 'defender', { avoidanceCount: defAvoid0 + 1 })
      const w = ws.wars[wid]
      if (w) {
        next = emitBattleAvoided(next, w, {
          provinceId,
          battlefieldKind,
          avoidingSide: 'both',
          ...(atkCG ? { attackerCaptainGeneralId: atkCG } : {}),
          ...(defCG ? { defenderCaptainGeneralId: defCG } : {}),
          avoidanceSucceeded: true,
          attackerAvoidanceCountAfter: atkAvoid0 + 1,
          defenderAvoidanceCountAfter: defAvoid0 + 1,
          warScoreDelta: 0,
          warScoreAfter: before,
        })
      }
    } else if (atkDec.avoid !== defDec.avoid) {
      // 片側のみ avoid → 回避成功判定
      const avoider: WarSideKey = atkDec.avoid ? 'attacker' : 'defender'
      const av = resolveAvoidanceSuccess(ws, config, next.rng, {
        ownPower: avoider === 'attacker' ? atkPower : defPower,
        enemyPower: avoider === 'attacker' ? defPower : atkPower,
        ownCaptainGeneralId: avoider === 'attacker' ? atkCG : defCG,
        enemyCaptainGeneralId: avoider === 'attacker' ? defCG : atkCG,
        ownAvoidanceCount: avoider === 'attacker' ? atkAvoid0 : defAvoid0,
        terrainAvoidability,
      })
      next = { ...next, rng: av.rng }

      if (av.success) {
        // 回避成功: avoider の avoidanceCount +1、warScore penalty、BATTLE_AVOIDED
        if (avoider === 'attacker') {
          updateWarSideMut(ws, wid, 'attacker', { avoidanceCount: atkAvoid0 + 1 })
        } else {
          updateWarSideMut(ws, wid, 'defender', { avoidanceCount: defAvoid0 + 1 })
        }
        const delta =
          avoider === 'attacker'
            ? -config.warAvoidanceWarScorePenalty
            : config.warAvoidanceWarScorePenalty
        const after = clamp(before + delta, -100, 100)
        updateWar(ws, wid, { warScore: after })
        const w = ws.wars[wid]
        if (w) {
          next = emitBattleAvoided(next, w, {
            provinceId,
            battlefieldKind,
            avoidingSide: avoider,
            ...(atkCG ? { attackerCaptainGeneralId: atkCG } : {}),
            ...(defCG ? { defenderCaptainGeneralId: defCG } : {}),
            avoidanceSucceeded: true,
            attackerAvoidanceCountAfter: w.attacker.avoidanceCount,
            defenderAvoidanceCountAfter: w.defender.avoidanceCount,
            warScoreDelta: after - before,
            warScoreAfter: after,
          })
        }
      } else {
        // 回避失敗 → 通常 Battle (initiationKind に記録、avoider の avoidanceCount は branch 内で +1)
        const initiationKind: BattleInitiationKind =
          avoider === 'attacker' ? 'attacker_avoidance_failed' : 'defender_avoidance_failed'
        next = runBattleBranch(initiationKind, next)
      }
    } else {
      // both accept → Battle
      next = runBattleBranch('mutual_engagement', next)
    }
  }

  return next
}
