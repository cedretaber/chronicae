import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { War, WarGoal } from '../types/war'
import type { PoliticalActorRef } from '../types/actor'
import type { WorldState } from '../types/world'
import type {
  EventType,
  EventImportance,
  EventMessageParams,
  EventEntityRef,
  EventEntityKind,
} from '../types/event'
import { nameParam, entityRef } from '../types/event'
import { getWarPrimaryAttacker, getWarPrimaryDefender } from '../mutations/warMutations'

// v0.34: War lifecycle system 群 (Creation / Progress / cancelOrphaned / PeaceSettlement) が
//   共有する event 発行 helper。createSimEvent は event を返すだけで ctx.events に積まないため、
//   ここで append まで行う (conflictResolutionSystem.ts の local emitEvent と同パターン)。

function actorEntityKind(actor: PoliticalActorRef): EventEntityKind {
  return actor.kind === 'polity' ? 'polity' : 'house'
}

function actorNameKey(state: WorldState, actor: PoliticalActorRef): string {
  if (actor.kind === 'polity') return state.polities[actor.id]?.nameKey ?? actor.id
  return state.houses[actor.id]?.nameKey ?? actor.id
}

function emit(
  ctx: TickContext,
  type: EventType,
  importance: EventImportance,
  messageKey: string,
  messageParams: EventMessageParams,
  entityRefs: EventEntityRef[],
): TickContext {
  const { event, ctx: nextCtx } = createSimEvent(ctx, {
    type,
    importance,
    messageKey,
    messageParams,
    entityRefs,
  })
  return { ...nextCtx, events: [...nextCtx.events, event] }
}

type WarParties = {
  attacker: PoliticalActorRef
  defender: PoliticalActorRef
  attackerName: string
  defenderName: string
}

function warParties(state: WorldState, war: War): WarParties | undefined {
  const a = getWarPrimaryAttacker(war)?.actor
  const d = getWarPrimaryDefender(war)?.actor
  if (!a || !d) return undefined
  return {
    attacker: a,
    defender: d,
    attackerName: actorNameKey(state, a),
    defenderName: actorNameKey(state, d),
  }
}

function attackerDefenderRefs(p: WarParties): EventEntityRef[] {
  return [
    entityRef(actorEntityKind(p.attacker), p.attacker.id, 'attacker', p.attackerName),
    entityRef(actorEntityKind(p.defender), p.defender.id, 'defender', p.defenderName),
  ]
}

// §12.2 WAR_DECLARED — WarCreationSystem が War 作成時に発行 (major)。
export function emitWarDeclared(ctx: TickContext, war: War, issueKind: string): TickContext {
  const p = warParties(ctx.state, war)
  if (!p) return ctx
  return emit(
    ctx,
    'WAR_DECLARED',
    'major',
    'war.declared',
    {
      warId: war.id,
      attacker: nameParam(p.attacker.kind, p.attackerName),
      defender: nameParam(p.defender.kind, p.defenderName),
      issue: issueKind,
    },
    attackerDefenderRefs(p),
  )
}

// §12.3 WAR_SCORE_CHANGED — WarProgressSystem が |delta|>=threshold で発行 (normal)。
export function emitWarScoreChanged(ctx: TickContext, war: War, delta: number): TickContext {
  const p = warParties(ctx.state, war)
  if (!p) return ctx
  return emit(
    ctx,
    'WAR_SCORE_CHANGED',
    'normal',
    'war.score_changed',
    {
      warId: war.id,
      attacker: nameParam(p.attacker.kind, p.attackerName),
      defender: nameParam(p.defender.kind, p.defenderName),
      warScore: war.warScore,
      delta,
    },
    attackerDefenderRefs(p),
  )
}

// §12.4 WAR_WON / WAR_LOST — PeaceSettlementSystem が決着時に勝者/敗者へ発行 (major)。
export function emitWarOutcome(ctx: TickContext, war: War, attackerWon: boolean): TickContext {
  const p = warParties(ctx.state, war)
  if (!p) return ctx
  const winner = attackerWon ? p.attacker : p.defender
  const loser = attackerWon ? p.defender : p.attacker
  const winnerName = attackerWon ? p.attackerName : p.defenderName
  const loserName = attackerWon ? p.defenderName : p.attackerName
  let next = emit(
    ctx,
    'WAR_WON',
    'major',
    'war.won',
    {
      winner: nameParam(winner.kind, winnerName),
      loser: nameParam(loser.kind, loserName),
    },
    [
      entityRef(actorEntityKind(winner), winner.id, 'winner', winnerName),
      entityRef(actorEntityKind(loser), loser.id, 'loser', loserName),
    ],
  )
  next = emit(
    next,
    'WAR_LOST',
    'major',
    'war.lost',
    {
      loser: nameParam(loser.kind, loserName),
      winner: nameParam(winner.kind, winnerName),
    },
    [
      entityRef(actorEntityKind(loser), loser.id, 'loser', loserName),
      entityRef(actorEntityKind(winner), winner.id, 'winner', winnerName),
    ],
  )
  return next
}

// §12.4a WAR_ENDED — white_peace (timeout / stale 安全終結) / cancelled (orphan) 終結で発行 (major)。
export function emitWarEnded(ctx: TickContext, war: War): TickContext {
  const p = warParties(ctx.state, war)
  if (!p) return ctx
  return emit(
    ctx,
    'WAR_ENDED',
    'major',
    'war.ended',
    {
      warId: war.id,
      attacker: nameParam(p.attacker.kind, p.attackerName),
      defender: nameParam(p.defender.kind, p.defenderName),
    },
    attackerDefenderRefs(p),
  )
}

// §12.5 PEACE_SETTLEMENT_APPLIED — tax 経路は底層 mutation が event を出さないため必ずここで発行。
//   transfer 経路は applyLandContractTransferGoal が LAND_CONTRACT_* を内部発行するので、
//   PeaceSettlement 側はこの「適用された」ことを示す 1 件だけを補足的に発行する。
export function emitPeaceSettlementApplied(ctx: TickContext, war: War, goal: WarGoal): TickContext {
  const p = warParties(ctx.state, war)
  if (!p) return ctx
  const holding = ctx.state.holdings[goal.holdingId]
  const provinceId = holding?.provinceId
  const holdingDisplay = provinceId
    ? (ctx.state.provinces[provinceId]?.nameKey ?? provinceId)
    : (goal.holdingId as string)
  const messageKey =
    goal.kind === 'transfer_land_contract'
      ? 'war.peace_settlement.transfer_land'
      : 'war.peace_settlement.change_tax'
  const refs: EventEntityRef[] = [
    entityRef('holding', goal.holdingId, 'holding'),
    ...attackerDefenderRefs(p),
  ]
  if (provinceId) {
    refs.push(
      entityRef('province', provinceId, 'province', ctx.state.provinces[provinceId]?.nameKey),
    )
  }
  return emit(
    ctx,
    'PEACE_SETTLEMENT_APPLIED',
    'major',
    messageKey,
    {
      attacker: nameParam(p.attacker.kind, p.attackerName),
      defender: nameParam(p.defender.kind, p.defenderName),
      holding: nameParam('province', holdingDisplay),
    },
    refs,
  )
}
