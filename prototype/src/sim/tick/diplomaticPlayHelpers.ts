import type { TickContext } from './context'
import { createSimEvent } from './context'
import { clamp } from '../utils/math'
import { isLivingPerson } from '../types/person'
import type { DiplomaticPlayId, PolityId, ProvinceId, HoldingId } from '../types/ids'
import type {
  DiplomaticPlay,
  DiplomaticPlayStatus,
  DiplomaticPlayTerminalOutcome,
  TerminalDiplomaticPlayStatus,
  DiplomaticOffer,
} from '../types/diplomaticPlay'
import type { EventEntityRef, EventMessageParams } from '../types/event'
import type { WorldState } from '../types/world'
import { getProvinceTerminalPolityId } from '../selectors/landContractSelectors'
import { getDiplomaticPlayDelegate } from '../selectors/taskSelectors'
import { estimateAttackerWinChance } from '../selectors/warEstimateSelectors'
import { calcGeneralDeclareThreshold } from '../selectors/personAbilityEffects'
import { createLogger } from '../debug/logger'

export function isDeadlineReached(state: { absoluteWeek: number }, play: DiplomaticPlay): boolean {
  return state.absoluteWeek >= play.deadlineWeek
}

// status='escalated' (active 系) に設定し DIPLOMATIC_PLAY_ESCALATED event を発火する。
// 同 tick 内の conflictResolutionSystem が拾い上げて 'resolved_by_conflict' に置換する。
export function markPlayEscalated(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  eventMeta: {
    polityIds: PolityId[]
    provinceIds: ProvinceId[]
    holdingIds: HoldingId[]
    summary: string
    messageKey: string
    messageParams: EventMessageParams
    eventEntityRefs: EventEntityRef[]
  },
): TickContext {
  const nextCtx = setPlayActiveStatus(ctx, playId, 'escalated')
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'DIPLOMATIC_PLAY_ESCALATED',
    importance: 'major',
    messageKey: eventMeta.messageKey,
    messageParams: eventMeta.messageParams,
    entityRefs: eventMeta.eventEntityRefs,
  })
  return { ...ctxEv, events: [...ctxEv.events, event] }
}

// v0.47.3 §6.69: 外交劇が戦争化 (escalation) しようとする局面で、戦争に勝てないと
//   判断した場合は escalate せず status_quo で撤退する (「矛を収める」)。
//   判定式は warCreationSystem の開戦ゲート (winChance < generalDeclareThreshold) を
//   そのまま共有し「開始時予測 = 実際の判定」の単一の真実とする。撤退は status_quo
//   終結 (initiator smallFailure / target smallSuccess) として記録し、戦争に至らなかった
//   測定可能な外交相互作用を残す。勝てる/ゲート無効/revolt_negotiation/非 polity の場合は
//   従来通り markPlayEscalated する。
//   NOTE: warCreationSystem の war gate は backstop として残置 (A は動員消費前、gate は
//   同 tick 他 play の動員消費後に判定するため、A をすり抜け gate で voided になる play が
//   残りうる。許容トレードオフ)。
export function escalateOrStandDown(
  ctx: TickContext,
  play: DiplomaticPlay,
  escalateMeta: {
    polityIds: PolityId[]
    provinceIds: ProvinceId[]
    holdingIds: HoldingId[]
    summary: string
    messageKey: string
    messageParams: EventMessageParams
    eventEntityRefs: EventEntityRef[]
  },
  standDownMessageKey: string,
): TickContext {
  if (
    ctx.config.winChanceWarGateEnabled &&
    play.kind !== 'revolt_negotiation' &&
    play.initiator.kind === 'polity' &&
    play.target.kind === 'polity'
  ) {
    const winChance = estimateAttackerWinChance(ctx.state, ctx.config, play.initiator, play.target)
    const threshold = calcGeneralDeclareThreshold(ctx.state, play.initiator.id, ctx.config)
    if (winChance < threshold) {
      const nextCtx = setPlayStatus(ctx, play.id, 'settled', 'status_quo')
      const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
        type: 'DIPLOMATIC_PLAY_SETTLED',
        importance: 'major',
        messageKey: standDownMessageKey,
        messageParams: escalateMeta.messageParams,
        entityRefs: escalateMeta.eventEntityRefs,
      })
      return { ...ctxEv, events: [...ctxEv.events, event] }
    }
  }
  return markPlayEscalated(ctx, play.id, escalateMeta)
}

// v0.44 §7.2: terminal 化は必ず terminalOutcome とセットで行う (required 引数にして
// tsc に全サイト被覆を強制させる)。terminal play は cleanupTerminalDiplomacy が同 tick で
// 削除するため、後続 system での補完は不可能。
export function setPlayStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: TerminalDiplomaticPlayStatus,
  terminalOutcome: DiplomaticPlayTerminalOutcome,
): TickContext {
  return setPlayAnyStatus(ctx, playId, status, terminalOutcome)
}

function setPlayActiveStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: 'active' | 'escalated',
): TickContext {
  return setPlayAnyStatus(ctx, playId, status, undefined)
}

function setPlayAnyStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: DiplomaticPlayStatus,
  terminalOutcome: DiplomaticPlayTerminalOutcome | undefined,
): TickContext {
  const play = ctx.state.diplomaticPlays[playId]
  if (!play) return ctx
  const log = createLogger(ctx.config.debug)
  log.log('DIPLOMATIC_PLAY', {
    playId,
    kind: play.kind,
    from: play.status,
    to: status,
    ...(terminalOutcome !== undefined ? { outcome: terminalOutcome } : {}),
  })
  return {
    ...ctx,
    state: {
      ...ctx.state,
      diplomaticPlays: {
        ...ctx.state.diplomaticPlays,
        [playId]: {
          ...play,
          status,
          ...(terminalOutcome !== undefined ? { terminalOutcome } : {}),
        },
      },
    },
  }
}

// v0.44 §7.3: settled 時の demands_met / status_quo 分類。
// accepted offer に initiator の実質要求 demand (transfer_land_contract /
// change_contract_tax_rate / popular_tax_relief) が含まれれば demands_met。
// pay_wealth 単独・status_quo のみの offer は status_quo。読み取りのみ・RNG 不使用。
export function classifySettledOutcome(
  acceptedOffer: DiplomaticOffer,
): 'demands_met' | 'status_quo' {
  const substantive = acceptedOffer.demands.some(
    (d) =>
      d.kind === 'transfer_land_contract' ||
      d.kind === 'change_contract_tax_rate' ||
      d.kind === 'popular_tax_relief' ||
      d.kind === 'bailiff_dismissal' ||
      d.kind === 'secession',
  )
  return substantive ? 'demands_met' : 'status_quo'
}

// 旧 computeSellerTreasuryNeed を rename (defender = seller/holder の財政困窮度)
export function computeDefenderTreasuryNeed(treasury: number): number {
  const baseThreshold = 1000
  return clamp((baseThreshold - treasury) * 0.05, 0, 50)
}

export function computeProvinceValue(development: number): number {
  return clamp((development + 100) * 0.5, 0, 100)
}

export function computeStrategicValue(
  state: WorldState,
  provinceId: ProvinceId,
  ownerPolityId: PolityId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0
  let foreignNeighbors = 0
  for (const neighborId of province.neighbors) {
    const terminalPid = getProvinceTerminalPolityId(state, neighborId)
    if (terminalPid && terminalPid !== ownerPolityId) foreignNeighbors++
  }
  return clamp(foreignNeighbors * 25, 0, 100)
}

export function computePrestigeLoss(rank: number): number {
  // rank が高い (= 数値が小さい) 大国ほど Province 喪失の prestige loss が大きい
  // rank 1 → 50, rank 2 → 40, rank 3 → 30, rank 4 → 20, rank 5 → 10
  return clamp(60 - rank * 10, 10, 50)
}

// ─── Delegate management (spec §10: DiplomaticPlaySystem retains delegate alive check) ───

export function ensureDelegates(ctx: TickContext, play: DiplomaticPlay): TickContext {
  let currentCtx = ctx

  for (const side of ['initiator', 'target'] as const) {
    const latestPlay = currentCtx.state.diplomaticPlays[play.id]
    if (!latestPlay || latestPlay.status !== 'active') break

    const actor = side === 'initiator' ? latestPlay.initiator : latestPlay.target
    const currentDelegate =
      side === 'initiator'
        ? latestPlay.initiatorDelegatePersonId
        : latestPlay.targetDelegatePersonId

    let hasValidDelegate = false
    if (currentDelegate) {
      hasValidDelegate = isLivingPerson(currentCtx.state.persons[currentDelegate])
    }

    if (!hasValidDelegate) {
      const otherSideDelegate =
        side === 'initiator'
          ? latestPlay.targetDelegatePersonId
          : latestPlay.initiatorDelegatePersonId
      const newDelegate = getDiplomaticPlayDelegate(currentCtx.state, actor, otherSideDelegate)
      if (!newDelegate) continue

      const updatedPlay = { ...currentCtx.state.diplomaticPlays[play.id]! }
      if (side === 'initiator') {
        updatedPlay.initiatorDelegatePersonId = newDelegate
      } else {
        updatedPlay.targetDelegatePersonId = newDelegate
      }
      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          diplomaticPlays: {
            ...currentCtx.state.diplomaticPlays,
            [play.id]: updatedPlay,
          },
        },
      }
    }
  }

  return currentCtx
}
