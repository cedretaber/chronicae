import { clamp } from '../utils/math'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId, StateRegionId } from '../types/ids'
import type { PopGroup, PopType, PopStratum } from '../types/popGroup'
import { getPopStratum } from '../types/popGroup'
import type { PopTargetKey, PopMobilitySnapshotEntry, PopMobilityKind } from '../types/popMobility'
import {
  getHoldingPopTypeRemainingCapacity,
  getHoldingTotalPopSize,
} from '../selectors/popSelectors'
import {
  computeHoldingPopTypeDemand,
  computePopTypeWealthQuantiles,
} from '../selectors/popMobilitySelectors'
import { allowedTargetsFor, classifyMobilityKind } from '../config/popMobilityDefinitions'
import { movePopSizeToKeyMut } from '../mutations/popMutations'
import {
  createMonthlyPopMobilitySnapshot,
  ensureByState,
  mergeAndTruncateMovements,
} from './popMobilitySnapshot'

type WealthQuantiles = ReturnType<typeof computePopTypeWealthQuantiles>
type HoldingDemand = ReturnType<typeof computeHoldingPopTypeDemand>

type JobChangeCandidate = {
  source: PopGroup
  target: PopTargetKey
  kind: PopMobilityKind
  maxAmount: number
  incomingWealthOverride?: number
  // priority keys (§7.5)
  sourceUnemployed: boolean
  shortage: number
}

// while ループの安全弁 (理論上 remainingCap が単調減少して終了するが、無限ループの backstop)。
const MAX_ITERATIONS_PER_HOLDING = 64

// v0.56 §7: 同一 holding 内で recipe 労働需要に追随する転職。
//   候補優先度方式 (A2) + C1 capacity gate + C3 相対 wealth gate + 人口比 cap (C2)。
export function runPopJobChangeSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const ws: WorldState = {
    ...ctx.state,
    popGroups: { ...ctx.state.popGroups },
    popIndex: { byHolding: { ...ctx.state.popIndex.byHolding } },
    nextPopGroupId: ctx.state.nextPopGroupId,
  }

  // C3: wealth 分位を StateRegion 単位で月初に 1 回算出 (mutation 前の state)。
  const quantilesByState = new Map<string, WealthQuantiles>()
  for (const stateId of Object.keys(ctx.state.states).sort()) {
    quantilesByState.set(
      stateId,
      computePopTypeWealthQuantiles(ctx.state, stateId as StateRegionId),
    )
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

    let remainingCap = Math.min(
      getHoldingTotalPopSize(ws, holdingId) * config.popJobChangeMaxFractionPerHoldingPerMonth,
      config.popJobChangeMaxPerHoldingPerMonthHardCap,
    )

    let guard = 0
    while (remainingCap >= minMove && guard++ < MAX_ITERATIONS_PER_HOLDING) {
      const demand = computeHoldingPopTypeDemand(ws, config, holdingId)
      const candidate = bestJobChangeCandidate(
        ws,
        config,
        holdingId,
        demand,
        quantiles,
        eps,
        minMove,
      )
      if (!candidate) break

      const amount = Math.min(candidate.maxAmount, remainingCap)
      if (amount < minMove) break

      const targetId = movePopSizeToKeyMut(ws, candidate.source.id, candidate.target, amount, {
        minSourceSize: eps,
        ...(candidate.incomingWealthOverride !== undefined
          ? { incomingWealthOverride: candidate.incomingWealthOverride }
          : {}),
      })
      if (targetId === undefined) break // safety: candidate said movable but move was a no-op
      remainingCap -= amount

      entries.push({
        kind: 'job_change',
        amount,
        sourceHoldingId: holdingId,
        targetHoldingId: holdingId,
        fromPopType: candidate.source.popType,
        toPopType: candidate.target.popType,
        fromEmployed: candidate.source.employed,
        toEmployed: candidate.target.employed,
      })
      snapshot.jobChangedTotal += amount
      ensureByState(snapshot, stateId).jobChanged += amount
    }
  }

  snapshot.topMovements = mergeAndTruncateMovements([], entries, config.popMobilityTopMovementLimit)
  ws.monthlyPopMobility = snapshot
  return { ...ctx, state: ws }
}

function bestJobChangeCandidate(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  demand: HoldingDemand,
  quantiles: WealthQuantiles | undefined,
  eps: number,
  minMove: number,
): JobChangeCandidate | undefined {
  const popIds = [...(ws.popIndex.byHolding[holdingId] ?? [])].sort()
  let best: JobChangeCandidate | undefined

  for (const pid of popIds) {
    const source = ws.popGroups[pid]
    if (!source) continue

    const isSurplusSource = source.employed && (demand.surplusByType[source.popType] ?? 0) > 0
    const isUnemployedSource = !source.employed
    if (!isSurplusSource && !isUnemployedSource) continue
    if (source.size - eps < minMove) continue // too small to move the minimum amount

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
      )
      if (!cand || cand.maxAmount < minMove) continue
      if (!best || candidateBetter(cand, best)) best = cand
    }
  }
  return best
}

// §7.5 優先度: unemployed 優先 → shortage 大 → 低 wealth → PopGroupId 昇順 → target popType 昇順。
function candidateBetter(a: JobChangeCandidate, b: JobChangeCandidate): boolean {
  if (a.sourceUnemployed !== b.sourceUnemployed) return a.sourceUnemployed
  if (a.shortage !== b.shortage) return a.shortage > b.shortage
  if (a.source.wealth !== b.source.wealth) return a.source.wealth < b.source.wealth
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
  quantiles: WealthQuantiles | undefined,
  eps: number,
): JobChangeCandidate | undefined {
  const targetStratum: PopStratum = getPopStratum(targetPopType)
  const targetShortage = demand.shortageByType[targetPopType] ?? 0
  const sourceSurplus = demand.surplusByType[source.popType] ?? 0
  const rate = config.popJobChangeMonthlyRateByKind[kind]
  const movableBySize = source.size - eps
  const movableByRate = source.size * rate

  const make = (
    targetEmployed: boolean,
    maxAmount: number,
    incomingWealthOverride?: number,
  ): JobChangeCandidate => ({
    source,
    target: { holdingId, class: targetStratum, popType: targetPopType, employed: targetEmployed },
    kind,
    maxAmount,
    ...(incomingWealthOverride !== undefined ? { incomingWealthOverride } : {}),
    sourceUnemployed: !source.employed,
    shortage: targetShortage,
  })

  if (kind === 'lateral') {
    if (targetShortage <= 0) return undefined
    if (!(sourceSurplus > 0 || !source.employed)) return undefined
    const increasesHeadcount = !source.employed // same stratum, target employed → only unemployed→employed grows headcount
    const remainingCap = increasesHeadcount
      ? getHoldingPopTypeRemainingCapacity(ws, config, holdingId, targetPopType)
      : Infinity
    if (increasesHeadcount && remainingCap <= 0) return undefined
    const maxAmount = Math.min(movableBySize, targetShortage, remainingCap, movableByRate)
    return make(true, maxAmount)
  }

  if (kind === 'promotion') {
    if (targetShortage <= 0) return undefined
    const q = quantiles?.[source.popType]
    if (!q) return undefined
    if (!(source.wealth >= q.p75 && source.wealth > q.median + config.popPromotionEpsilon)) {
      return undefined
    }
    const remainingCap = getHoldingPopTypeRemainingCapacity(ws, config, holdingId, targetPopType)
    if (remainingCap <= 0) return undefined
    const cost = config.popPromotionWealthCostByTargetStratum[targetStratum] ?? 0
    const incomingWealthOverride = clamp(source.wealth - cost, 0, 100)
    const maxAmount = Math.min(movableBySize, targetShortage, remainingCap, movableByRate)
    return make(true, maxAmount, incomingWealthOverride)
  }

  // demotion
  const q = quantiles?.[source.popType]
  const demotionWealthOk =
    !source.employed ||
    (q !== undefined &&
      source.wealth <= q.p25 &&
      source.wealth < q.median - config.popDemotionEpsilon)
  if (!demotionWealthOk) return undefined
  const hasTargetShortage = targetShortage > 0
  if (!(hasTargetShortage || !source.employed)) return undefined

  // §7.9 A5: employed source + 雇用余地 → employed; それ以外 → unemployed。
  let targetEmployed = false
  let remainingCap = Infinity
  if (source.employed) {
    remainingCap = getHoldingPopTypeRemainingCapacity(ws, config, holdingId, targetPopType)
    targetEmployed = remainingCap > 0
  }
  const increasesHeadcount = targetEmployed // cross-stratum + employed target
  const capTerm = increasesHeadcount ? remainingCap : Infinity
  const shortageTerm = hasTargetShortage ? targetShortage : Infinity
  const maxAmount = Math.min(movableBySize, movableByRate, shortageTerm, capTerm)
  return make(targetEmployed, maxAmount)
}
