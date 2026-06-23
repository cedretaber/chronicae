import { clamp } from '../utils/math'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId, PolityId } from '../types/ids'
import type { PopGroup, PopType, PopStratum } from '../types/popGroup'
import { POP_STRATA, POP_TYPES } from '../types/popGroup'
import type { PopMobilitySnapshotEntry } from '../types/popMobility'
import {
  getHoldingAllPopTypeCapacities,
  getHoldingEmployedPopSizeByType,
  getHoldingTotalPopSize,
} from '../selectors/popSelectors'
import { getHoldingTerminalPolityId } from '../selectors/landContractSelectors'
import { computeHoldingPopTypeDemand } from '../selectors/popMobilitySelectors'
import { movePopSizeToKeyMut } from '../mutations/popMutations'
import {
  createMonthlyPopMobilitySnapshot,
  ensureByState,
  mergeAndTruncateMovements,
} from './popMobilitySnapshot'
import { accrueMigrationInPopChangeMut, accrueMigrationOutPopChangeMut } from './popChangeSnapshot'

type HoldingDemand = ReturnType<typeof computeHoldingPopTypeDemand>

// §8.7 opportunity score の重み (formula 定数。config には出さない)。
const W_VACANCY = 45
const W_POP_TYPE_DEMAND = 25
const W_TARGET_PROSPERITY = 15 // v0.58: 移住先の welfare(needSatisfaction) で加点
const W_LOW_UNREST = 15
// §8.5 pressure 係数。
const PRESSURE_UNEMPLOYED = 40
// v0.58: 移住圧は welfare(needSatisfaction) 低下で上昇 (wealth から移行)。
const PRESSURE_SAT_REF = 50
const PRESSURE_SAT_COEF = 0.6
const PRESSURE_UNREST_COEF = 0.3
const PRESSURE_CONGESTION_COEF = 30
const SHARE_EPS = 1e-9

// 月初に固定する holding 単位の集計 (A1: demand/needSatisfaction/unrest は month-start cache)。
//   capacity ceiling は構造由来で月内不変なので cache し、remaining は cache − live employed で求める。
type HoldingMigrationCache = {
  demand: HoldingDemand
  capacityByType: Partial<Record<PopType, number>>
  avgNeedSatByPopType: Map<PopType, number>
  avgNeedSatByStratum: Partial<Record<PopStratum, number>>
  avgUnrest: number
  congestion: number
  terminalPolity: PolityId | undefined
}

// v0.56 §8: 同一 StateRegion 内で条件の良い holding へ少しずつ移住する。
export function runPopMigrationSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const ws: WorldState = {
    ...ctx.state,
    popGroups: { ...ctx.state.popGroups },
    popIndex: { byHolding: { ...ctx.state.popIndex.byHolding } },
    nextPopGroupId: ctx.state.nextPopGroupId,
  }

  const minMove = config.popMobilityMinMoveAmount
  const eps = config.popSizeEpsilon

  // 月初 cache を全 holding 分構築 (mutation 前の state)。
  const cacheByHolding = new Map<string, HoldingMigrationCache>()
  for (const holdingId of Object.keys(ctx.state.holdings) as HoldingId[]) {
    cacheByHolding.set(holdingId, buildHoldingCache(ctx.state, config, holdingId))
  }

  // jobChange が書いた snapshot を引き継ぎ migration entry を足す (A3)。無ければ新規。
  const snapshot = ws.monthlyPopMobility ?? createMonthlyPopMobilitySnapshot(ws.absoluteWeek)
  const migrationEntries: PopMobilitySnapshotEntry[] = []

  for (const stateId of Object.keys(ctx.state.states).sort()) {
    const region = ctx.state.states[stateId as keyof typeof ctx.state.states]
    if (!region) continue
    const holdingIds: HoldingId[] = []
    for (const provinceId of region.provinceIds) {
      const province = ws.provinces[provinceId]
      if (!province) continue
      for (const hid of province.holdingIds) holdingIds.push(hid)
    }
    holdingIds.sort()
    if (holdingIds.length < 2) continue

    const outflowCap = new Map<string, number>()
    const inflowCap = new Map<string, number>()
    for (const hid of holdingIds) {
      const totalPop = getHoldingTotalPopSize(ws, hid)
      outflowCap.set(
        hid,
        Math.min(
          totalPop * config.popMigrationMaxOutflowFractionPerHoldingPerMonth,
          config.popMigrationMaxOutflowPerHoldingPerMonthHardCap,
        ),
      )
      inflowCap.set(
        hid,
        Math.min(
          totalPop * config.popMigrationMaxInflowFractionPerHoldingPerMonth,
          config.popMigrationMaxInflowPerHoldingPerMonthHardCap,
        ),
      )
    }

    for (const sourceHoldingId of holdingIds) {
      const sourceCache = cacheByHolding.get(sourceHoldingId)
      if (!sourceCache) continue

      for (const sourcePid of [...(ws.popIndex.byHolding[sourceHoldingId] ?? [])].sort()) {
        if ((outflowCap.get(sourceHoldingId) ?? 0) < minMove) break
        const source = ws.popGroups[sourcePid]
        if (!source) continue
        if (source.size - eps < minMove) continue

        const pressure = computeMigrationPressure(source, sourceCache)
        if (pressure < config.popMigrationPressureThreshold) continue

        const sourcePolity = sourceCache.terminalPolity
        const stayRemaining = remainingCapacity(sourceCache, ws, sourceHoldingId, source.popType)
        const sourceScore = opportunityScore(
          config,
          source,
          sourceHoldingId,
          sourcePolity,
          cacheByHolding,
          stayRemaining,
        )

        // 最良 target を探す (空き capacity / inflow cap がある同一 region 内 holding)。
        let bestHolding: HoldingId | undefined
        let bestScore = -Infinity
        let bestRemaining = 0
        for (const targetHoldingId of holdingIds) {
          if (targetHoldingId === sourceHoldingId) continue
          if ((inflowCap.get(targetHoldingId) ?? 0) < minMove) continue
          const targetCache = cacheByHolding.get(targetHoldingId)
          if (!targetCache) continue
          const remaining = remainingCapacity(targetCache, ws, targetHoldingId, source.popType)
          if (remaining <= 0) continue
          const score = opportunityScore(
            config,
            source,
            targetHoldingId,
            sourcePolity,
            cacheByHolding,
            remaining,
          )
          if (
            score > bestScore ||
            (score === bestScore &&
              bestHolding !== undefined &&
              (targetHoldingId as string) < (bestHolding as string))
          ) {
            bestScore = score
            bestHolding = targetHoldingId
            bestRemaining = remaining
          }
        }

        if (bestHolding === undefined) continue
        if (bestScore <= sourceScore + config.popMigrationScoreGapThreshold) continue

        const rate = config.popMigrationMonthlyRateByStratum[source.class]
        const amount = Math.min(
          source.size - eps,
          bestRemaining,
          source.size * rate,
          outflowCap.get(sourceHoldingId) ?? 0,
          inflowCap.get(bestHolding) ?? 0,
        )
        if (amount < minMove) continue

        const sizeBefore = source.size
        const moved = movePopSizeToKeyMut(
          ws,
          source.id,
          {
            holdingId: bestHolding,
            class: source.class,
            popType: source.popType,
            employed: true,
          },
          amount,
          { minSourceSize: eps },
        )
        if (moved === undefined) continue

        outflowCap.set(sourceHoldingId, (outflowCap.get(sourceHoldingId) ?? 0) - amount)
        inflowCap.set(bestHolding, (inflowCap.get(bestHolding) ?? 0) - amount)

        // v0.59: 移住を人口変動 read-model に累積。movePopSizeToKeyMut は source 残量が sliver
        //   (<= eps) になる場合 source を丸ごと移すため、実移動量は要求 amount を eps だけ超えうる。
        //   holding 合計 = natural + 流入 − 流出 を厳密に保つため、source の size 差分 (= 実移動量)
        //   で累積する。流出は source pop の key、流入は target key (target は常に employed:true)。
        const actualMoved = sizeBefore - (ws.popGroups[source.id]?.size ?? 0)
        accrueMigrationOutPopChangeMut(
          ws,
          sourceHoldingId,
          source.class,
          source.popType,
          source.employed,
          actualMoved,
        )
        accrueMigrationInPopChangeMut(
          ws,
          bestHolding,
          source.class,
          source.popType,
          true,
          actualMoved,
        )

        migrationEntries.push({
          kind: 'migration',
          amount,
          sourceHoldingId,
          targetHoldingId: bestHolding,
          fromPopType: source.popType,
          toPopType: source.popType,
          fromEmployed: source.employed,
          toEmployed: true,
        })
        snapshot.migratedTotal += amount
        // 同一 StateRegion 内移動だが将来拡張のため source/target 両方を記録 (§8.12)。
        ensureByState(snapshot, region.id).migratedOut += amount
        ensureByState(snapshot, region.id).migratedIn += amount
      }
    }
  }

  snapshot.topMovements = mergeAndTruncateMovements(
    snapshot.topMovements,
    migrationEntries,
    config.popMobilityTopMovementLimit,
  )
  ws.monthlyPopMobility = snapshot
  return { ...ctx, state: ws }
}

function computeMigrationPressure(pop: PopGroup, cache: HoldingMigrationCache): number {
  return (
    (pop.employed ? 0 : PRESSURE_UNEMPLOYED) +
    Math.max(0, PRESSURE_SAT_REF - pop.needSatisfaction) * PRESSURE_SAT_COEF +
    pop.unrest * PRESSURE_UNREST_COEF +
    Math.max(0, cache.congestion - 1.0) * PRESSURE_CONGESTION_COEF
  )
}

function opportunityScore(
  config: SimulationConfig,
  source: PopGroup,
  targetHoldingId: HoldingId,
  sourcePolity: PolityId | undefined,
  cacheByHolding: Map<string, HoldingMigrationCache>,
  liveRemaining: number,
): number {
  const cache = cacheByHolding.get(targetHoldingId)
  if (!cache) return -Infinity

  const capacity = cache.capacityByType[source.popType] ?? 0
  const stratumVacancyScore = clamp(liveRemaining / Math.max(1, capacity), 0, 1)

  // B2: 構成ミスマッチ (vacancy ではなく理想構成からのズレ)。idealShare/currentShare とも
  //   holding 全体で正規化する (v0.57.1: stratum 内正規化を廃止。移動の判断を Class 単位に統一)。
  const demand = cache.demand
  const idealShare = demand.idealShareByType[source.popType] ?? 0
  let totalCurrent = 0
  for (const t of POP_TYPES) totalCurrent += demand.currentEmployedByType[t] ?? 0
  const currentShare =
    totalCurrent > 0 ? (demand.currentEmployedByType[source.popType] ?? 0) / totalCurrent : 0
  const popTypeDemandScore = clamp(
    Math.max(0, idealShare - currentShare) / Math.max(idealShare, SHARE_EPS),
    0,
    1,
  )

  // v0.58: 移住先の魅力は welfare(needSatisfaction 0..100) で評価 (wealth から移行)。
  const sByType = cache.avgNeedSatByPopType.get(source.popType)
  const sByStratum = cache.avgNeedSatByStratum[source.class]
  const targetProsperityScore =
    sByType !== undefined
      ? clamp(sByType / 100, 0, 1)
      : sByStratum !== undefined
        ? clamp(sByStratum / 100, 0, 1)
        : 0.5

  const lowUnrestScore = clamp(1 - cache.avgUnrest / 100, 0, 1)
  const crossPolityPenalty =
    cache.terminalPolity !== sourcePolity ? config.popMigrationCrossPolityScorePenalty : 0

  return (
    stratumVacancyScore * W_VACANCY +
    popTypeDemandScore * W_POP_TYPE_DEMAND +
    targetProsperityScore * W_TARGET_PROSPERITY +
    lowUnrestScore * W_LOW_UNREST -
    crossPolityPenalty
  )
}

function buildHoldingCache(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): HoldingMigrationCache {
  const demand = computeHoldingPopTypeDemand(state, config, holdingId)

  // v0.58: size 加重平均 needSatisfaction (popType 別・stratum 別) と平均 unrest。
  const satSumByType = new Map<PopType, number>()
  const sizeByType = new Map<PopType, number>()
  const satSumByStratum: Record<PopStratum, number> = { lower: 0, middle: 0, upper: 0 }
  const sizeByStratum: Record<PopStratum, number> = { lower: 0, middle: 0, upper: 0 }
  let unrestSum = 0
  let totalSize = 0
  for (const pid of state.popIndex.byHolding[holdingId] ?? []) {
    const p = state.popGroups[pid]
    if (!p) continue
    satSumByType.set(p.popType, (satSumByType.get(p.popType) ?? 0) + p.needSatisfaction * p.size)
    sizeByType.set(p.popType, (sizeByType.get(p.popType) ?? 0) + p.size)
    satSumByStratum[p.class] += p.needSatisfaction * p.size
    sizeByStratum[p.class] += p.size
    unrestSum += p.unrest * p.size
    totalSize += p.size
  }
  const avgNeedSatByPopType = new Map<PopType, number>()
  for (const [t, sz] of sizeByType) {
    if (sz > 0) avgNeedSatByPopType.set(t, (satSumByType.get(t) ?? 0) / sz)
  }
  const avgNeedSatByStratum: Partial<Record<PopStratum, number>> = {}
  for (const stratum of POP_STRATA) {
    if (sizeByStratum[stratum] > 0) {
      avgNeedSatByStratum[stratum] = satSumByStratum[stratum] / sizeByStratum[stratum]
    }
  }
  const avgUnrest = totalSize > 0 ? unrestSum / totalSize : 0

  // capacity ceiling は構造由来で月内不変。1 回算出して cache し、congestion にも流用する。
  const capacityByType = getHoldingAllPopTypeCapacities(state, config, holdingId)
  let totalCapacity = 0
  for (const t of Object.keys(capacityByType) as PopType[]) totalCapacity += capacityByType[t] ?? 0
  const congestion = totalSize / Math.max(1, totalCapacity)

  return {
    demand,
    capacityByType,
    avgNeedSatByPopType,
    avgNeedSatByStratum,
    avgUnrest,
    congestion,
    terminalPolity: getHoldingTerminalPolityId(state, holdingId),
  }
}

// 月内不変の cache 済 capacity ceiling − live employed = 現在の残 capacity (heavy な再算出を回避)。
function remainingCapacity(
  cache: HoldingMigrationCache,
  ws: WorldState,
  holdingId: HoldingId,
  popType: PopType,
): number {
  return Math.max(
    0,
    (cache.capacityByType[popType] ?? 0) - getHoldingEmployedPopSizeByType(ws, holdingId, popType),
  )
}
