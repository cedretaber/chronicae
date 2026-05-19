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
import {
  getProvinceManpowerBase,
  getProvinceHouseManpowerBase,
} from '../selectors/popEconomySelectors'
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
    // Stage B: revolt_negotiation のみ進行。他 kind は Stage C/D で実装
    if (play.kind !== 'revolt_negotiation') continue
    currentCtx = progressRevoltNegotiation(currentCtx, play)
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
