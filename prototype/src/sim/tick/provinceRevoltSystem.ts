import type { TickContext } from './context'
import { makeEventId } from './context'
import { clamp } from '../utils/math'
import { randomFloat, type RngState } from '../rng/rng'
import type { ProvinceId, PolityId, PopGroupId } from '../types/ids'
import { createDiplomaticPlayId } from '../types/ids'
import type { PopClass, PopGroup } from '../types/popGroup'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import { getProvincePopulationPressure, getPopWealthByClass } from '../selectors/popSelectors'
import { getProvinceProduction } from '../selectors/popEconomySelectors'
import {
  getProvinceManpowerBase,
  getProvinceHouseManpowerBase,
} from '../selectors/popEconomySelectors'
import { adjustProvincePopUnrestByClass } from '../mutations/popMutations'
import { getAttitudeOrDefault, attitudeValueToScore } from '../helpers/attitudeHelpers'
import { getPolityLegitimacy, getPolityStability } from '../selectors/statusSelectors'
import {
  getProvinceTerminalPolityId,
  getProvinceEffectiveOwnerHouseId,
} from '../selectors/landContractSelectors'
import { createRebelPolity } from '../mutations/worldStructureMutations'

// v0.18 Stage B §14: ProvinceRevoltSystem
// 即時成否 roll を廃止し、発火後は Rebel commonwealth Polity を生成 + revolt_negotiation
// DiplomaticPlay を作成する。妥協 / 鎮圧 / 独立の判定は diplomaticPlaySystem が担当する。
//
// v0.16 から保持: revoltTendency 計算と candidate 収集
// v0.18 Stage B: 成否判定を Play 経路に移譲

type RevoltCandidate = {
  provinceId: ProvinceId
  rebelClass: PopClass
  revoltTendency: number
}

function calcRevoltTendency(
  ctx: TickContext,
  provinceId: ProvinceId,
  rebelClass: PopClass,
): number {
  const state = ctx.state
  const config = ctx.config

  const province = state.provinces[provinceId]
  if (!province) return 0

  const terminalPolityId = getProvinceTerminalPolityId(state, provinceId)
  if (!terminalPolityId) return 0
  const polity = state.polities[terminalPolityId]
  if (!polity) return 0

  const ownerHouseId = getProvinceEffectiveOwnerHouseId(state, provinceId)
  if (!ownerHouseId) return 0
  const ownerHouse = state.houses[ownerHouseId]
  if (!ownerHouse) return 0

  const pop = (() => {
    for (const popId of province.popGroupIds) {
      const p = state.popGroups[popId]
      if (p && p.class === rebelClass) return p
    }
    return undefined
  })()
  if (!pop) return 0

  // v0.16: houseControl は廃止。lowHouseControl 因子は polityControl で代用 (係数は流用)
  let tendency =
    pop.unrest * config.provinceRevoltUnrestFactor +
    (100 - province.polityControl) * config.provinceRevoltLowHouseControlFactor +
    (100 - province.polityControl) * config.provinceRevoltLowCountryControlFactor -
    getPolityStability(state, config, terminalPolityId) *
      config.provinceRevoltStabilitySuppressionFactor

  if (rebelClass === 'peasants') {
    if (pop.wealth < config.povertyWealthThreshold) {
      tendency += (config.povertyWealthThreshold - pop.wealth) * config.peasantRevoltPovertyFactor
    }
    tendency +=
      getProvincePopulationPressure(state, config, provinceId) * config.peasantRevoltPressureFactor
  } else if (rebelClass === 'townsmen') {
    const townsmenWealth = getPopWealthByClass(state, provinceId, 'townsmen')
    if (townsmenWealth < config.overExtractionWealthSafeThreshold) {
      tendency += config.townsmenRevoltExtractionFactor
      tendency +=
        Math.log1p(getProvinceProduction(state, config, provinceId)) *
        config.townsmenRevoltProductionFactor
    }
  } else if (rebelClass === 'nobles') {
    const a_house = getAttitudeOrDefault(state, pop, { kind: 'house', id: ownerHouseId })
    const a_polity = getAttitudeOrDefault(state, pop, { kind: 'polity', id: terminalPolityId })
    const houseScore =
      attitudeValueToScore(a_house.affection) * 0.6 + attitudeValueToScore(a_house.respect) * 0.4
    const polityScore =
      attitudeValueToScore(a_polity.affection) * 0.6 + attitudeValueToScore(a_polity.respect) * 0.4
    const nobleDisloyalty = 100 - (0.5 * houseScore + 0.5 * polityScore)
    tendency += nobleDisloyalty * config.nobleRevoltHouseDisloyaltyFactor
    tendency +=
      (100 - getPolityLegitimacy(state, terminalPolityId)) * config.nobleRevoltLowLegitimacyFactor
  }

  return tendency
}

function collectCandidates(ctx: TickContext): RevoltCandidate[] {
  const candidates: RevoltCandidate[] = []
  const config = ctx.config

  for (const provinceIdStr of Object.keys(ctx.state.provinces).sort()) {
    const provinceId = provinceIdStr as ProvinceId
    const province = ctx.state.provinces[provinceId]
    if (!province) continue
    const terminalPolityId = getProvinceTerminalPolityId(ctx.state, provinceId)
    if (!terminalPolityId) continue
    const polity = ctx.state.polities[terminalPolityId]
    if (!polity || !polity.active) continue
    // v0.18 Stage B: commonwealth Polity が支配する Province は新たな revolt の対象外
    // (Rebel commonwealth 自体に対する叛乱は Stage B では扱わない)
    if (polity.kind === 'commonwealth') continue
    const ownerHouseId = getProvinceEffectiveOwnerHouseId(ctx.state, provinceId)
    if (!ownerHouseId) continue
    const ownerHouse = ctx.state.houses[ownerHouseId]
    if (!ownerHouse || !ownerHouse.active) continue

    const classes: PopClass[] = ['peasants', 'townsmen', 'nobles']
    let bestClass: PopClass | undefined
    let bestTendency = -Infinity

    for (const cls of classes) {
      const tendency = calcRevoltTendency(ctx, provinceId, cls)
      if (tendency > bestTendency) {
        bestTendency = tendency
        bestClass = cls
      }
    }

    if (bestClass === undefined || bestTendency < config.provinceRevoltThreshold) continue

    candidates.push({
      provinceId,
      rebelClass: bestClass,
      revoltTendency: bestTendency,
    })
  }

  return candidates
}

function findPopByClass(
  state: WorldState,
  provinceId: ProvinceId,
  cls: PopClass,
): PopGroup | undefined {
  const province = state.provinces[provinceId]
  if (!province) return undefined
  for (const popId of province.popGroupIds) {
    const p = state.popGroups[popId]
    if (p && p.class === cls) return p
  }
  return undefined
}

// v0.18 Stage B §13.3: revolt conflict 解決
// `revolt_negotiation` が決裂した場合に呼ばれる。pop.size + unrest と target polity の
// suppression power を比較して勝敗を決める。spec §13.3 の式を実装。
export type RevoltConflictResult = {
  rebelWins: boolean
  rebelPower: number
  suppressionPower: number
  successChance: number
}

export function resolveRevoltConflict(
  state: WorldState,
  config: SimulationConfig,
  rng: RngState,
  input: {
    provinceId: ProvinceId
    popGroupId: PopGroupId
    targetPolityId: PolityId
  },
): { result: RevoltConflictResult; rng: RngState } {
  const pop = state.popGroups[input.popGroupId]
  const targetPolity = state.polities[input.targetPolityId]
  const province = state.provinces[input.provinceId]
  if (!pop || !targetPolity || !province) {
    return {
      result: { rebelWins: false, rebelPower: 0, suppressionPower: 1, successChance: 0 },
      rng,
    }
  }

  const rebelPower =
    pop.size * config.popRevoltPowerFactorByClass[pop.class] * (0.5 + pop.unrest / 100)

  const polityManpower = getProvinceManpowerBase(state, config, input.provinceId)
  let suppressionPower =
    polityManpower * config.provinceRevoltCountrySuppressionFactor +
    Math.log1p(targetPolity.treasury) * config.provinceRevoltTreasurySuppressionFactor

  const targetOwnerHouseId = targetPolity.ownerHouseId
  if (targetOwnerHouseId !== undefined) {
    const targetOwnerHouse = state.houses[targetOwnerHouseId]
    if (targetOwnerHouse) {
      const houseManpower = getProvinceHouseManpowerBase(state, config, input.provinceId)
      suppressionPower += houseManpower * config.provinceRevoltHouseSuppressionFactor
      suppressionPower +=
        Math.log1p(targetOwnerHouse.wealth) * config.provinceRevoltHouseWealthSuppressionFactor
    }
  }

  const successChance = rebelPower / (rebelPower + suppressionPower + 1)
  const { value: roll, rng: nextRng } = randomFloat(rng)
  return {
    result: {
      rebelWins: roll < successChance,
      rebelPower,
      suppressionPower,
      successChance,
    },
    rng: nextRng,
  }
}

// v0.18 Stage B §14.2: 発火後の処理を「revolt_negotiation Play 生成」に置き換えた版
function resolveRevolt(ctx: TickContext, candidate: RevoltCandidate): TickContext {
  const { provinceId, rebelClass, revoltTendency } = candidate
  const config = ctx.config

  const province = ctx.state.provinces[provinceId]
  if (!province) return ctx
  const terminalPolityId = getProvinceTerminalPolityId(ctx.state, provinceId)
  if (!terminalPolityId) return ctx
  const polity = ctx.state.polities[terminalPolityId]
  if (!polity || !polity.active) return ctx
  const ownerHouseId = getProvinceEffectiveOwnerHouseId(ctx.state, provinceId)
  if (!ownerHouseId) return ctx

  const revoltChance = clamp(
    revoltTendency / config.provinceRevoltChanceDivisor,
    0,
    config.provinceRevoltMaxChance,
  )

  // 発火 roll (このまま維持)
  const { value: roll1, rng: rng1 } = randomFloat(ctx.rng)
  ctx = { ...ctx, rng: rng1 }
  if (roll1 >= revoltChance) return ctx

  // 反乱 PopGroup を特定 (Play.primaryDemand.popGroupId の source of truth)
  const pop = findPopByClass(ctx.state, provinceId, rebelClass)
  if (!pop) return ctx

  // Rebel commonwealth 生成 (LandContract grantee も内部で差し替え済み)
  const createResult = createRebelPolity(ctx, {
    provinceId,
    rebelClass,
    oldPolityId: terminalPolityId,
  })
  if (!createResult.ok) return ctx
  let nextCtx = createResult.value.ctx
  const { polityId: rebelPolityId, personId: rebelLeaderId } = createResult.value.value

  // Province polityControl をリセット (Rebel commonwealth が物理支配)
  const provinceAfter = nextCtx.state.provinces[provinceId]
  if (provinceAfter) {
    nextCtx = {
      ...nextCtx,
      state: {
        ...nextCtx.state,
        provinces: {
          ...nextCtx.state.provinces,
          [provinceId]: {
            ...provinceAfter,
            polityControl: config.provinceRevoltNewCountryControl,
          },
        },
      },
    }
  }

  // 叛乱 PopGroup の unrest を一時的に解放 (-50)
  // Play 妥協/鎮圧時にさらに減らされる
  const unrestReducedState = adjustProvincePopUnrestByClass(
    nextCtx.state,
    provinceId,
    rebelClass,
    -50,
  )
  nextCtx = { ...nextCtx, state: unrestReducedState }

  // revolt_negotiation DiplomaticPlay を生成
  const playId = createDiplomaticPlayId(nextCtx.state.nextDiplomaticPlayId)
  const deadlineWeek = nextCtx.state.absoluteWeek + config.revoltNegotiationDurationWeeks
  const play: DiplomaticPlay = {
    id: playId,
    kind: 'revolt_negotiation',
    initiator: { kind: 'polity', id: rebelPolityId },
    target: { kind: 'polity', id: terminalPolityId },
    primaryDemand: {
      kind: 'revolt_concession',
      provinceId,
      popGroupId: pop.id,
      concessionLevel: 'minor',
    },
    status: 'active',
    startedWeek: nextCtx.state.absoluteWeek,
    deadlineWeek,
    progress: 0,
    tension: 0,
  }
  nextCtx = {
    ...nextCtx,
    state: {
      ...nextCtx.state,
      diplomaticPlays: {
        ...nextCtx.state.diplomaticPlays,
        [playId]: play,
      },
      nextDiplomaticPlayId: nextCtx.state.nextDiplomaticPlayId + 1,
    },
  }

  // REVOLT_NEGOTIATION_STARTED event (旧 PROVINCE_REVOLT_STARTED の置換)
  const { id: startEventId, ctx: ctxStart } = makeEventId(nextCtx)
  const startEvent: SimEvent = {
    id: startEventId,
    year: ctxStart.state.currentYear,
    weekOfYear: ctxStart.state.currentWeekOfYear,
    type: 'REVOLT_NEGOTIATION_STARTED',
    importance: 'major',
    actorIds: [rebelLeaderId],
    houseIds: [ownerHouseId],
    polityIds: [rebelPolityId, terminalPolityId],
    provinceIds: [provinceId],
    summary: `A ${rebelClass} revolt has broken out in ${province.name} — negotiations begin.`,
    reasons: [],
    effects: [],
  }
  return { ...ctxStart, events: [...ctxStart.events, startEvent] }
}

export function runProvinceRevoltSystem(ctx: TickContext): TickContext {
  const candidates = collectCandidates(ctx).sort((a, b) => b.revoltTendency - a.revoltTendency)
  // Limit to top 3 per year to avoid mass chaos
  const limit = Math.min(3, candidates.length)

  let currentCtx = ctx
  for (let i = 0; i < limit; i++) {
    const c = candidates[i]
    if (!c) break
    currentCtx = resolveRevolt(currentCtx, c)
  }
  return currentCtx
}
