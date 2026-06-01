import type { TickContext } from './context'
import type { WarId, PolityId } from '../types/ids'
import type { War, WarGoal, ChangeContractTaxRateWarGoal } from '../types/war'
import type { WorldState } from '../types/world'
import { getWarPrimaryAttacker, getWarPrimaryDefender } from '../mutations/warMutations'
import { isActorActive } from '../selectors/actorSelectors'
import {
  applyLandContractTransferGoal,
  adjustLandContractTaxRate,
  eliminateContractFromChain,
} from '../mutations/landContractMutations'
import { getHoldingLandContractChain } from '../selectors/landContractSelectors'
import { emitWarOutcome, emitWarEnded, emitPeaceSettlementApplied } from './warEvents'
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
  return w ? emitWarEnded(next, w) : next
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
      revoltSeizureContractIds: revoltGoal.revoltSeizureContractIds,
      holdingIds: revoltGoal.holdingIds,
    })
    let next = result.ok ? result.value.ctx : ctx
    next = patchWar(next, warId, { status: 'defender_won', endedWeek: next.state.absoluteWeek })
    const w = next.state.wars[warId]
    return w ? emitWarOutcome(next, w, false) : next
  }

  const next = patchWar(ctx, warId, { status: 'defender_won', endedWeek: ctx.state.absoluteWeek })
  const w = next.state.wars[warId]
  return w ? emitWarOutcome(next, w, false) : next
}

// §8.6: tax goal を適用する。底層 mutation は event を発行しない。
//   contract が stale (消失 / holdingId 不一致) なら applied:false を返し、呼び出し側が white_peace に倒す。
function applyTaxGoal(
  ctx: TickContext,
  goal: ChangeContractTaxRateWarGoal,
  defenderPolityId: PolityId | undefined,
): { ctx: TickContext; applied: boolean } {
  const config = ctx.config
  const state = ctx.state
  const contract = state.landContracts[goal.landContractId]
  if (!contract || contract.holdingId !== goal.holdingId) return { ctx, applied: false }

  const newRate = goal.newTaxRateToGrantor
  // 通常の税率変更。
  if (newRate > config.taxRevisionMinRate && newRate < config.taxRevisionMaxRate) {
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
    // 排除対象が無ければ構造変更なし (demand 自体は成立)。
    return { ctx, applied: true }
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
    return w ? emitWarOutcome(next, w, true) : next
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
    if (w) next = emitWarOutcome(next, w, true)
    return next
  }

  if (goal.kind === 'popular_revolt_independence') {
    const result = establishCommonwealth(ctx, {
      commonwealthPolityId: goal.commonwealthPolityId,
      revoltSeizureContractIds: goal.revoltSeizureContractIds,
      leaderPersonId: goal.leaderPersonId,
    })
    if (!result.ok) return settleWhitePeace(ctx, warId)
    let next = patchWar(result.value.ctx, warId, {
      status: 'attacker_won',
      endedWeek: result.value.ctx.state.absoluteWeek,
    })
    const w = next.state.wars[warId]
    if (w) next = emitWarOutcome(next, w, true)
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
    if (!isActorActive(next.state, atk) || !isActorActive(next.state, def)) continue

    // §8.8: WarGoal が stale (参照先消失) なら warScore/timeout を待たず白紙和平で安全終結する。
    if (war.warGoals.some((g) => isWarGoalRefStale(next.state, g))) {
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
