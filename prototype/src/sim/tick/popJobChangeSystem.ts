import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId, StateRegionId } from '../types/ids'
import type { PopGroup, PopType, PopStratum } from '../types/popGroup'
import { getPopStratum } from '../types/popGroup'
import type { PopTargetKey, PopMobilitySnapshotEntry, PopMobilityKind } from '../types/popMobility'
import { getHoldingPopTypeRemainingCapacity } from '../selectors/popSelectors'
import {
  computeHoldingPopTypeDemand,
  computePopTypeMoneyQuantiles,
} from '../selectors/popMobilitySelectors'
import { allowedTargetsFor, classifyMobilityKind } from '../config/popMobilityDefinitions'
import { movePopSizeToKeyMut } from '../mutations/popMutations'
import {
  createMonthlyPopMobilitySnapshot,
  ensureByState,
  mergeAndTruncateMovements,
} from './popMobilitySnapshot'
import { isEmployed } from '../types/workplaceRef'

type MoneyQuantiles = ReturnType<typeof computePopTypeMoneyQuantiles>
type HoldingDemand = ReturnType<typeof computeHoldingPopTypeDemand>

// v0.58: POP の per-capita money (money/size)。空集団は 0。昇格/降格 gate の比較値。
function perCapitaMoney(pop: PopGroup): number {
  return pop.size > 0 ? pop.money / pop.size : 0
}

type JobChangeCandidate = {
  source: PopGroup
  target: PopTargetKey
  kind: PopMobilityKind
  maxAmount: number
  moneyCostPerCapita?: number
  // priority keys (§7.5)
  sourceUnemployed: boolean
  shortage: number
}

// v0.56 §7 / v0.59 追補: 同一 holding 内で recipe 労働需要に追随する転職。
//   v0.59 追補で **per-source cap** へ再設計: holding 共有予算 (remainingCap) を廃し、各 source POP が
//   自分の size × kind 別レートまで /月 移動できる (移動先非依存)。移動は雇用と分離し、移動先では
//   **失業として着地**する (employed=false)。雇用は後段 employmentRebalance が職枠＋maxRatio で確定。
//   昇格だけは「社会的余地」として移動先の実効職枠 (consumed 差引後) を gate にする (§判断3)。
export function runPopJobChangeSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const ws: WorldState = {
    ...ctx.state,
    popGroups: { ...ctx.state.popGroups },
    popIndex: { byHolding: { ...ctx.state.popIndex.byHolding } },
    nextPopGroupId: ctx.state.nextPopGroupId,
  }

  // C3: per-capita money 分位を StateRegion 単位で月初に 1 回算出 (mutation 前の state)。
  const quantilesByState = new Map<string, MoneyQuantiles>()
  for (const stateId of Object.keys(ctx.state.states).sort()) {
    quantilesByState.set(stateId, computePopTypeMoneyQuantiles(ctx.state, stateId as StateRegionId))
  }

  // snapshot は jobChange が新規作成し、PopMigrationSystem が read-or-create で引き継ぐ (A3)。
  //   tick 順 (jobChange → migration) が前提。順序が逆転すると migration entry が握り潰される。
  const snapshot = createMonthlyPopMobilitySnapshot(ws.absoluteWeek)
  const entries: PopMobilitySnapshotEntry[] = []
  const minMove = config.popMobilityMinMoveAmount
  const eps = config.popSizeEpsilon

  for (const holdingId of Object.keys(ws.holdings).sort() as HoldingId[]) {
    const holding = ws.holdings[holdingId]
    if (!holding) continue
    const province = ws.provinces[holding.provinceId]
    if (!province) continue
    const stateId = province.stateId
    const quantiles = quantilesByState.get(stateId)

    // demand は holding ごとに月初に 1 回算出 (旧版の per-iteration 再計算を廃止)。
    const demand = computeHoldingPopTypeDemand(ws, config, holdingId)
    // 同月内に複数 source が同 target を昇格先にする oversubscribe 防止 (実効職枠の消費を追跡)。
    const consumedPromotionByType = new Map<PopType, number>()

    // 各 source POP を id 昇順に 1 回ずつ処理する (per-source cap)。
    for (const sourcePid of [...(ws.popIndex.byHolding[holdingId] ?? [])].sort()) {
      const source = ws.popGroups[sourcePid]
      if (!source) continue
      if (source.size - eps < minMove) continue
      // eligibility: 失業 source か、employed かつ surplus がある source のみ。
      const isUnemployed = !isEmployed(source)
      const isSurplus = isEmployed(source) && (demand.surplusByType[source.popType] ?? 0) > 0
      if (!isUnemployed && !isSurplus) continue

      const candidate = bestTargetForSource(
        ws,
        config,
        holdingId,
        source,
        demand,
        quantiles,
        eps,
        minMove,
        consumedPromotionByType,
      )
      if (!candidate) continue

      const amount = candidate.maxAmount
      if (amount < minMove) continue

      const targetId = movePopSizeToKeyMut(ws, candidate.source.id, candidate.target, amount, {
        minSourceSize: eps,
        ...(candidate.moneyCostPerCapita !== undefined
          ? { moneyCostPerCapita: candidate.moneyCostPerCapita }
          : {}),
      })
      if (targetId === undefined) continue // safety: candidate said movable but move was a no-op

      if (candidate.kind === 'promotion') {
        consumedPromotionByType.set(
          candidate.target.popType,
          (consumedPromotionByType.get(candidate.target.popType) ?? 0) + amount,
        )
      }

      entries.push({
        kind: 'job_change',
        amount,
        sourceHoldingId: holdingId,
        targetHoldingId: holdingId,
        fromPopType: candidate.source.popType,
        toPopType: candidate.target.popType,
        fromEmployed: isEmployed(candidate.source),
        toEmployed: false, // v0.59 追補: 移動先では失業着地 (雇用は rebalance が確定)
      })
      snapshot.jobChangedTotal += amount
      ensureByState(snapshot, stateId).jobChanged += amount
    }
  }

  snapshot.topMovements = mergeAndTruncateMovements([], entries, config.popMobilityTopMovementLimit)
  ws.monthlyPopMobility = snapshot
  return { ...ctx, state: ws }
}

// 単一 source POP について、許可 target の中から最良の転職候補を 1 つ選ぶ (per-source)。
function bestTargetForSource(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  source: PopGroup,
  demand: HoldingDemand,
  quantiles: MoneyQuantiles | undefined,
  eps: number,
  minMove: number,
  consumedPromotionByType: Map<PopType, number>,
): JobChangeCandidate | undefined {
  let best: JobChangeCandidate | undefined
  for (const targetPopType of allowedTargetsFor(source.popType)) {
    const kind = classifyMobilityKind(source.popType, targetPopType)
    const cand = evaluateCandidate(
      ws,
      config,
      holdingId,
      source,
      targetPopType,
      kind,
      demand,
      quantiles,
      eps,
      consumedPromotionByType,
    )
    if (!cand || cand.maxAmount < minMove) continue
    if (!best || candidateBetter(cand, best)) best = cand
  }
  return best
}

// §7.5 優先度: unemployed 優先 → shortage 大 → 低 per-capita money → PopGroupId 昇順 → target popType 昇順。
function candidateBetter(a: JobChangeCandidate, b: JobChangeCandidate): boolean {
  if (a.sourceUnemployed !== b.sourceUnemployed) return a.sourceUnemployed
  if (a.shortage !== b.shortage) return a.shortage > b.shortage
  const am = perCapitaMoney(a.source)
  const bm = perCapitaMoney(b.source)
  if (am !== bm) return am < bm
  const ai = a.source.id as string
  const bi = b.source.id as string
  if (ai !== bi) return ai < bi
  return (a.target.popType as string) < (b.target.popType as string)
}

function evaluateCandidate(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  source: PopGroup,
  targetPopType: PopType,
  kind: PopMobilityKind,
  demand: HoldingDemand,
  quantiles: MoneyQuantiles | undefined,
  eps: number,
  consumedPromotionByType: Map<PopType, number>,
): JobChangeCandidate | undefined {
  const targetStratum: PopStratum = getPopStratum(targetPopType)
  const targetShortage = demand.shortageByType[targetPopType] ?? 0
  const sourceSurplus = demand.surplusByType[source.popType] ?? 0
  const rate = config.popJobChangeMonthlyRateByKind[kind]
  const movableBySize = source.size - eps
  const smallUnemployed =
    !isEmployed(source) && source.size <= config.popUnemployedFullConversionSize
  const movableByRate = smallUnemployed ? movableBySize : source.size * rate

  // v0.59 追補: 移動先では常に失業着地 (雇用は rebalance が確定)。cap は source サイズ依存・移動先非依存。
  const make = (maxAmount: number, moneyCostPerCapita?: number): JobChangeCandidate => ({
    source,
    target: { holdingId, class: targetStratum, popType: targetPopType, employerId: null },
    kind,
    maxAmount,
    ...(moneyCostPerCapita !== undefined ? { moneyCostPerCapita } : {}),
    sourceUnemployed: !isEmployed(source),
    shortage: targetShortage,
  })

  if (kind === 'lateral') {
    // 同 stratum 内の職替え。移動先非依存 (capacity gate なし)。shortage を満たす方向のみ。
    if (targetShortage <= 0) return undefined
    if (!(sourceSurplus > 0 || !isEmployed(source))) return undefined
    const maxAmount = Math.min(movableBySize, targetShortage, movableByRate)
    return make(maxAmount)
  }

  if (kind === 'promotion') {
    // §判断3: 昇格は移動先の実効職枠 (consumed 差引後) を必須にする (社会的余地)。
    if (targetShortage <= 0) return undefined
    const q = quantiles?.[source.popType]
    if (!q) return undefined
    // v0.58: per-capita money 上位 (>= p75 かつ median 超) を昇格 gate に。
    const srcMoney = perCapitaMoney(source)
    if (!(srcMoney >= q.p75 && srcMoney > q.median + config.popPromotionEpsilon)) {
      return undefined
    }
    const remainingCap =
      getHoldingPopTypeRemainingCapacity(ws, config, holdingId, targetPopType) -
      (consumedPromotionByType.get(targetPopType) ?? 0)
    if (remainingCap <= 0) return undefined
    // 昇格コストは per-capita money の sink (movePopSizeToKeyMut が移送 money から burn)。
    const moneyCostPerCapita = config.popPromotionWealthCostByTargetStratum[targetStratum] ?? 0
    const maxAmount = Math.min(movableBySize, targetShortage, remainingCap, movableByRate)
    return make(maxAmount, moneyCostPerCapita)
  }

  // demotion (v0.58: per-capita money 下位を gate に)。移動先非依存・失業着地。
  const q = quantiles?.[source.popType]
  const srcMoney = perCapitaMoney(source)
  const demotionWealthOk =
    !isEmployed(source) ||
    (q !== undefined && srcMoney <= q.p25 && srcMoney < q.median - config.popDemotionEpsilon)
  if (!demotionWealthOk) return undefined
  const hasTargetShortage = targetShortage > 0
  if (!(hasTargetShortage || !isEmployed(source))) return undefined

  const shortageTerm = hasTargetShortage ? targetShortage : Infinity
  const maxAmount = Math.min(movableBySize, movableByRate, shortageTerm)
  return make(maxAmount)
}
