import type { TickContext } from './context'
import { createSimEvent } from './context'
import type {
  War,
  WarGoal,
  WarSideKey,
  BattlefieldKind,
  BattleResult,
  BattleInitiationKind,
} from '../types/war'
import type { BattleOutcomeQuality } from '../types/battle'
import type { PersonId, ProvinceId } from '../types/ids'
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
import {
  getWarPrimaryAttacker,
  getWarPrimaryDefender,
  describeWarGoal,
} from '../mutations/warMutations'

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
//   casus belli として「対象 + 戦争前の状態 + 変えようとする内容」を記録する (歴史記述)。
//   War は terminalWarRetentionWeeks 後に cleanup されるため、永続記録はこの event params が担う。
export function emitWarDeclared(ctx: TickContext, war: War, issueKind: string): TickContext {
  const p = warParties(ctx.state, war)
  if (!p) return ctx

  const goal = war.warGoals[0]
  // goal 不在は防御的 fallback (汎用 war.declared)。
  if (!goal) {
    return emit(
      ctx,
      'WAR_DECLARED',
      'major',
      'war.declared.generic',
      {
        warId: war.id,
        attacker: nameParam(p.attacker.kind, p.attackerName),
        defender: nameParam(p.defender.kind, p.defenderName),
        issue: issueKind,
      },
      attackerDefenderRefs(p),
    )
  }

  const desc = describeWarGoal(ctx.state, goal)

  if (desc.kind === 'popular_revolt_independence') {
    const holdingId = desc.holdingIds?.[0]
    const holding = holdingId ? ctx.state.holdings[holdingId] : undefined
    const provId = holding?.provinceId
    const prov = provId ? ctx.state.provinces[provId] : undefined
    const revoltRefs: EventEntityRef[] = [...attackerDefenderRefs(p)]
    if (provId) revoltRefs.push(entityRef('province', provId, 'province', prov?.nameKey))
    return emit(
      ctx,
      'WAR_DECLARED',
      'major',
      'war.declared.revolt',
      {
        warId: war.id,
        attacker: nameParam(p.attacker.kind, p.attackerName),
        defender: nameParam(p.defender.kind, p.defenderName),
        province: nameParam('province', prov?.nameKey ?? ''),
      },
      revoltRefs,
    )
  }

  const subjectName = desc.provinceNameKey ?? desc.holdingId
  const refs: EventEntityRef[] = [...attackerDefenderRefs(p)]
  if (desc.provinceId) {
    refs.push(entityRef('province', desc.provinceId, 'province', desc.provinceNameKey))
  }

  if (desc.kind === 'change_contract_tax_rate') {
    return emit(
      ctx,
      'WAR_DECLARED',
      'major',
      'war.declared.change_tax',
      {
        warId: war.id,
        attacker: nameParam(p.attacker.kind, p.attackerName),
        defender: nameParam(p.defender.kind, p.defenderName),
        subject: nameParam('province', subjectName),
        fromRate: Math.round(desc.beforeRate * 100),
        toRate: Math.round(desc.afterRate * 100),
      },
      refs,
    )
  }

  // transfer_land_contract: 元保持者 (fromPolityId) を明示する。
  const fromName = ctx.state.polities[desc.fromPolityId]?.nameKey ?? desc.fromPolityId
  return emit(
    ctx,
    'WAR_DECLARED',
    'major',
    'war.declared.transfer_land',
    {
      warId: war.id,
      attacker: nameParam(p.attacker.kind, p.attackerName),
      defender: nameParam(p.defender.kind, p.defenderName),
      subject: nameParam('province', subjectName),
      from: nameParam('polity', fromName),
    },
    refs,
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
      warId: war.id,
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
      warId: war.id,
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
  // v0.39: revolt WarGoal のハンドラは未実装。event 発行不要。
  if (goal.kind === 'popular_revolt_independence') return ctx
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
      warId: war.id,
      attacker: nameParam(p.attacker.kind, p.attackerName),
      defender: nameParam(p.defender.kind, p.defenderName),
      holding: nameParam('province', holdingDisplay),
      // tax 経路は before→after の税率を記録する (歴史記述)。transfer は from/to を底層 LAND_CONTRACT_* が持つ。
      ...(goal.kind === 'change_contract_tax_rate'
        ? {
            fromRate: Math.round(goal.baseTaxRateToGrantor * 100),
            toRate: Math.round(goal.newTaxRateToGrantor * 100),
          }
        : {}),
    },
    refs,
  )
}

// ─── v0.35 §11: WarManeuver の Battle / Avoidance / 総大将交代 event ───
//   Battle entity を持たないため params は self-contained (province 名・人物名・powers・warScore)。
//   人物 (総大将 / commander) は entityRef('person', ...) で UI クリック可能化する。

function personNameKeyOrId(state: WorldState, id: PersonId): string {
  return state.persons[id]?.nameKey ?? id
}

// person ref を返す (undefined は積まない)。
function personRef(
  state: WorldState,
  id: PersonId | undefined,
  role: string,
): EventEntityRef | undefined {
  if (id === undefined) return undefined
  return entityRef('person', id, role, state.persons[id]?.nameKey)
}

export type BattleOccurredInput = {
  provinceId?: ProvinceId
  battlefieldKind: BattlefieldKind
  initiationKind: BattleInitiationKind
  result: BattleResult
  attackerCaptainGeneralId?: PersonId
  defenderCaptainGeneralId?: PersonId
  attackerCommanderId?: PersonId
  defenderCommanderId?: PersonId
  attackerPower: number
  defenderPower: number
  attackerEffectivePower: number
  defenderEffectivePower: number
  warScoreDelta: number
  warScoreAfter: number
  // v0.36 §16: Battle entity 参照 + 両 side の動員連隊数 (counts-only enrich)。
  battleId: string
  attackerRegimentCount: number
  defenderRegimentCount: number
  // v0.37 §17: battle summary enrich (additive)。counts は Battle entity の ID 配列から導出。
  outcomeQuality?: BattleOutcomeQuality
  ticksElapsed?: number
  frontage?: number
  attackerInitialFrontlineCount?: number
  defenderInitialFrontlineCount?: number
  attackerRoutedCount?: number
  defenderRoutedCount?: number
  breakthroughSide?: WarSideKey
  pursuitOccurred?: boolean
}

// §11.1 BATTLE_OCCURRED (normal)。warScore 変化は warScoreDelta / warScoreAfter で表現。
export function emitBattleOccurred(
  ctx: TickContext,
  war: War,
  input: BattleOccurredInput,
): TickContext {
  const state = ctx.state
  const p = warParties(state, war)
  if (!p) return ctx
  const provinceNameKey = input.provinceId ? state.provinces[input.provinceId]?.nameKey : undefined
  // v0.38 Phase 4: chronicle narrative 用の派生フラグ (additive・純粋導出で RNG 不変)。
  //   chronicleEventDefinitions.selectBattleTemplate が rich template 出し分けに使う。
  const isVictory = input.result === 'attacker_victory' || input.result === 'defender_victory'
  const winnerEffectivePower =
    input.result === 'attacker_victory'
      ? input.attackerEffectivePower
      : input.defenderEffectivePower
  const loserEffectivePower =
    input.result === 'attacker_victory'
      ? input.defenderEffectivePower
      : input.attackerEffectivePower
  const outnumberedVictory = isVictory && winnerEffectivePower < loserEffectivePower
  const decisiveVictory = input.outcomeQuality === 'rout'
  const refs: EventEntityRef[] = [...attackerDefenderRefs(p)]
  if (input.provinceId) {
    refs.push(entityRef('province', input.provinceId, 'province', provinceNameKey))
  }
  for (const [id, role] of [
    [input.attackerCaptainGeneralId, 'attacker_captain_general'],
    [input.defenderCaptainGeneralId, 'defender_captain_general'],
    [input.attackerCommanderId, 'attacker_commander'],
    [input.defenderCommanderId, 'defender_commander'],
  ] as const) {
    const r = personRef(state, id, role)
    if (r) refs.push(r)
  }
  return emit(
    ctx,
    'BATTLE_OCCURRED',
    'normal',
    'war.battle_occurred',
    {
      warId: war.id,
      battleId: input.battleId,
      battlefieldKind: input.battlefieldKind,
      initiationKind: input.initiationKind,
      result: input.result,
      attacker: nameParam(p.attacker.kind, p.attackerName),
      defender: nameParam(p.defender.kind, p.defenderName),
      attackerPower: input.attackerPower,
      defenderPower: input.defenderPower,
      attackerEffectivePower: input.attackerEffectivePower,
      defenderEffectivePower: input.defenderEffectivePower,
      attackerRegimentCount: input.attackerRegimentCount,
      defenderRegimentCount: input.defenderRegimentCount,
      warScoreDelta: input.warScoreDelta,
      warScoreAfter: input.warScoreAfter,
      // v0.38 Phase 4: chronicle narrative 選択用フラグ (描画はせず template 出し分けにのみ使う)。
      outnumberedVictory,
      decisiveVictory,
      // v0.37 §17: battle summary (additive。raw 値/enum で渡し、表示解決は eventRenderer)。
      ...(input.outcomeQuality ? { outcomeQuality: input.outcomeQuality } : {}),
      ...(input.ticksElapsed !== undefined ? { ticksElapsed: input.ticksElapsed } : {}),
      ...(input.frontage !== undefined ? { frontage: input.frontage } : {}),
      ...(input.attackerInitialFrontlineCount !== undefined
        ? { attackerInitialFrontlineCount: input.attackerInitialFrontlineCount }
        : {}),
      ...(input.defenderInitialFrontlineCount !== undefined
        ? { defenderInitialFrontlineCount: input.defenderInitialFrontlineCount }
        : {}),
      ...(input.attackerRoutedCount !== undefined
        ? { attackerRoutedCount: input.attackerRoutedCount }
        : {}),
      ...(input.defenderRoutedCount !== undefined
        ? { defenderRoutedCount: input.defenderRoutedCount }
        : {}),
      ...(input.breakthroughSide ? { breakthroughSide: input.breakthroughSide } : {}),
      ...(input.pursuitOccurred !== undefined ? { pursuitOccurred: input.pursuitOccurred } : {}),
      ...(provinceNameKey ? { province: nameParam('province', provinceNameKey) } : {}),
      ...(input.attackerCommanderId
        ? {
            attackerCommander: nameParam(
              'person',
              personNameKeyOrId(state, input.attackerCommanderId),
            ),
          }
        : {}),
      ...(input.defenderCommanderId
        ? {
            defenderCommander: nameParam(
              'person',
              personNameKeyOrId(state, input.defenderCommanderId),
            ),
          }
        : {}),
    },
    refs,
  )
}

export type BattleAvoidedInput = {
  provinceId?: ProvinceId
  battlefieldKind: BattlefieldKind
  avoidingSide: WarSideKey | 'both'
  attackerCaptainGeneralId?: PersonId
  defenderCaptainGeneralId?: PersonId
  avoidanceSucceeded: boolean
  attackerAvoidanceCountAfter: number
  defenderAvoidanceCountAfter: number
  warScoreDelta: number
  warScoreAfter: number
}

// §11.2 BATTLE_AVOIDED (minor)。両者回避は avoidingSide='both' / warScoreDelta=0。
export function emitBattleAvoided(
  ctx: TickContext,
  war: War,
  input: BattleAvoidedInput,
): TickContext {
  const state = ctx.state
  const p = warParties(state, war)
  if (!p) return ctx
  const provinceNameKey = input.provinceId ? state.provinces[input.provinceId]?.nameKey : undefined
  const refs: EventEntityRef[] = [...attackerDefenderRefs(p)]
  if (input.provinceId) {
    refs.push(entityRef('province', input.provinceId, 'province', provinceNameKey))
  }
  for (const [id, role] of [
    [input.attackerCaptainGeneralId, 'attacker_captain_general'],
    [input.defenderCaptainGeneralId, 'defender_captain_general'],
  ] as const) {
    const r = personRef(state, id, role)
    if (r) refs.push(r)
  }
  return emit(
    ctx,
    'BATTLE_AVOIDED',
    'minor',
    'war.battle_avoided',
    {
      warId: war.id,
      battlefieldKind: input.battlefieldKind,
      avoidingSide: input.avoidingSide,
      attacker: nameParam(p.attacker.kind, p.attackerName),
      defender: nameParam(p.defender.kind, p.defenderName),
      avoidanceSucceeded: input.avoidanceSucceeded,
      attackerAvoidanceCountAfter: input.attackerAvoidanceCountAfter,
      defenderAvoidanceCountAfter: input.defenderAvoidanceCountAfter,
      warScoreDelta: input.warScoreDelta,
      warScoreAfter: input.warScoreAfter,
      ...(provinceNameKey ? { province: nameParam('province', provinceNameKey) } : {}),
    },
    refs,
  )
}

// §11.3 WAR_CAPTAIN_GENERAL_CHANGED。総大将喪失 (new undefined) は major、それ以外 normal。
//   初回任命 (old undefined) では呼ばない (呼び出し側で gate)。
export function emitCaptainGeneralChanged(
  ctx: TickContext,
  war: War,
  sideKey: WarSideKey,
  oldCaptainGeneralId: PersonId | undefined,
  newCaptainGeneralId: PersonId | undefined,
): TickContext {
  const state = ctx.state
  const side = sideKey === 'attacker' ? war.attacker : war.defender
  const actor = side.participants.find((pp) => pp.primary)?.actor
  if (!actor) return ctx
  const actorName = actorNameKey(state, actor)
  const importance: EventImportance = newCaptainGeneralId === undefined ? 'major' : 'normal'
  const refs: EventEntityRef[] = [entityRef(actorEntityKind(actor), actor.id, 'actor', actorName)]
  const oldRef = personRef(state, oldCaptainGeneralId, 'old_captain_general')
  if (oldRef) refs.push(oldRef)
  const newRef = personRef(state, newCaptainGeneralId, 'new_captain_general')
  if (newRef) refs.push(newRef)
  return emit(
    ctx,
    'WAR_CAPTAIN_GENERAL_CHANGED',
    importance,
    'war.captain_general_changed',
    {
      warId: war.id,
      side: sideKey,
      actor: nameParam(actor.kind, actorName),
      ...(oldCaptainGeneralId
        ? { oldCaptainGeneral: nameParam('person', personNameKeyOrId(state, oldCaptainGeneralId)) }
        : {}),
      ...(newCaptainGeneralId
        ? { newCaptainGeneral: nameParam('person', personNameKeyOrId(state, newCaptainGeneralId)) }
        : {}),
    },
    refs,
  )
}
