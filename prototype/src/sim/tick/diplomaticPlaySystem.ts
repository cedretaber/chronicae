import type { TickContext } from './context'
import { makeEventId } from './context'
import { clamp } from '../utils/math'
import type { DiplomaticPlayId, PolityId, ProvinceId } from '../types/ids'
import type {
  DiplomaticPlay,
  DiplomaticPlayStatus,
  TerminalDiplomaticPlayStatus,
} from '../types/diplomaticPlay'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { adjustProvincePopUnrestByClass, adjustProvincePopUnrest } from '../mutations/popMutations'
import { disbandRebelPolity, type RebelLeaderAftermath } from '../mutations/worldStructureMutations'
import { applyLandContractTransferGoal } from '../mutations/landContractMutations'
import {
  getProvinceManpowerBase,
  getProvinceHouseManpowerBase,
} from '../selectors/popEconomySelectors'
import { getProvinceTerminalPolityId } from '../selectors/landContractSelectors'
import { getActorMilitaryPower } from '../selectors/actorSelectors'
import { calcGeneralWarPowerModifier } from '../selectors/personAbilityEffects'
import { randomFloat } from '../rng/rng'

// v0.18 Stage B/C/D §10 / §11 / §13
// DiplomaticPlaySystem: active な DiplomaticPlay を毎月進行させる。
//
// 役割:
//   - active Play の acceptanceScore を計算し、progress / tension を更新する
//   - progress >= settlementThreshold → settled (kind ごとの settlement 適用)
//   - tension  >= escalationThreshold → 'escalated' に設定 (DIPLOMATIC_PLAY_ESCALATED 発火)
//                                       本 system では status だけ変更、後段の
//                                       ConflictResolutionSystem (§13) が同 tick 中に
//                                       'resolved_by_conflict' に置換する
//   - deadline 到達 → progress > tension なら settled、tension > progress なら escalated、
//                     それ以外 failed
//
// 'escalated' は active 系 status (§10.2)。次 phase で resolve され terminal になる。

export function runDiplomaticPlaySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  for (const playIdStr of Object.keys(currentCtx.state.diplomaticPlays).sort()) {
    const play = currentCtx.state.diplomaticPlays[playIdStr as DiplomaticPlayId]
    if (!play) continue
    if (play.status !== 'active') continue
    if (play.kind === 'revolt_negotiation') {
      currentCtx = progressRevoltNegotiation(currentCtx, play)
    } else if (play.kind === 'land_purchase') {
      currentCtx = progressLandPurchase(currentCtx, play)
    } else if (play.kind === 'land_transfer_demand') {
      currentCtx = progressLandTransferDemand(currentCtx, play)
    }
  }
  return currentCtx
}

function isDeadlineReached(
  state: { currentYear: number; currentMonth: number },
  play: DiplomaticPlay,
): boolean {
  const cur = state.currentYear * 12 + state.currentMonth
  const dl = play.deadlineYear * 12 + play.deadlineMonth
  return cur >= dl
}

// ─── revolt_negotiation 進行 (Stage B、escalation 経路は Stage D で ConflictResolution に移譲) ───

function progressRevoltNegotiation(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  const state = ctx.state
  if (play.primaryDemand.kind !== 'revolt_concession') return ctx

  const demand = play.primaryDemand
  const provinceId = demand.provinceId
  const popGroupId = demand.popGroupId
  if (play.target.kind !== 'polity') return ctx
  const targetPolityId = play.target.id
  if (play.initiator.kind !== 'polity') return ctx
  const rebelPolityId = play.initiator.id

  const targetPolity = state.polities[targetPolityId]
  const rebelPolity = state.polities[rebelPolityId]
  const pop = state.popGroups[popGroupId]
  if (!targetPolity || !targetPolity.active || !rebelPolity || !rebelPolity.active || !pop) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // §10.3.1 acceptanceScore (target Polity 視点)
  const provinceUnrest = pop.unrest
  const rebelPower =
    pop.size * config.popRevoltPowerFactorByClass[pop.class] * (0.5 + pop.unrest / 100)
  const suppressionPower = estimateSuppressionPower(state, config, provinceId, targetPolityId)
  const concessionSeverity =
    demand.concessionLevel === 'minor'
      ? config.revoltConcessionSeverityMinor
      : config.revoltConcessionSeverityMajor

  const acceptanceScore =
    provinceUnrest +
    rebelPower * config.revoltAcceptRebelPowerFactor -
    suppressionPower * config.revoltAcceptSuppressionFactor -
    concessionSeverity

  const { nextProgress, nextTension } = applyAcceptanceUpdate(play, acceptanceScore, config)

  let nextCtx: TickContext = {
    ...ctx,
    state: {
      ...state,
      diplomaticPlays: {
        ...state.diplomaticPlays,
        [play.id]: { ...play, progress: nextProgress, tension: nextTension },
      },
    },
  }

  if (nextProgress >= config.diplomaticPlaySettlementThreshold) {
    return applyRevoltSettlement(nextCtx, play, demand, rebelPolityId, targetPolityId)
  }
  if (nextTension >= config.diplomaticPlayEscalationThreshold) {
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [rebelPolityId, targetPolityId],
      provinceIds: [provinceId],
      summary: `Revolt in ${nextCtx.state.provinces[provinceId]?.name ?? provinceId} has escalated to open conflict.`,
    })
  }
  if (isDeadlineReached(nextCtx.state, play)) {
    // deadline: progress > tension なら settled、tension > progress なら escalated、それ以外 failed (§10.2 step 6)
    if (nextProgress > nextTension) {
      return applyRevoltSettlement(nextCtx, play, demand, rebelPolityId, targetPolityId)
    }
    if (nextTension > nextProgress) {
      return markPlayEscalated(nextCtx, play.id, {
        polityIds: [rebelPolityId, targetPolityId],
        provinceIds: [provinceId],
        summary: `Deadlocked revolt in ${nextCtx.state.provinces[provinceId]?.name ?? provinceId} erupts at deadline.`,
      })
    }
    nextCtx = setPlayStatus(nextCtx, play.id, 'failed')
    const { id: eid, ctx: ctxEv } = makeEventId(nextCtx)
    const ev: SimEvent = {
      id: eid,
      year: ctxEv.state.currentYear,
      month: ctxEv.state.currentMonth,
      type: 'DIPLOMATIC_PLAY_FAILED',
      importance: 'normal',
      actorIds: [],
      houseIds: [],
      polityIds: [rebelPolityId, targetPolityId],
      provinceIds: [provinceId],
      summary: `Revolt negotiation in ${nextCtx.state.provinces[provinceId]?.name ?? provinceId} ended without resolution.`,
      reasons: [],
      effects: [],
    }
    return { ...ctxEv, events: [...ctxEv.events, ev] }
  }
  return nextCtx
}

function estimateSuppressionPower(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
  targetPolityId: PolityId,
): number {
  const targetPolity = state.polities[targetPolityId]
  if (!targetPolity) return 1

  const polityManpower = getProvinceManpowerBase(state, config, provinceId)
  let suppressionPower =
    polityManpower * config.provinceRevoltCountrySuppressionFactor +
    Math.log1p(targetPolity.treasury) * config.provinceRevoltTreasurySuppressionFactor
  const targetOwnerHouseId = targetPolity.ownerHouseId
  if (targetOwnerHouseId !== undefined) {
    const ownerHouse = state.houses[targetOwnerHouseId]
    if (ownerHouse) {
      suppressionPower +=
        getProvinceHouseManpowerBase(state, config, provinceId) *
        config.provinceRevoltHouseSuppressionFactor
      suppressionPower +=
        Math.log1p(ownerHouse.wealth) * config.provinceRevoltHouseWealthSuppressionFactor
    }
  }
  return suppressionPower
}

function applyRevoltSettlement(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticPlay['primaryDemand'], { kind: 'revolt_concession' }>,
  rebelPolityId: PolityId,
  targetPolityId: PolityId,
): TickContext {
  const config = ctx.config

  const disbandResult = disbandRebelPolity(ctx, {
    rebelPolityId,
    restoreToPolityId: targetPolityId,
    provinceId: demand.provinceId,
    leaderAftermath: pickSettlementAftermath(ctx),
    reason: 'settlement',
  })
  if (!disbandResult.ok) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  let nextCtx = disbandResult.value.ctx
  let state = nextCtx.state

  const pop = state.popGroups[demand.popGroupId]
  if (pop) {
    state = adjustProvincePopUnrestByClass(
      state,
      demand.provinceId,
      pop.class,
      -config.revoltSettlementMainUnrestReduction,
    )
    state = adjustProvincePopUnrest(
      state,
      demand.provinceId,
      -config.revoltSettlementOtherUnrestReduction,
    )
  }

  const cost =
    demand.concessionLevel === 'major'
      ? config.revoltSettlementTreasuryCostMajor
      : config.revoltSettlementTreasuryCostMinor
  const targetPolity = state.polities[targetPolityId]
  if (targetPolity) {
    state = {
      ...state,
      polities: {
        ...state.polities,
        [targetPolityId]: {
          ...targetPolity,
          treasury: Math.max(0, targetPolity.treasury - cost),
        },
      },
    }
  }

  nextCtx = { ...nextCtx, state }
  nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

  const { id: eid, ctx: ctxEv } = makeEventId(nextCtx)
  const ev: SimEvent = {
    id: eid,
    year: ctxEv.state.currentYear,
    month: ctxEv.state.currentMonth,
    type: 'DIPLOMATIC_PLAY_SETTLED',
    importance: 'major',
    actorIds: [],
    houseIds: [],
    polityIds: [rebelPolityId, targetPolityId],
    provinceIds: [demand.provinceId],
    summary: `Revolt negotiation in ${ctxEv.state.provinces[demand.provinceId]?.name ?? demand.provinceId} settled — concessions granted.`,
    reasons: [],
    effects: [],
  }
  return { ...ctxEv, events: [...ctxEv.events, ev] }
}

function pickSettlementAftermath(ctx: TickContext): RebelLeaderAftermath {
  const { value, rng } = randomFloat(ctx.rng)
  void rng
  return value < 0.5 ? 'returned_to_obscurity' : 'exiled'
}

// ─── land_purchase 進行 (Stage C) ───

function progressLandPurchase(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  const state = ctx.state
  if (play.primaryDemand.kind !== 'transfer_land_contract') return ctx
  if (!play.counterDemand || play.counterDemand.kind !== 'pay_wealth') return ctx
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') return ctx

  const primary = play.primaryDemand
  const counter = play.counterDemand
  const buyerPolityId = play.initiator.id
  const sellerPolityId = play.target.id
  const provinceId = primary.provinceId
  const offeredPrice = counter.amount

  const buyer = state.polities[buyerPolityId]
  const seller = state.polities[sellerPolityId]
  const province = state.provinces[provinceId]
  if (!buyer || !buyer.active || !seller || !seller.active || !province) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  if (getProvinceTerminalPolityId(state, provinceId) !== sellerPolityId) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  if (seller.ownerHouseId === undefined) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  const sellerTreasuryNeed = computeSellerTreasuryNeed(seller.treasury)
  const provinceValue = computeProvinceValue(province.development)
  const strategicValue = computeStrategicValue(state, provinceId, sellerPolityId)

  const acceptanceScore =
    offeredPrice * 0.05 +
    sellerTreasuryNeed -
    provinceValue * config.purchaseProvinceValueFactor -
    strategicValue * config.purchaseStrategicLossFactor

  const { nextProgress, nextTension } = applyAcceptanceUpdate(play, acceptanceScore, config)

  let nextCtx: TickContext = {
    ...ctx,
    state: {
      ...state,
      diplomaticPlays: {
        ...state.diplomaticPlays,
        [play.id]: { ...play, progress: nextProgress, tension: nextTension },
      },
    },
  }

  if (nextProgress >= config.diplomaticPlaySettlementThreshold) {
    return applyLandPurchaseSettlement(
      nextCtx,
      play,
      primary,
      counter,
      buyerPolityId,
      sellerPolityId,
    )
  }
  // land_purchase は escalation 経路を持たない (Stage D 以降も維持)
  if (isDeadlineReached(nextCtx.state, play)) {
    nextCtx = setPlayStatus(nextCtx, play.id, 'failed')
    const { id: eid, ctx: ctxEv } = makeEventId(nextCtx)
    const provinceName = ctxEv.state.provinces[provinceId]?.name ?? provinceId
    const ev: SimEvent = {
      id: eid,
      year: ctxEv.state.currentYear,
      month: ctxEv.state.currentMonth,
      type: 'DIPLOMATIC_PLAY_FAILED',
      importance: 'normal',
      actorIds: [],
      houseIds: [],
      polityIds: [buyerPolityId, sellerPolityId],
      provinceIds: [provinceId],
      summary: `Land purchase negotiation for ${provinceName} failed.`,
      reasons: [],
      effects: [],
    }
    return { ...ctxEv, events: [...ctxEv.events, ev] }
  }
  return nextCtx
}

function applyLandPurchaseSettlement(
  ctx: TickContext,
  play: DiplomaticPlay,
  primary: Extract<DiplomaticPlay['primaryDemand'], { kind: 'transfer_land_contract' }>,
  counter: Extract<NonNullable<DiplomaticPlay['counterDemand']>, { kind: 'pay_wealth' }>,
  buyerPolityId: PolityId,
  sellerPolityId: PolityId,
): TickContext {
  const state = ctx.state
  const buyer = state.polities[buyerPolityId]
  const seller = state.polities[sellerPolityId]
  if (!buyer || !seller) return setPlayStatus(ctx, play.id, 'cancelled')
  const price = counter.amount

  if (buyer.treasury < price) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  const transferResult = applyLandContractTransferGoal(ctx, {
    provinceId: primary.provinceId,
    toPolityId: buyerPolityId,
    reason: 'purchase',
  })
  if (!transferResult.ok) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  let nextCtx = transferResult.value.ctx

  const buyerNow = nextCtx.state.polities[buyerPolityId]
  const sellerNow = nextCtx.state.polities[sellerPolityId]
  if (buyerNow && sellerNow) {
    nextCtx = {
      ...nextCtx,
      state: {
        ...nextCtx.state,
        polities: {
          ...nextCtx.state.polities,
          [buyerPolityId]: { ...buyerNow, treasury: Math.max(0, buyerNow.treasury - price) },
          [sellerPolityId]: { ...sellerNow, treasury: sellerNow.treasury + price },
        },
      },
    }
  }

  nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

  const { id: eid, ctx: ctxEv } = makeEventId(nextCtx)
  const provinceName = ctxEv.state.provinces[primary.provinceId]?.name ?? primary.provinceId
  const buyerName = ctxEv.state.polities[buyerPolityId]?.name ?? buyerPolityId
  const sellerName = ctxEv.state.polities[sellerPolityId]?.name ?? sellerPolityId
  const ev: SimEvent = {
    id: eid,
    year: ctxEv.state.currentYear,
    month: ctxEv.state.currentMonth,
    type: 'DIPLOMATIC_PLAY_SETTLED',
    importance: 'major',
    actorIds: [],
    houseIds: [],
    polityIds: [buyerPolityId, sellerPolityId],
    provinceIds: [primary.provinceId],
    summary: `${buyerName} purchased ${provinceName} from ${sellerName} for ${Math.round(price)} gold.`,
    reasons: [],
    effects: [],
  }
  return { ...ctxEv, events: [...ctxEv.events, ev] }
}

// ─── land_transfer_demand 進行 (Stage D §10.3.3 / §11.2) ───

function progressLandTransferDemand(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  const state = ctx.state
  if (play.primaryDemand.kind !== 'transfer_land_contract') return ctx
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') return ctx

  const primary = play.primaryDemand
  const acquirerPolityId = play.initiator.id
  const defenderPolityId = play.target.id
  const provinceId = primary.provinceId

  const acquirer = state.polities[acquirerPolityId]
  const defender = state.polities[defenderPolityId]
  const province = state.provinces[provinceId]
  if (
    !acquirer ||
    !acquirer.active ||
    !defender ||
    !defender.active ||
    !province ||
    acquirer.ownerHouseId === undefined ||
    defender.ownerHouseId === undefined
  ) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  if (getProvinceTerminalPolityId(state, provinceId) !== defenderPolityId) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // §10.3.3 acceptanceScore (defender 視点での「譲歩しても良い」度合い)
  //   acceptanceScore =
  //     initiatorMilitaryPower * demandPressureFactor
  //     - defenderMilitaryPower * demandResistFactor
  //     - provinceValue * demandProvinceValueFactor
  //     - prestigeLoss * demandPrestigeLossFactor
  const initiatorPower =
    getActorMilitaryPower(state, config, play.initiator) *
    calcGeneralWarPowerModifier(state, acquirerPolityId, config)
  const defenderPower =
    getActorMilitaryPower(state, config, play.target) *
    calcGeneralWarPowerModifier(state, defenderPolityId, config)
  const provinceValue = computeProvinceValue(province.development)
  const prestigeLoss = computePrestigeLoss(defender.rank)

  const acceptanceScore =
    initiatorPower * config.demandPressureFactor -
    defenderPower * config.demandResistFactor -
    provinceValue * config.demandProvinceValueFactor -
    prestigeLoss * config.demandPrestigeLossFactor

  const { nextProgress, nextTension } = applyAcceptanceUpdate(play, acceptanceScore, config)

  let nextCtx: TickContext = {
    ...ctx,
    state: {
      ...state,
      diplomaticPlays: {
        ...state.diplomaticPlays,
        [play.id]: { ...play, progress: nextProgress, tension: nextTension },
      },
    },
  }

  if (nextProgress >= config.diplomaticPlaySettlementThreshold) {
    return applyLandTransferDemandSettlement(
      nextCtx,
      play,
      primary,
      acquirerPolityId,
      defenderPolityId,
    )
  }
  if (nextTension >= config.diplomaticPlayEscalationThreshold) {
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [acquirerPolityId, defenderPolityId],
      provinceIds: [provinceId],
      summary: `${nextCtx.state.polities[acquirerPolityId]?.name ?? acquirerPolityId} mobilises against ${nextCtx.state.polities[defenderPolityId]?.name ?? defenderPolityId} over ${nextCtx.state.provinces[provinceId]?.name ?? provinceId}.`,
    })
  }
  if (isDeadlineReached(nextCtx.state, play)) {
    if (nextProgress > nextTension) {
      return applyLandTransferDemandSettlement(
        nextCtx,
        play,
        primary,
        acquirerPolityId,
        defenderPolityId,
      )
    }
    if (nextTension > nextProgress) {
      return markPlayEscalated(nextCtx, play.id, {
        polityIds: [acquirerPolityId, defenderPolityId],
        provinceIds: [provinceId],
        summary: `Deadlocked demand erupts: ${nextCtx.state.polities[acquirerPolityId]?.name ?? acquirerPolityId} attacks for ${nextCtx.state.provinces[provinceId]?.name ?? provinceId}.`,
      })
    }
    nextCtx = setPlayStatus(nextCtx, play.id, 'failed')
    const { id: eid, ctx: ctxEv } = makeEventId(nextCtx)
    const ev: SimEvent = {
      id: eid,
      year: ctxEv.state.currentYear,
      month: ctxEv.state.currentMonth,
      type: 'DIPLOMATIC_PLAY_FAILED',
      importance: 'normal',
      actorIds: [],
      houseIds: [],
      polityIds: [acquirerPolityId, defenderPolityId],
      provinceIds: [provinceId],
      summary: `${ctxEv.state.polities[acquirerPolityId]?.name ?? acquirerPolityId}'s demand on ${ctxEv.state.provinces[provinceId]?.name ?? provinceId} faded out.`,
      reasons: [],
      effects: [],
    }
    return { ...ctxEv, events: [...ctxEv.events, ev] }
  }
  return nextCtx
}

function applyLandTransferDemandSettlement(
  ctx: TickContext,
  play: DiplomaticPlay,
  primary: Extract<DiplomaticPlay['primaryDemand'], { kind: 'transfer_land_contract' }>,
  acquirerPolityId: PolityId,
  defenderPolityId: PolityId,
): TickContext {
  const transferResult = applyLandContractTransferGoal(ctx, {
    provinceId: primary.provinceId,
    toPolityId: acquirerPolityId,
    reason: 'demand',
  })
  if (!transferResult.ok) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  let nextCtx = transferResult.value.ctx
  nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

  const { id: eid, ctx: ctxEv } = makeEventId(nextCtx)
  const provinceName = ctxEv.state.provinces[primary.provinceId]?.name ?? primary.provinceId
  const acquirerName = ctxEv.state.polities[acquirerPolityId]?.name ?? acquirerPolityId
  const defenderName = ctxEv.state.polities[defenderPolityId]?.name ?? defenderPolityId
  const ev: SimEvent = {
    id: eid,
    year: ctxEv.state.currentYear,
    month: ctxEv.state.currentMonth,
    type: 'DIPLOMATIC_PLAY_SETTLED',
    importance: 'major',
    actorIds: [],
    houseIds: [],
    polityIds: [acquirerPolityId, defenderPolityId],
    provinceIds: [primary.provinceId],
    summary: `${defenderName} ceded ${provinceName} to ${acquirerName} under pressure.`,
    reasons: [],
    effects: [],
  }
  return { ...ctxEv, events: [...ctxEv.events, ev] }
}

// ─── 共通 helpers ───

function applyAcceptanceUpdate(
  play: DiplomaticPlay,
  acceptanceScore: number,
  config: SimulationConfig,
): { nextProgress: number; nextTension: number } {
  if (acceptanceScore >= 0) {
    return {
      nextProgress: clamp(play.progress + clamp(acceptanceScore * 0.2, 1, 12), 0, 100),
      nextTension: clamp(play.tension + config.diplomaticPlayBaseTensionGain, 0, 100),
    }
  }
  return {
    nextProgress: play.progress,
    nextTension: clamp(play.tension + clamp(-acceptanceScore * 0.2, 1, 12), 0, 100),
  }
}

// status='escalated' (active 系) に設定し DIPLOMATIC_PLAY_ESCALATED event を発火する。
// 同 tick 内の conflictResolutionSystem が拾い上げて 'resolved_by_conflict' に置換する。
function markPlayEscalated(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  eventMeta: {
    polityIds: PolityId[]
    provinceIds: ProvinceId[]
    summary: string
  },
): TickContext {
  const nextCtx = setPlayActiveStatus(ctx, playId, 'escalated')
  const { id: eid, ctx: ctxEv } = makeEventId(nextCtx)
  const ev: SimEvent = {
    id: eid,
    year: ctxEv.state.currentYear,
    month: ctxEv.state.currentMonth,
    type: 'DIPLOMATIC_PLAY_ESCALATED',
    importance: 'major',
    actorIds: [],
    houseIds: [],
    polityIds: eventMeta.polityIds,
    provinceIds: eventMeta.provinceIds,
    summary: eventMeta.summary,
    reasons: [],
    effects: [],
  }
  return { ...ctxEv, events: [...ctxEv.events, ev] }
}

function setPlayStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: TerminalDiplomaticPlayStatus,
): TickContext {
  return setPlayAnyStatus(ctx, playId, status)
}

function setPlayActiveStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: 'active' | 'escalated',
): TickContext {
  return setPlayAnyStatus(ctx, playId, status)
}

function setPlayAnyStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: DiplomaticPlayStatus,
): TickContext {
  const play = ctx.state.diplomaticPlays[playId]
  if (!play) return ctx
  return {
    ...ctx,
    state: {
      ...ctx.state,
      diplomaticPlays: {
        ...ctx.state.diplomaticPlays,
        [playId]: { ...play, status },
      },
    },
  }
}

function computeSellerTreasuryNeed(treasury: number): number {
  const baseThreshold = 1000
  return clamp((baseThreshold - treasury) * 0.05, 0, 50)
}

function computeProvinceValue(development: number): number {
  return clamp((development + 100) * 0.5, 0, 100)
}

function computeStrategicValue(
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

function computePrestigeLoss(rank: number): number {
  // rank が高い (= 数値が小さい) 大国ほど Province 喪失の prestige loss が大きい
  // rank 1 → 50, rank 2 → 40, rank 3 → 30, rank 4 → 20, rank 5 → 10
  return clamp(60 - rank * 10, 10, 50)
}
