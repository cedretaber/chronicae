import type { TickContext } from './context'
import type { WarId, PolityId } from '../types/ids'
import type { War, WarGoal, ChangeContractTaxRateWarGoal } from '../types/war'
import type { WorldState } from '../types/world'
import { getWarPrimaryAttacker, getWarPrimaryDefender } from '../mutations/warMutations'
import { isOrganizationActive } from '../selectors/organizationSelectors'
import { politiesShareOwnerHouse } from '../selectors/polityRelations'
import {
  applyLandContractTransferGoal,
  adjustLandContractTaxRate,
  eliminateContractFromChain,
} from '../mutations/landContractMutations'
import { getHoldingLandContractChain } from '../selectors/landContractSelectors'
import { resolveLandContractDefaultState } from '../mutations/landContractDefaultMutations'
import { emitWarOutcome, emitWarEnded, emitPeaceSettlementApplied } from './warEvents'
import { spawnWarDamageCrisis } from './crisisSystem'
import { awardWarOutcomeCtx } from '../helpers/awardHelpers'
import { establishCommonwealth, suppressRevolt } from '../mutations/worldStructureMutations'

// v0.34 §8 PeaceSettlementSystem
//
// active War の warScore が閾値に達したら終結させ、WarGoal を state に反映する。
//   warScore >= targetWarScore        → attacker_won (WarGoal 実行)
//   warScore <= -targetWarScore       → defender_won (status quo)
//   absoluteWeek-startedWeek >= maxWarDurationWeeks → white_peace (timeout, §8.2.1)
//
// dead-participant guard (§B advisor①): primary participant が missing/inactive な War は skip
//   (cancelOrphanedWarsSystem が cancelled 化する)。
//
// event 責務 (§8.6a): transfer は applyLandContractTransferGoal が LAND_CONTRACT_* を内部発行するので
//   PeaceSettlement では重複させない。tax は底層 mutation が event 無なので PEACE_SETTLEMENT_APPLIED を出す。

// War status / endedWeek の immutable patch。
function patchWar(ctx: TickContext, warId: WarId, patch: Partial<War>): TickContext {
  const war = ctx.state.wars[warId]
  if (!war) return ctx
  return {
    ...ctx,
    state: {
      ...ctx.state,
      wars: { ...ctx.state.wars, [warId]: { ...war, ...patch } },
    },
  }
}

// §8.2.1 / §8.8: 拮抗 timeout / WarGoal stale → 安全に白紙和平で終結。
function settleWhitePeace(ctx: TickContext, warId: WarId): TickContext {
  const next = patchWar(ctx, warId, { status: 'white_peace', endedWeek: ctx.state.absoluteWeek })
  const w = next.state.wars[warId]
  // v0.44 §8: 終結時に指揮官へ経験を付与 (white_peace は評判なし)
  return w ? awardWarOutcomeCtx(emitWarEnded(next, w), w) : next
}

// §8.4 defender 勝利 → status quo (WarGoal 不実行)。revolt の場合は suppressRevolt を実行。
function settleDefenderWon(ctx: TickContext, warId: WarId): TickContext {
  const war = ctx.state.wars[warId]
  if (!war) return ctx

  // v0.39: revolt War → suppression
  const revoltGoal = war.warGoals.find((g) => g.kind === 'popular_revolt_independence')
  if (revoltGoal && revoltGoal.kind === 'popular_revolt_independence') {
    const result = suppressRevolt(ctx, {
      commonwealthPolityId: revoltGoal.commonwealthPolityId,
      revoltDefaultIds: revoltGoal.revoltDefaultIds,
      holdingIds: revoltGoal.holdingIds,
    })
    let next = result.ok ? result.value.ctx : ctx
    next = patchWar(next, warId, { status: 'defender_won', endedWeek: next.state.absoluteWeek })
    const w = next.state.wars[warId]
    // v0.44 §8: 勝者 = defender 側に成功評価
    return w ? awardWarOutcomeCtx(emitWarOutcome(next, w, false), w) : next
  }

  const next = patchWar(ctx, warId, { status: 'defender_won', endedWeek: ctx.state.absoluteWeek })
  const w = next.state.wars[warId]
  return w ? awardWarOutcomeCtx(emitWarOutcome(next, w, false), w) : next
}

// §8.6: tax goal を適用する。底層 mutation は event を発行しない。
//   contract が stale (消失 / holdingId 不一致) なら applied:false を返し、呼び出し側が white_peace に倒す。
function applyTaxGoal(
  ctx: TickContext,
  goal: ChangeContractTaxRateWarGoal,
  defenderPolityId: PolityId | undefined,
): { ctx: TickContext; applied: boolean } {
  const result = applyTaxGoalCore(ctx, goal, defenderPolityId)
  // v0.53 Phase 4: enforce_land_contract_default 由来の勝利は、税率適用後に対象 default を resolved にする。
  if (result.applied && goal.resolvesLandContractDefaultId !== undefined) {
    const nextState = resolveLandContractDefaultState(
      result.ctx.state,
      goal.resolvesLandContractDefaultId,
    )
    return { ctx: { ...result.ctx, state: nextState }, applied: true }
  }
  return result
}

function applyTaxGoalCore(
  ctx: TickContext,
  goal: ChangeContractTaxRateWarGoal,
  defenderPolityId: PolityId | undefined,
): { ctx: TickContext; applied: boolean } {
  const config = ctx.config
  const state = ctx.state
  const contract = state.landContracts[goal.landContractId]
  if (!contract || contract.holdingId !== goal.holdingId) return { ctx, applied: false }

  const newRate = goal.newTaxRateToGrantor
  // v0.53 Phase 4: enforce_land_contract_default 由来 (resolvesLandContractDefaultId あり) は
  //   契約の「復元」が目的。境界税率でも eliminate せず税率調整のみ (default 解消は wrapper が行う)。
  const isEnforceRestore = goal.resolvesLandContractDefaultId !== undefined
  // 通常の税率変更。
  if (
    isEnforceRestore ||
    (newRate > config.taxRevisionMinRate && newRate < config.taxRevisionMaxRate)
  ) {
    return {
      ctx: { ...ctx, state: adjustLandContractTaxRate(state, goal.landContractId, newRate) },
      applied: true,
    }
  }
  // 境界値 → 契約排除 (既存 conflictResolution の縮小分岐を踏襲)。
  const isReduction = newRate <= config.taxRevisionMinRate
  if (isReduction) {
    // grantor 側 (defender) の非 root 契約を排除する。
    const chain = getHoldingLandContractChain(state, goal.holdingId)
    const grantorContract = defenderPolityId
      ? chain.find((c) => c.granteePolityId === defenderPolityId && !c.rootAuthorityId)
      : undefined
    if (grantorContract) {
      const inherited = grantorContract.terms.taxRateToGrantor
      return {
        ctx: { ...ctx, state: eliminateContractFromChain(state, grantorContract.id, inherited) },
        applied: true,
      }
    }
    // §8.8: 除去対象 (defender の非 root 契約) が chain に無い → 構造変化を起こせない。
    //   旧実装は applied:true を返して「勝利＝契約解除」と記録していたが、実際には何も変わらず、
    //   同一 holding への解除戦争が無限再発する原因だった (overlord 契約が既に除去済み /
    //   overlord が主権者で除去不能なケース)。applied:false で white_peace に倒し、偽の
    //   「土地契約が解除された」イベントを出さない (主因の抑止は §6.69 の aim 発火ゲート)。
    return { ctx, applied: false }
  }
  // 増加境界 → 対象契約を排除 (lower elimination)。
  return {
    ctx: { ...ctx, state: eliminateContractFromChain(state, goal.landContractId) },
    applied: true,
  }
}

// §8.3 / §8.5 / §8.6: attacker 勝利 → WarGoal を実行 (失敗時は §8.8 stale 安全終結)。
function settleAttackerWon(ctx: TickContext, warId: WarId): TickContext {
  const war = ctx.state.wars[warId]
  if (!war) return ctx
  const goal = war.warGoals[0]
  const absoluteWeek = ctx.state.absoluteWeek

  if (!goal) {
    const next = patchWar(ctx, warId, { status: 'attacker_won', endedWeek: absoluteWeek })
    const w = next.state.wars[warId]
    return w ? awardWarOutcomeCtx(emitWarOutcome(next, w, true), w) : next
  }

  if (goal.kind === 'transfer_land_contract') {
    const r = applyLandContractTransferGoal(ctx, {
      holdingId: goal.holdingId,
      fromPolityId: goal.fromPolityId,
      toPolityId: goal.toPolityId,
      reason: 'war',
    })
    if (!r.ok) {
      // §8.8: fromPolity が現 grantee と不一致など → stale 安全終結。
      return settleWhitePeace(ctx, warId)
    }
    // transfer 経路は mutation が LAND_CONTRACT_CONQUERED 等を内部発行済み (重複させない)。
    let next = patchWar(r.value.ctx, warId, {
      status: 'attacker_won',
      endedWeek: r.value.ctx.state.absoluteWeek,
    })
    const w = next.state.wars[warId]
    if (w) next = awardWarOutcomeCtx(emitWarOutcome(next, w, true), w)
    // v0.48 Phase B (§5.2): 領地移転 (transfer goal) 完了後に戦災 Crisis を spawn する。
    //   owner = 新支配 polity (goal.toPolityId)。transfer 後に呼ぶことで holdingTerminalPolityCache が
    //   更新済み = 旧 owner を掴まない (B2)。tax/popular_revolt goal では領地移転がないので付与しない。
    next = spawnWarDamageCrisis(next, goal.holdingId, goal.toPolityId, warId)
    return next
  }

  if (goal.kind === 'popular_revolt_independence') {
    const result = establishCommonwealth(ctx, {
      commonwealthPolityId: goal.commonwealthPolityId,
      revoltDefaultIds: goal.revoltDefaultIds,
      leaderPersonId: goal.leaderPersonId,
    })
    if (!result.ok) return settleWhitePeace(ctx, warId)
    let next = patchWar(result.value.ctx, warId, {
      status: 'attacker_won',
      endedWeek: result.value.ctx.state.absoluteWeek,
    })
    const w = next.state.wars[warId]
    if (w) next = awardWarOutcomeCtx(emitWarOutcome(next, w, true), w)
    return next
  }

  // change_contract_tax_rate
  const defActor = getWarPrimaryDefender(war)?.actor
  const defenderPolityId = defActor?.kind === 'polity' ? defActor.id : undefined
  const { ctx: appliedCtx, applied } = applyTaxGoal(ctx, goal, defenderPolityId)
  if (!applied) {
    // §8.8: contract stale → 安全終結。
    return settleWhitePeace(ctx, warId)
  }
  let next = patchWar(appliedCtx, warId, {
    status: 'attacker_won',
    endedWeek: appliedCtx.state.absoluteWeek,
  })
  const w = next.state.wars[warId]
  if (w) {
    next = emitWarOutcome(next, w, true)
    // §8.6a / §12.5: tax 経路は底層 mutation が event を出さないため必ずここで発行。
    next = emitPeaceSettlementApplied(next, w, goal)
    next = awardWarOutcomeCtx(next, w)
  }
  return next
}

// §8.8: active War の WarGoal が参照する holding / polity / landContract が消えたら stale。
//   integrity §14.5 の active-War 存在検査と同条件にし、stale War を timeout 前に白紙和平で終結させる。
//   v0.35: per-tick drift 撤廃で互角戦が ~maxWarDurationWeeks 長期化するため、その間に別システムが
//   landContract を再構成すると stale active War が integrity を踏む。これを能動的に解消する。
function isWarGoalRefStale(state: WorldState, goal: WarGoal): boolean {
  if (goal.kind === 'transfer_land_contract') {
    return (
      !state.holdings[goal.holdingId] ||
      !state.polities[goal.fromPolityId] ||
      !state.polities[goal.toPolityId]
    )
  }
  if (goal.kind === 'popular_revolt_independence') {
    return (
      !state.polities[goal.commonwealthPolityId] ||
      !state.polities[goal.originalHolderPolityId] ||
      goal.holdingIds.some((hid) => !state.holdings[hid])
    )
  }
  const contract = state.landContracts[goal.landContractId]
  return (
    !state.holdings[goal.holdingId] ||
    !contract ||
    (contract.holdingId as string) !== (goal.holdingId as string)
  )
}

export function runPeaceSettlementSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const activeWarIds = Object.keys(ctx.state.wars)
    .sort()
    .filter((id) => ctx.state.wars[id as WarId]?.status === 'active')
  if (activeWarIds.length === 0) return ctx

  let next = ctx
  for (const idStr of activeWarIds) {
    const wid = idStr as WarId
    const war = next.state.wars[wid]
    if (!war || war.status !== 'active') continue

    const atk = getWarPrimaryAttacker(war)?.actor
    const def = getWarPrimaryDefender(war)?.actor
    if (!atk || !def) continue
    if (!isOrganizationActive(next.state, atk) || !isOrganizationActive(next.state, def)) continue

    // §8.8: WarGoal が stale (参照先消失) なら warScore/timeout を待たず白紙和平で安全終結する。
    if (war.warGoals.some((g) => isWarGoalRefStale(next.state, g))) {
      next = settleWhitePeace(next, wid)
      continue
    }

    // v0.45.2 同家戦争防止ゲート: 開戦後に相続・征服等で両 primary の支配家が同一に
    //   収束した war は白紙和平で能動終結する (stale → white_peace の相似形)。
    //   開戦時の同家ペアは aim/play/war 化の各ゲートで弾かれるため、ここは mid-war 収束専用。
    if (
      atk.kind === 'polity' &&
      def.kind === 'polity' &&
      politiesShareOwnerHouse(next.state, atk.id, def.id)
    ) {
      next = settleWhitePeace(next, wid)
      continue
    }

    // v0.39: revolt War — leader 死亡で即 defender 勝利
    let leaderDied = false
    for (const goal of war.warGoals) {
      if (goal.kind === 'popular_revolt_independence') {
        const leader = next.state.persons[goal.leaderPersonId]
        if (!leader || !leader.alive) {
          leaderDied = true
          break
        }
      }
    }
    if (leaderDied) {
      next = settleDefenderWon(next, wid)
      continue
    }

    const absoluteWeek = next.state.absoluteWeek
    if (war.warScore >= war.targetWarScore) {
      next = settleAttackerWon(next, wid)
    } else if (war.warScore <= -war.targetWarScore) {
      next = settleDefenderWon(next, wid)
    } else if (absoluteWeek - war.startedWeek >= config.maxWarDurationWeeks) {
      next = settleWhitePeace(next, wid)
    }
  }
  return next
}

// §8.8 stale WarGoal sweep【必須・weekly】
//   runPeaceSettlementSystem は intervalWeeks:4 のため年末 integrity tick (absoluteWeek ≡ 47 mod 48)
//   には走らない。week 45〜47 に consistency 系 (polityOwnerConsistencySystem 等, weekly) が
//   landContract を consolidation で消すと、active War の WarGoal が stale 化したまま次の
//   peaceSettlement (翌年 week 0) を待たず年末 integrity §14.5 を踏む。
//   cancelOrphanedWarsSystem (extinct polity ref) と同型に、stale goal ref を weekly に白紙和平で
//   解消し年末 tick をカバーする。配置は consistency 系の後 (削除後の状態を見る)。
export function runStaleWarGoalSweepSystem(ctx: TickContext): TickContext {
  const activeWarIds = Object.keys(ctx.state.wars)
    .sort()
    .filter((id) => ctx.state.wars[id as WarId]?.status === 'active')
  if (activeWarIds.length === 0) return ctx

  let next = ctx
  for (const idStr of activeWarIds) {
    const wid = idStr as WarId
    const war = next.state.wars[wid]
    if (!war || war.status !== 'active') continue
    // primary inactive な War は cancelOrphanedWarsSystem が cancelled 化済み (本 system の前段)。
    const atk = getWarPrimaryAttacker(war)?.actor
    const def = getWarPrimaryDefender(war)?.actor
    if (!atk || !def) continue
    if (!isOrganizationActive(next.state, atk) || !isOrganizationActive(next.state, def)) continue
    if (war.warGoals.some((g) => isWarGoalRefStale(next.state, g))) {
      next = settleWhitePeace(next, wid)
    }
  }
  return next
}
