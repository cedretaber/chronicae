import type { TickContext } from './context'
import { makeEventId } from './context'
import { clamp } from '../utils/math'
import type { DiplomaticPlayId, PolityId, ProvinceId } from '../types/ids'
import type { DiplomaticPlay, TerminalDiplomaticPlayStatus } from '../types/diplomaticPlay'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { adjustProvincePopUnrestByClass, adjustProvincePopUnrest } from '../mutations/popMutations'
import { resolveRevoltConflict } from './provinceRevoltSystem'
import { disbandRebelPolity, type RebelLeaderAftermath } from '../mutations/worldStructureMutations'
import { applyLandContractTransferGoal } from '../mutations/landContractMutations'
import {
  getProvinceManpowerBase,
  getProvinceHouseManpowerBase,
} from '../selectors/popEconomySelectors'
import { getProvinceTerminalPolityId } from '../selectors/landContractSelectors'
import { randomFloat } from '../rng/rng'

// v0.18 Stage B §10 / §11.4 / §13.3 / §14.5-7
// DiplomaticPlaySystem: active な DiplomaticPlay を毎月進行させる。
// Stage B では revolt_negotiation のみ進行 (他 kind は skip)。
//
// 判定優先順 (§10.2):
//   1. progress >= settlementThreshold → settled (revolt_concession 適用 + disband)
//   2. tension  >= escalationThreshold → resolved_by_conflict (resolveRevoltConflict 経路)
//   3. deadline 到達 → failed (Rebel Polity active のまま、Stage B 制限)
//   4. それ以外 → progress / tension 更新

export function runDiplomaticPlaySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  for (const playIdStr of Object.keys(currentCtx.state.diplomaticPlays).sort()) {
    const play = currentCtx.state.diplomaticPlays[playIdStr as DiplomaticPlayId]
    if (!play) continue
    if (play.status !== 'active') continue
    // Stage B: revolt_negotiation 進行
    // Stage C: land_purchase 進行
    // 他 kind は Stage D 以降で実装
    if (play.kind === 'revolt_negotiation') {
      currentCtx = progressRevoltNegotiation(currentCtx, play)
    } else if (play.kind === 'land_purchase') {
      currentCtx = progressLandPurchase(currentCtx, play)
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

  // target / pop / rebel polity が依然 active かを確認
  const targetPolity = state.polities[targetPolityId]
  const rebelPolity = state.polities[rebelPolityId]
  const pop = state.popGroups[popGroupId]
  if (!targetPolity || !targetPolity.active || !rebelPolity || !rebelPolity.active || !pop) {
    // 整合性が崩れている (target が滅亡など) → Play を cancelled として終了
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // §10.3.1 acceptanceScore (target Polity 視点の妥協容認度)
  const provinceUnrest = pop.unrest
  const rebelPower =
    pop.size * config.popRevoltPowerFactorByClass[pop.class] * (0.5 + pop.unrest / 100)
  // suppressionPower の概算 (resolveRevoltConflict の式と同じ構造、roll なし)
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

  // §10.4 progress / tension 更新
  let nextProgress = play.progress
  let nextTension: number
  if (acceptanceScore >= 0) {
    nextProgress = clamp(play.progress + clamp(acceptanceScore * 0.2, 1, 12), 0, 100)
    nextTension = clamp(play.tension + config.diplomaticPlayBaseTensionGain, 0, 100)
  } else {
    nextTension = clamp(play.tension + clamp(-acceptanceScore * 0.2, 1, 12), 0, 100)
  }

  // 一旦 progress/tension を更新した play を state に反映
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

  // 判定優先順
  if (nextProgress >= config.diplomaticPlaySettlementThreshold) {
    return applyRevoltSettlement(nextCtx, play, demand, rebelPolityId, targetPolityId)
  }
  if (nextTension >= config.diplomaticPlayEscalationThreshold) {
    return applyRevoltEscalation(nextCtx, play, demand, rebelPolityId, targetPolityId)
  }
  if (isDeadlineReached(nextCtx.state, play)) {
    // Stage B 制限: deadline 到達は failed (Rebel Polity active のまま残る)
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
      summary: `Revolt negotiation in ${nextCtx.state.provinces[provinceId]?.name ?? provinceId} failed without resolution.`,
      reasons: [],
      effects: [],
    }
    return { ...ctxEv, events: [...ctxEv.events, ev] }
  }

  // 通常進行: DIPLOMATIC_PLAY_PROGRESS event は毎月だと過剰なので発火しない
  // (ノイズ抑制のため Stage B では skip。Stage E で UI 要件に応じて再検討)
  return nextCtx
}

function estimateSuppressionPower(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
  targetPolityId: PolityId,
): number {
  // resolveRevoltConflict と同じ式 (roll なし)
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

  // disbandRebelPolity を先に試行 (rank 不変条件違反などで失敗する可能性)
  const disbandResult = disbandRebelPolity(ctx, {
    rebelPolityId,
    restoreToPolityId: targetPolityId,
    provinceId: demand.provinceId,
    leaderAftermath: pickSettlementAftermath(ctx),
    reason: 'settlement',
  })
  if (!disbandResult.ok) {
    // disband 失敗 → 妥協自体を成立させず Play は cancelled として終了
    // (concession 効果も適用しない、rebel polity 存続)
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  let nextCtx = disbandResult.value.ctx
  let state = nextCtx.state

  // §12.4 revolt_concession 効果適用 (disband 成功後のみ)
  const pop = state.popGroups[demand.popGroupId]
  if (pop) {
    state = adjustProvincePopUnrestByClass(
      state,
      demand.provinceId,
      pop.class,
      -config.revoltSettlementMainUnrestReduction,
    )
    // 他 PopGroup unrest -OtherUnrestReduction (negative collateral)
    state = adjustProvincePopUnrest(
      state,
      demand.provinceId,
      -config.revoltSettlementOtherUnrestReduction,
    )
    // ただし adjustProvincePopUnrest は全 PopGroup に均等に適用するため、
    // 主反乱 pop には main + other 両方が乗ってしまう。Stage B では許容 (concession の効果として強めに作用)
  }

  // target Polity treasury -= cost
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

  // Play を settled に
  nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

  // DIPLOMATIC_PLAY_SETTLED event
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

function applyRevoltEscalation(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticPlay['primaryDemand'], { kind: 'revolt_concession' }>,
  rebelPolityId: PolityId,
  targetPolityId: PolityId,
): TickContext {
  const config = ctx.config
  // resolveRevoltConflict で勝敗判定
  const { result, rng: nextRng } = resolveRevoltConflict(ctx.state, config, ctx.rng, {
    provinceId: demand.provinceId,
    popGroupId: demand.popGroupId,
    targetPolityId,
  })
  let nextCtx: TickContext = { ...ctx, rng: nextRng }

  if (result.rebelWins) {
    // Rebel 勝利: Rebel Polity 存続、Play は resolved_by_conflict
    nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')
    // 対象 PopGroup unrest を大幅低下 (独立達成による解放感)
    const pop = nextCtx.state.popGroups[demand.popGroupId]
    if (pop) {
      const reducedState = adjustProvincePopUnrestByClass(
        nextCtx.state,
        demand.provinceId,
        pop.class,
        -config.revoltSettlementMainUnrestReduction,
      )
      nextCtx = { ...nextCtx, state: reducedState }
    }
    // REVOLT_POLITY_ESTABLISHED event
    const { id: eid, ctx: ctxEv } = makeEventId(nextCtx)
    const ev: SimEvent = {
      id: eid,
      year: ctxEv.state.currentYear,
      month: ctxEv.state.currentMonth,
      type: 'REVOLT_POLITY_ESTABLISHED',
      importance: 'critical',
      actorIds: [],
      houseIds: [],
      polityIds: [rebelPolityId, targetPolityId],
      provinceIds: [demand.provinceId],
      summary: `The revolt in ${ctxEv.state.provinces[demand.provinceId]?.name ?? demand.provinceId} has triumphed — independence is achieved.`,
      reasons: [],
      effects: [],
    }
    return { ...ctxEv, events: [...ctxEv.events, ev] }
  }

  // Target 勝利: 鎮圧成功 → disbandRebelPolity を先に試行 (rank 違反等で失敗する可能性)
  const disbandResult = disbandRebelPolity(nextCtx, {
    rebelPolityId,
    restoreToPolityId: targetPolityId,
    provinceId: demand.provinceId,
    leaderAftermath: pickSuppressionAftermath(nextCtx),
    reason: 'suppression',
  })
  if (!disbandResult.ok) {
    // disband 失敗 → 鎮圧効果も適用せず Play cancelled として終了 (rebel polity 存続)
    return setPlayStatus(nextCtx, play.id, 'cancelled')
  }
  nextCtx = disbandResult.value.ctx

  // §14.6 鎮圧効果 (disband 成功後のみ適用)
  let state = nextCtx.state
  const pop = state.popGroups[demand.popGroupId]
  if (pop) {
    state = adjustProvincePopUnrestByClass(
      state,
      demand.provinceId,
      pop.class,
      -config.revoltSuppressedMainUnrestReduction,
    )
    state = adjustProvincePopUnrest(
      state,
      demand.provinceId,
      -config.revoltSuppressedOtherUnrestReduction,
    )
  }
  const province = state.provinces[demand.provinceId]
  if (province) {
    state = {
      ...state,
      provinces: {
        ...state.provinces,
        [demand.provinceId]: {
          ...province,
          development: clamp(
            province.development - config.revoltSuppressedDevelopmentDamage,
            -100,
            100,
          ),
        },
      },
    }
  }
  // target Polity legacyPrestige +1
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

  // DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT event
  const { id: eid, ctx: ctxEv } = makeEventId(nextCtx)
  const ev: SimEvent = {
    id: eid,
    year: ctxEv.state.currentYear,
    month: ctxEv.state.currentMonth,
    type: 'DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT',
    importance: 'major',
    actorIds: [],
    houseIds: [],
    polityIds: [rebelPolityId, targetPolityId],
    provinceIds: [demand.provinceId],
    summary: `Revolt in ${ctxEv.state.provinces[demand.provinceId]?.name ?? demand.provinceId} was resolved by force.`,
    reasons: [],
    effects: [],
  }
  return { ...ctxEv, events: [...ctxEv.events, ev] }
}

function pickSettlementAftermath(ctx: TickContext): RebelLeaderAftermath {
  // settlement 時: returned_to_obscurity / exiled の 50/50
  const { value, rng } = randomFloat(ctx.rng)
  // rng を消費するが ctx には戻さない (caller 側で disbandRebelPolity 後の rng と整合性なくてもよい)
  // ※ 厳密な seed-stable を求めるなら nextCtx に rng を反映する設計が必要だが、Stage B では簡略化
  void rng
  return value < 0.5 ? 'returned_to_obscurity' : 'exiled'
}

function pickSuppressionAftermath(ctx: TickContext): RebelLeaderAftermath {
  // suppression 時: executed / vanished の 50/50
  const { value, rng } = randomFloat(ctx.rng)
  void rng
  return value < 0.5 ? 'executed' : 'vanished'
}

function setPlayStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: TerminalDiplomaticPlayStatus,
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

// v0.18 Stage C §10.3.2 / §11.1 / §12.2
// land_purchase Play の月次進行 (target=seller 視点での acceptanceScore で更新)。
// Stage C では escalation 経路は実装しない (cancelled として終了)。
//
// 判定優先順:
//   1. progress >= settlementThreshold → settled (金銭移転 + LandContract 移転)
//   2. deadline 到達 → failed
//   3. それ以外 → progress/tension 更新のみ
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

  // target / buyer / Province の整合性を確認
  const buyer = state.polities[buyerPolityId]
  const seller = state.polities[sellerPolityId]
  const province = state.provinces[provinceId]
  if (!buyer || !buyer.active || !seller || !seller.active || !province) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  // 既に province が seller 以外のものになっている (war で奪われた等) → cancelled
  if (getProvinceTerminalPolityId(state, provinceId) !== sellerPolityId) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  // commonwealth 化など、seller の rank/owner が変わった場合も cancelled
  if (seller.ownerHouseId === undefined) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // §10.3.2 acceptanceScore (seller 視点)
  //   acceptanceScore =
  //     offeredPrice
  //     + sellerTreasuryNeed
  //     - provinceValue * config.purchaseProvinceValueFactor
  //     - strategicValue * config.purchaseStrategicLossFactor
  const sellerTreasuryNeed = computeSellerTreasuryNeed(seller.treasury)
  const provinceValue = computeProvinceValue(province.development)
  const strategicValue = computeStrategicValue(state, provinceId, sellerPolityId)

  const acceptanceScore =
    offeredPrice * 0.05 + // price を 0.05 倍して unrest スケールに揃える (旧 price base = 500)
    sellerTreasuryNeed -
    provinceValue * config.purchaseProvinceValueFactor -
    strategicValue * config.purchaseStrategicLossFactor

  // progress / tension 更新 (Stage B と同じ式)
  let nextProgress = play.progress
  let nextTension: number
  if (acceptanceScore >= 0) {
    nextProgress = clamp(play.progress + clamp(acceptanceScore * 0.2, 1, 12), 0, 100)
    nextTension = clamp(play.tension + config.diplomaticPlayBaseTensionGain, 0, 100)
  } else {
    nextTension = clamp(play.tension + clamp(-acceptanceScore * 0.2, 1, 12), 0, 100)
  }

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

  // 判定優先順
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
  // Stage C: escalation 経路は実装しない (Stage D で land_transfer_demand 経路として追加)
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

  // 通常進行: DIPLOMATIC_PLAY_PROGRESS event は発火しない (Stage B と同様、ノイズ抑制)
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

  // buyer が支払い能力を失っていれば cancelled
  if (buyer.treasury < price) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // LandContract 移転 (rank 不変条件チェックを内包、失敗時は state 不変で error)
  const transferResult = applyLandContractTransferGoal(ctx, {
    provinceId: primary.provinceId,
    toPolityId: buyerPolityId,
    reason: 'purchase',
  })
  if (!transferResult.ok) {
    // 移転失敗 → 金銭も移さず Play cancelled
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  let nextCtx = transferResult.value.ctx

  // 金銭移転
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

  // Play status = 'settled'
  nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

  // DIPLOMATIC_PLAY_SETTLED event
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

function computeSellerTreasuryNeed(treasury: number): number {
  // treasury が低いほど高い値を返す (~ 100 で 0、0 で 50)
  const baseThreshold = 1000
  return clamp((baseThreshold - treasury) * 0.05, 0, 50)
}

function computeProvinceValue(development: number): number {
  // development -100..100 → 0..100 にマッピング (high dev = 価値高)
  return clamp((development + 100) * 0.5, 0, 100)
}

function computeStrategicValue(
  state: WorldState,
  provinceId: ProvinceId,
  ownerPolityId: PolityId,
): number {
  // 隣接 Province のうち owner 以外の Polity 所属が多いほど strategic value が高い (国境度)
  const province = state.provinces[provinceId]
  if (!province) return 0
  let foreignNeighbors = 0
  for (const neighborId of province.neighbors) {
    const terminalPid = getProvinceTerminalPolityId(state, neighborId)
    if (terminalPid && terminalPid !== ownerPolityId) foreignNeighbors++
  }
  // 0-100 にスケーリング (4 隣接で 100 と仮定)
  return clamp(foreignNeighbors * 25, 0, 100)
}
