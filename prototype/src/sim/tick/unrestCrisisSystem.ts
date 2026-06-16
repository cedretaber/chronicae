import type { TickContext } from './context'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import type { Crisis } from '../types/crisis'
import type { CrisisId } from '../types/ids'
import { adjustProvincePopUnrestByClass } from '../mutations/popMutations'
import { removeCrisisMut } from '../mutations/crisisMutations'
import { applyUnrestConcession } from './diplomaticPlayRevolt'
import { escalateUnrestCrisis } from './provinceRevoltSystem'

// v0.48 Phase C (Decision 1): unrest Crisis の terminal 処理を ctx ベースで行う weekly system。
//   crisisSystem (ws-mutable) は unrest を resolved/expired に mark するだけで purge しない。
//   ここで mark 済み unrest を消費し、ctx-immutable な既存 applier (concession / escalation) を呼んで
//   から purge する。crisisSystem の直後に登録すること (同 tick で mark→action が完結する)。

// secession の鎮静 (resolved): 譲歩は伴わず、反乱 class の unrest を下げ holding に鎮圧記録を残す。
function applySecessionSuppression(ctx: TickContext, crisis: Crisis): TickContext {
  const demand = crisis.demand
  if (!demand) return ctx
  const holding = ctx.state.holdings[crisis.holdingId]
  if (!holding) return ctx
  const config = ctx.config
  let state = adjustProvincePopUnrestByClass(
    ctx.state,
    holding.provinceId,
    demand.claimantPopClass,
    -config.revoltSettlementMainUnrestReduction,
  )
  const h = state.holdings[crisis.holdingId]
  if (h) {
    state = {
      ...state,
      holdings: {
        ...state.holdings,
        [crisis.holdingId]: { ...h, lastRevoltSuppressedWeek: state.absoluteWeek },
      },
    }
  }
  const nextCtx: TickContext = { ...ctx, state }
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'CRISIS_RESOLVED',
    importance: 'normal',
    messageKey: 'crisis.resolved',
    messageParams: {
      crisisKind: 'unrest',
      holding: nameParam('holding', holding.nameKey),
    },
    entityRefs: [entityRef('holding', crisis.holdingId, 'holding')],
  })
  return { ...ctxEv, events: [...ctxEv.events, event] }
}

// crisis を purge する (ws draft 経由)。
function purgeCrisis(ctx: TickContext, crisisId: CrisisId): TickContext {
  const ws: WorldState = {
    ...ctx.state,
    crises: { ...ctx.state.crises },
    crisisIndex: {
      byHolding: { ...ctx.state.crisisIndex.byHolding },
      byProject: { ...ctx.state.crisisIndex.byProject },
    },
  }
  removeCrisisMut(ws, crisisId)
  return { ...ctx, state: ws }
}

export function runUnrestCrisisSystem(ctx: TickContext): TickContext {
  // 決定的順序のため id でソート。
  const marked: Crisis[] = []
  for (const cidStr of Object.keys(ctx.state.crises).sort()) {
    const c = ctx.state.crises[cidStr as CrisisId]
    if (c && c.kind === 'unrest' && (c.status === 'resolved' || c.status === 'expired')) {
      marked.push(c)
    }
  }
  if (marked.length === 0) return ctx

  let nextCtx = ctx
  for (const crisis of marked) {
    if (crisis.status === 'resolved') {
      // 対処成功: tax/bailiff は譲歩、secession は鎮圧。grievance を実際に解消する (無限再発防止)。
      nextCtx =
        crisis.demand?.kind === 'secession'
          ? applySecessionSuppression(nextCtx, crisis)
          : applyUnrestConcession(nextCtx, crisis)
    } else {
      // 期限切れ: 武装蜂起 (commonwealth + play + escalation → 既存 war 配管)。
      nextCtx = escalateUnrestCrisis(nextCtx, crisis)
    }
    nextCtx = purgeCrisis(nextCtx, crisis.id)
  }
  return nextCtx
}
