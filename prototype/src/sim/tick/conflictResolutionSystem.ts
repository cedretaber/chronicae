import type { TickContext } from './context'
import { createSimEvent } from './context'
import { clamp } from '../utils/math'
import type { DiplomaticPlayId, PolityId, ProvinceId, HoldingId } from '../types/ids'
import type {
  DiplomaticPlay,
  DiplomaticPlayStatus,
  TerminalDiplomaticPlayStatus,
} from '../types/diplomaticPlay'
import type { EventType, EventMessageParams, EventEntityRef } from '../types/event'
import type { SimEvent } from '../types/event'
import { entityRef, nameParam } from '../types/event'
import { adjustProvincePopUnrestByClass, adjustProvincePopUnrest } from '../mutations/popMutations'
import { adjustProvinceDevelopment } from '../mutations/provinceMutations'
import { disbandRebelPolity, type RebelLeaderAftermath } from '../mutations/worldStructureMutations'
import { resolveRevoltConflict } from './provinceRevoltSystem'
import { randomFloat } from '../rng/rng'

// v0.18 Stage D §13 / v0.34 §11: ConflictResolutionSystem (revolt 専用 legacy)
//
// status === 'escalated' な revolt_negotiation の DiplomaticPlay を拾い上げ、武力衝突として即時解決する。
// 結果に応じて status を 'resolved_by_conflict' に置換し、REVOLT_POLITY_ESTABLISHED /
// DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT event を発火する。
//
// v0.34: land_claim / contract_tax_revision の escalation は WarCreationSystem が War entity 化するため、
//   本 system は revolt_negotiation のみを kind-gate して扱う (§11.3。二重処理は順序でなく gate で防ぐ)。
//
// 配置: diplomaticPlaySystem / warCreationSystem の直後、cleanupTerminalDiplomacy の前。

export function runConflictResolutionSystem(ctx: TickContext): TickContext {
  if (!ctx.config.conflictResolutionEnabled) return ctx

  let currentCtx = ctx
  let resolved = 0
  for (const playIdStr of Object.keys(currentCtx.state.diplomaticPlays).sort()) {
    if (resolved >= currentCtx.config.maxConflictsResolvedPerTick) break
    const play = currentCtx.state.diplomaticPlays[playIdStr as DiplomaticPlayId]
    if (!play) continue
    if (play.status !== 'escalated') continue

    // v0.34 §11.3: land_claim / contract_tax_revision は WarCreationSystem が War 化する。
    // この legacy system は revolt_negotiation のみ即時解決する (kind-gate で二重処理を防ぐ)。
    if (play.kind !== 'revolt_negotiation') continue
    currentCtx = resolveRevoltEscalation(currentCtx, play)
    resolved++
  }
  return currentCtx
}

// ─── revolt_negotiation の escalation (旧 applyRevoltEscalation を移植) ───

function resolveRevoltEscalation(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  if (!play.primaryDemand || play.primaryDemand.kind !== 'revolt_concession') {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  const demand = play.primaryDemand
  const rebelPolityId = play.initiator.id
  const targetPolityId = play.target.id
  const provinceId = demand.provinceId

  const { result, rng: nextRng } = resolveRevoltConflict(ctx.state, config, ctx.rng, {
    provinceId,
    popClass: demand.popClass,
    targetPolityId,
  })
  let nextCtx: TickContext = { ...ctx, rng: nextRng }

  if (result.rebelWins) {
    nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')
    const reducedState = adjustProvincePopUnrestByClass(
      nextCtx.state,
      provinceId,
      demand.popClass,
      -config.revoltSettlementMainUnrestReduction,
    )
    nextCtx = { ...nextCtx, state: reducedState }
    // 既存 conflictResolutionSystem.ts は spec §18 互換のため REVOLT_POLITY_ESTABLISHED 発火
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    const provinceParam = nameParam('province', provinceNameKey)
    nextCtx = emitEvent(nextCtx, {
      type: 'REVOLT_POLITY_ESTABLISHED',
      importance: 'critical',
      polityIds: [rebelPolityId, targetPolityId],
      provinceIds: [provinceId],
      holdingIds: [],
      summary: `The revolt in ${provinceNameKey} has triumphed — independence is achieved.`,
      messageKey: 'revolt.triumphant',
      messageParams: { province: provinceParam },
      eventEntityRefs: [
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef(
          'polity',
          rebelPolityId,
          'rebel_polity',
          nextCtx.state.polities[rebelPolityId]?.nameKey,
        ),
        entityRef(
          'polity',
          targetPolityId,
          'target_polity',
          nextCtx.state.polities[targetPolityId]?.nameKey,
        ),
      ],
    })
    const provNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    return emitResolvedByConflictEvent(nextCtx, play, {
      polityIds: [rebelPolityId, targetPolityId],
      provinceIds: [provinceId],
      holdingIds: [],
      summary: `Conflict over ${provNameKey} ended with rebel victory.`,
      messageKey: 'conflict.revolt_rebel_victory',
      messageParams: {
        province: nameParam('province', provNameKey),
      },
    })
  }

  // Target 勝利 → 鎮圧成功
  const disbandResult = disbandRebelPolity(nextCtx, {
    rebelPolityId,
    restoreToPolityId: targetPolityId,
    provinceId,
    leaderAftermath: pickSuppressionAftermath(nextCtx),
    reason: 'suppression',
  })
  if (!disbandResult.ok) {
    return setPlayStatus(nextCtx, play.id, 'cancelled')
  }
  nextCtx = disbandResult.value.ctx

  let state = nextCtx.state
  state = adjustProvincePopUnrestByClass(
    state,
    provinceId,
    demand.popClass,
    -config.revoltSuppressedMainUnrestReduction,
  )
  state = adjustProvincePopUnrest(state, provinceId, -config.revoltSuppressedOtherUnrestReduction)
  const province = state.provinces[provinceId]
  if (province) {
    const devResult = adjustProvinceDevelopment(
      state,
      provinceId,
      -config.revoltSuppressedDevelopmentDamage,
    )
    if (devResult.ok) {
      state = devResult.value
    }
  }
  const targetPolityNow = state.polities[targetPolityId]
  if (targetPolityNow) {
    state = {
      ...state,
      polities: {
        ...state.polities,
        [targetPolityId]: {
          ...targetPolityNow,
          legacyPrestige: clamp(targetPolityNow.legacyPrestige + 1, 0, 100),
        },
      },
    }
  }
  nextCtx = { ...nextCtx, state }
  nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')
  const provNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
  return emitResolvedByConflictEvent(nextCtx, play, {
    polityIds: [rebelPolityId, targetPolityId],
    provinceIds: [provinceId],
    holdingIds: [],
    summary: `Revolt in ${provNameKey} was put down by force.`,
    messageKey: 'conflict.revolt_suppressed',
    messageParams: {
      province: nameParam('province', provNameKey),
    },
  })
}

function pickSuppressionAftermath(ctx: TickContext): RebelLeaderAftermath {
  const { value, rng } = randomFloat(ctx.rng)
  void rng
  return value < 0.5 ? 'executed' : 'vanished'
}

// ─── 共通 helpers ───

function emitResolvedByConflictEvent(
  ctx: TickContext,
  _play: DiplomaticPlay,
  meta: {
    polityIds: PolityId[]
    provinceIds: ProvinceId[]
    holdingIds: HoldingId[]
    summary: string
    messageKey: string
    messageParams: EventMessageParams
  },
): TickContext {
  return emitEvent(ctx, {
    type: 'DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT',
    importance: 'major',
    polityIds: meta.polityIds,
    provinceIds: meta.provinceIds,
    holdingIds: meta.holdingIds,
    summary: meta.summary,
    messageKey: meta.messageKey,
    messageParams: meta.messageParams,
    eventEntityRefs: [],
  })
}

function emitEvent(
  ctx: TickContext,
  input: {
    type: EventType
    importance: SimEvent['importance']
    polityIds: PolityId[]
    provinceIds: ProvinceId[]
    holdingIds: HoldingId[]
    summary: string
    messageKey: string
    messageParams: EventMessageParams
    eventEntityRefs: EventEntityRef[]
  },
): TickContext {
  const { event, ctx: ctxEv } = createSimEvent(ctx, {
    type: input.type,
    importance: input.importance,
    messageKey: input.messageKey,
    messageParams: input.messageParams,
    entityRefs: input.eventEntityRefs,
  })
  return { ...ctxEv, events: [...ctxEv.events, event] }
}

function setPlayStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: TerminalDiplomaticPlayStatus,
): TickContext {
  const play = ctx.state.diplomaticPlays[playId]
  if (!play) return ctx
  const nextStatus: DiplomaticPlayStatus = status
  return {
    ...ctx,
    state: {
      ...ctx.state,
      diplomaticPlays: {
        ...ctx.state.diplomaticPlays,
        [playId]: { ...play, status: nextStatus },
      },
    },
  }
}
