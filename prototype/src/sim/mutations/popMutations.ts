import { clamp } from '../utils/math'
import type { WorldState } from '../types/world'
import type { ProvinceId, PopGroupId, HoldingId } from '../types/ids'
import type { PopClass, PopGroup, PopType } from '../types/popGroup'
import { getPopStratum } from '../types/popGroup'
import type { PopTargetKey } from '../types/popMobility'
import type { AttitudeMap } from '../types/attitude'
import { createPopGroupId } from '../types/ids'

// v0.56: mobility helper の source 下限 default。config.popSizeEpsilon と一致させる
//   (popMutations は config 非依存のため literal。systems は options.minSourceSize で明示渡し)。
const POP_MOBILITY_SOURCE_FLOOR_DEFAULT = 0.01

// v0.58: 特定 class の POP の welfare(needSatisfaction) を delta だけ動かす (clamp 0..100)。
export function adjustProvincePopNeedSatisfactionByClass(
  state: WorldState,
  provinceId: ProvinceId,
  popClass: PopClass,
  delta: number,
): WorldState {
  const province = state.provinces[provinceId]
  if (!province) return state

  let newPopGroups: typeof state.popGroups | undefined
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popGroupId of popIds) {
      const pop = state.popGroups[popGroupId]
      if (!pop || pop.class !== popClass) continue
      const newSat = clamp(pop.needSatisfaction + delta, 0, 100)
      if (newSat === pop.needSatisfaction) continue
      if (!newPopGroups) {
        newPopGroups = { ...state.popGroups }
      }
      newPopGroups[popGroupId] = { ...pop, needSatisfaction: newSat }
    }
  }

  if (!newPopGroups) return state

  return { ...state, popGroups: newPopGroups }
}

// Adjust unrest of pops of a specific class in a province by delta (clamped 0..100)
export function adjustProvincePopUnrestByClass(
  state: WorldState,
  provinceId: ProvinceId,
  popClass: PopClass,
  delta: number,
): WorldState {
  const province = state.provinces[provinceId]
  if (!province) return state

  let newPopGroups: typeof state.popGroups | undefined
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popGroupId of popIds) {
      const pop = state.popGroups[popGroupId]
      if (!pop || pop.class !== popClass) continue
      const newUnrest = clamp(pop.unrest + delta, 0, 100)
      if (newUnrest === pop.unrest) continue
      if (!newPopGroups) {
        newPopGroups = { ...state.popGroups }
      }
      newPopGroups[popGroupId] = { ...pop, unrest: newUnrest }
    }
  }

  if (!newPopGroups) return state

  return { ...state, popGroups: newPopGroups }
}

// Apply per-pop PROPORTIONAL size damage to pops in a province (optionally
// filtered by class). Each matching pop loses `pop.size * rate` from its OWN
// size — distinct from the flat-fan-out `adjustProvincePopSize*` family above,
// which apply the same absolute delta to every pop. Calling those once per pop
// (as disasterSystem historically did) multiplies total damage by the pop count
// (調査 §1.1: standard preset の holdingsPerProvince=4 で常時 4x 過剰適用).
// `rate` is a fraction in [0, 1]. The subtraction form keeps this bit-identical
// to the old single-pop path (`a + (-(a*r))` === `a - a*r`).
export function reduceProvincePopSizeProportional(
  state: WorldState,
  provinceId: ProvinceId,
  rate: number,
  popClass?: PopClass,
): WorldState {
  const province = state.provinces[provinceId]
  if (!province) return state

  let newPopGroups: typeof state.popGroups | undefined
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popGroupId of popIds) {
      const pop = state.popGroups[popGroupId]
      if (!pop) continue
      if (popClass !== undefined && pop.class !== popClass) continue
      const newSize = Math.max(0, pop.size - pop.size * rate)
      if (newSize === pop.size) continue
      if (!newPopGroups) {
        newPopGroups = { ...state.popGroups }
      }
      // v0.58: money は extensive → 死亡 (size 減) は per-capita 保存のため比例 burn
      //   (popSystem の自然死亡と同じ規約。これを怠ると crisis 死で生存者の per-capita money が膨らむ)。
      newPopGroups[popGroupId] = {
        ...pop,
        size: newSize,
        money: pop.size > 0 ? pop.money * (newSize / pop.size) : pop.money,
      }
    }
  }

  if (!newPopGroups) return state

  return { ...state, popGroups: newPopGroups }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeAttitudesWeightedBySize(
  pops: { attitudes: AttitudeMap; size: number }[],
): AttitudeMap {
  const totalSize = pops.reduce((sum, p) => sum + p.size, 0)
  if (totalSize <= 0) return {}

  const allKeys = new Set(pops.flatMap((p) => Object.keys(p.attitudes)))
  const merged: AttitudeMap = {}

  for (const key of allKeys) {
    let weightedAffection = 0
    let weightedRespect = 0
    for (const pop of pops) {
      const att = pop.attitudes[key]
      if (att) {
        weightedAffection += att.affection * pop.size
        weightedRespect += att.respect * pop.size
      }
    }
    merged[key] = {
      affection: weightedAffection / totalSize,
      respect: weightedRespect / totalSize,
    }
  }

  return merged
}

// ---------------------------------------------------------------------------
// Mutable mutation functions
// ---------------------------------------------------------------------------

export function removePopGroupMut(ws: WorldState, popId: PopGroupId): void {
  const pop = ws.popGroups[popId]
  if (!pop) return

  delete ws.popGroups[popId]

  const byHolding = ws.popIndex.byHolding[pop.holdingId]
  if (byHolding) {
    const filtered = byHolding.filter((id) => (id as string) !== (popId as string))
    if (filtered.length > 0) {
      ws.popIndex.byHolding[pop.holdingId] = filtered
    } else {
      delete ws.popIndex.byHolding[pop.holdingId]
    }
  }
}

export function addToOrCreatePopGroupMut(
  ws: WorldState,
  input: {
    holdingId: HoldingId
    class: PopClass
    popType: PopType
    employed: boolean
    size: number
    inheritFrom?: PopGroup
  },
): PopGroupId {
  // Find existing pop with same merge key (holdingId + class + popType + employed, §13.3)
  const existingPopIds = ws.popIndex.byHolding[input.holdingId]
  if (existingPopIds) {
    for (const popId of existingPopIds) {
      const existing = ws.popGroups[popId]
      if (
        existing &&
        existing.class === input.class &&
        existing.popType === input.popType &&
        existing.employed === input.employed
      ) {
        // Merge into existing pop using population-weighted average
        const oldSize = existing.size
        const newSize = oldSize + input.size
        if (newSize <= 0) return existing.id

        const sourceUnrest = input.inheritFrom?.unrest ?? 10
        const sourceNeedSat = input.inheritFrom?.needSatisfaction ?? 50
        const sourceAttitudes = input.inheritFrom?.attitudes ?? {}

        ws.popGroups[popId] = {
          ...existing,
          size: newSize,
          // v0.58: money は extensive → sum (incoming は比例分が inheritFrom.money で渡る)。
          money: existing.money + (input.inheritFrom?.money ?? 0),
          // v0.58: needSatisfaction は intensive → size 加重平均。
          needSatisfaction: clamp(
            (existing.needSatisfaction * oldSize + sourceNeedSat * input.size) / newSize,
            0,
            100,
          ),
          unrest: clamp((existing.unrest * oldSize + sourceUnrest * input.size) / newSize, 0, 100),
          attitudes: mergeAttitudesWeightedBySize([
            { attitudes: existing.attitudes, size: oldSize },
            { attitudes: sourceAttitudes, size: input.size },
          ]),
        }
        return existing.id
      }
    }
  }

  // No existing pop found — create new
  const newId = createPopGroupId(ws.nextPopGroupId)
  ws.nextPopGroupId++

  const newPop: PopGroup = {
    id: newId,
    holdingId: input.holdingId,
    class: input.class,
    popType: input.popType,
    employed: input.employed,
    size: input.size,
    money: input.inheritFrom?.money ?? 0, // v0.58: extensive。create 時は incoming 比例分（Task 1.3 で比例移送制御）
    needSatisfaction: input.inheritFrom?.needSatisfaction ?? 50,
    unrest: input.inheritFrom?.unrest ?? 10,
    attitudes: input.inheritFrom ? { ...input.inheritFrom.attitudes } : {},
  }

  ws.popGroups[newId] = newPop

  const existing = ws.popIndex.byHolding[input.holdingId]
  if (existing) {
    ws.popIndex.byHolding[input.holdingId] = [...existing, newId]
  } else {
    ws.popIndex.byHolding[input.holdingId] = [newId]
  }

  return newId
}

export function movePopEmploymentMut(
  ws: WorldState,
  input: {
    sourcePopId: PopGroupId
    targetEmployed: boolean
    size: number
  },
): PopGroupId {
  const source = ws.popGroups[input.sourcePopId]
  if (!source || input.size <= 0) {
    throw new Error(`movePopEmploymentMut: invalid input`)
  }

  const moveSize = Math.min(input.size, source.size)

  // v0.58: money は extensive。移送 size 比で按分 (per-capita 保存)。inheritFrom の { ...source } は
  //   source.money を全額コピーするため、必ず比例分で上書きしないと merge で money が複製される。
  const movedMoney = source.size > 0 ? source.money * (moveSize / source.size) : 0

  const targetPopId = addToOrCreatePopGroupMut(ws, {
    holdingId: source.holdingId,
    class: source.class,
    popType: source.popType,
    employed: input.targetEmployed,
    size: moveSize,
    inheritFrom: { ...source, money: movedMoney },
  })

  // Re-read source after mutation (addToOrCreatePopGroupMut may have modified it)
  const updatedSource = ws.popGroups[input.sourcePopId]
  if (!updatedSource) return targetPopId

  const remainingSize = updatedSource.size - moveSize
  if (remainingSize <= 0.01) {
    // 残量が sliver。moveSize≈source.size なので movedMoney≈全額。微小残 money は許容 burn。
    removePopGroupMut(ws, input.sourcePopId)
  } else {
    // v0.58: 残量から移送分 money を減算 (per-capita 保存)。
    ws.popGroups[input.sourcePopId] = {
      ...updatedSource,
      size: remainingSize,
      money: updatedSource.money - movedMoney,
    }
  }

  return targetPopId
}

// v0.56 §5: 転職・移住の汎用 size 移送。source POP から amount を別の merge key (target) へ移す。
//   target が同一 holding + 別 popType/employed なら転職、別 holding なら移住。
//   既存 target POP があれば人口加重平均で merge、無ければ新規作成 (addToOrCreatePopGroupMut 再利用)。
//   source 下限 (minSourceSize) を割らない。返り値は target POP id (no-op 時 undefined)。
//   incomingWealth/UnrestOverride は合成 inheritFrom で create/merge 両パスに一貫反映 (§5.4, G2)。
export function movePopSizeToKeyMut(
  ws: WorldState,
  sourcePopId: PopGroupId,
  target: PopTargetKey,
  amount: number,
  options?: {
    minSourceSize?: number
    incomingUnrestOverride?: number
    // v0.58: 昇格コスト等。移送する money から per-capita コスト × 移動 size を差し引いて burn する
    //   (source は movedMoney 全額を失い、target は残差を受け取る。差額は source/sink の sink)。
    moneyCostPerCapita?: number
  },
): PopGroupId | undefined {
  const source = ws.popGroups[sourcePopId]
  if (!source) return undefined

  // §5.2(2): target key の stratum 整合を検査 (integrity #7)。
  if (target.class !== getPopStratum(target.popType)) {
    throw new Error(
      `movePopSizeToKeyMut: target stratum mismatch (popType=${target.popType} class=${target.class})`,
    )
  }

  // §5.2(3): amount<=0 は no-op。
  if (amount <= 0) return undefined

  // §5.2(4): source key と target key が完全一致なら no-op。
  if (
    source.holdingId === target.holdingId &&
    source.class === target.class &&
    source.popType === target.popType &&
    source.employed === target.employed
  ) {
    return undefined
  }

  // §5.2(5): source 下限を割らない movable を算出。
  const minSourceSize = options?.minSourceSize ?? POP_MOBILITY_SOURCE_FLOOR_DEFAULT
  const movable = Math.max(0, source.size - minSourceSize)
  let actualAmount = Math.min(amount, movable)
  if (actualAmount <= 0) return undefined

  // 人口保存: 残りが除去対象の sliver (<= epsilon) になる場合は source を丸ごと移す。
  //   こうしないと minSourceSize 分が source 削除で失われる (population leak)。1e-6 は float 境界の slack。
  //   minSourceSize が epsilon より大きい実 floor のときは remaining>=minSourceSize>>epsilon となり、
  //   この bump は発火しない (source は floor で保持される)。
  if (source.size - actualAmount <= POP_MOBILITY_SOURCE_FLOOR_DEFAULT + 1e-6) {
    actualAmount = source.size
  }

  // §5.2(7): incoming cohort の unrest (override 優先)。
  const incomingUnrest = options?.incomingUnrestOverride ?? source.unrest

  // v0.58: money は extensive。移送 size 比で按分 (per-capita 保存)。
  //   inheritFrom の { ...source } は source.money を全額コピーするため、必ず比例分で上書きする。
  const movedMoney = source.size > 0 ? source.money * (actualAmount / source.size) : 0
  // 昇格コスト等の sink: target が受け取る money は movedMoney からコストを引いた残差 (source は movedMoney
  //   全額を失う = 差額 burn)。
  const cost = (options?.moneyCostPerCapita ?? 0) * actualAmount
  const targetMoney = Math.max(0, movedMoney - cost)

  // §5.2(8-9): target へ merge-or-create。合成 inheritFrom で override を両パスに反映。
  const targetPopId = addToOrCreatePopGroupMut(ws, {
    holdingId: target.holdingId,
    class: target.class,
    popType: target.popType,
    employed: target.employed,
    size: actualAmount,
    inheritFrom: { ...source, unrest: incomingUnrest, money: targetMoney },
  })

  // §5.2(10-12): source から actualAmount を減らす。byHolding も整合。
  //   movable=size-minSourceSize なので remaining>=minSourceSize が保証される (source は drain 下限を割らない)。
  //   削除は drain 下限ではなく epsilon noise 判定で行う: minSourceSize が epsilon(default) のときのみ
  //   微小 sliver を除去し、minSourceSize がそれより大きい floor のときは source を保持する。
  const updatedSource = ws.popGroups[sourcePopId]
  if (!updatedSource) return targetPopId
  const remainingSize = updatedSource.size - actualAmount
  if (remainingSize <= POP_MOBILITY_SOURCE_FLOOR_DEFAULT) {
    // ここに来るのは sliver bump で actualAmount=source.size となり movedMoney=全額の場合のみ
    //   (minSourceSize が実 floor のときは remaining>=floor で else 側)。money は全量移送済み。
    removePopGroupMut(ws, sourcePopId)
  } else {
    // v0.58: 残量から移送分 money を減算 (per-capita 保存)。
    ws.popGroups[sourcePopId] = {
      ...updatedSource,
      size: remainingSize,
      money: updatedSource.money - movedMoney,
    }
  }

  return targetPopId
}

// ---------------------------------------------------------------------------
// v0.48 Crisis: holding スコープの in-place pop helper。
// province ラッパー (adjustProvincePop* / reduceProvincePopSizeProportional) を per-holding で
// 呼ぶと holdingsPerProvince 倍に多重適用する罠 (§1.1) があるため、Crisis は holding 単位で
// 1 回だけ適用するこの族を使う。1 tick 1 draft の mutable 規約に従い ws を直接書き換える。
// ---------------------------------------------------------------------------

// v0.58: holding 内の (optionally class 指定) POP の welfare(needSatisfaction) を delta だけ動かす
//   (clamp 0..100)。crisis/warSupply の welfare 影響に使う。
export function adjustHoldingPopNeedSatisfactionMut(
  ws: WorldState,
  holdingId: HoldingId,
  delta: number,
  popClass?: PopClass,
): void {
  const popIds = ws.popIndex.byHolding[holdingId]
  if (!popIds) return
  for (const popId of popIds) {
    const pop = ws.popGroups[popId]
    if (!pop) continue
    if (popClass !== undefined && pop.class !== popClass) continue
    const newSat = clamp(pop.needSatisfaction + delta, 0, 100)
    if (newSat === pop.needSatisfaction) continue
    ws.popGroups[popId] = { ...pop, needSatisfaction: newSat }
  }
}

// holding 内の (optionally class 指定) POP の unrest を delta だけ動かす (clamp 0..100)。
export function adjustHoldingPopUnrestMut(
  ws: WorldState,
  holdingId: HoldingId,
  delta: number,
  popClass?: PopClass,
): void {
  const popIds = ws.popIndex.byHolding[holdingId]
  if (!popIds) return
  for (const popId of popIds) {
    const pop = ws.popGroups[popId]
    if (!pop) continue
    if (popClass !== undefined && pop.class !== popClass) continue
    const newUnrest = clamp(pop.unrest + delta, 0, 100)
    if (newUnrest === pop.unrest) continue
    ws.popGroups[popId] = { ...pop, unrest: newUnrest }
  }
}

// holding 内の (optionally class 指定) POP の size を比例で減らす (各 pop が自身の size×rate を失う)。
// rate は [0,1]。reduceProvincePopSizeProportional の holding スコープ in-place 版。
export function reduceHoldingPopSizeProportionalMut(
  ws: WorldState,
  holdingId: HoldingId,
  rate: number,
  popClass?: PopClass,
): void {
  const popIds = ws.popIndex.byHolding[holdingId]
  if (!popIds) return
  for (const popId of popIds) {
    const pop = ws.popGroups[popId]
    if (!pop) continue
    if (popClass !== undefined && pop.class !== popClass) continue
    const newSize = Math.max(0, pop.size - pop.size * rate)
    if (newSize === pop.size) continue
    // v0.58: money は extensive → 死亡 (size 減) は per-capita 保存のため比例 burn
    //   (popSystem の自然死亡と同じ規約。crisis 死で money を据え置くと生存者の per-capita が膨らむ)。
    ws.popGroups[popId] = {
      ...pop,
      size: newSize,
      money: pop.size > 0 ? pop.money * (newSize / pop.size) : pop.money,
    }
  }
}

export function mergeCompatiblePopsMut(ws: WorldState): void {
  const mergeMap = new Map<string, PopGroupId[]>()

  for (const popId of Object.keys(ws.popGroups).sort() as PopGroupId[]) {
    const pop = ws.popGroups[popId]
    if (!pop) continue
    const key = `${pop.holdingId}|${pop.class}|${pop.popType}|${pop.employed}`
    const existing = mergeMap.get(key)
    if (existing) {
      existing.push(popId)
    } else {
      mergeMap.set(key, [popId])
    }
  }

  for (const [, popIds] of mergeMap) {
    if (popIds.length <= 1) continue

    // Keep the first pop, merge others into it
    const keepId = popIds[0]!
    const keepPop = ws.popGroups[keepId]
    if (!keepPop) continue

    const allPops: { pop: PopGroup; id: PopGroupId }[] = []
    for (const pid of popIds) {
      const p = ws.popGroups[pid]
      if (p) allPops.push({ pop: p, id: pid })
    }

    const totalSize = allPops.reduce((sum, { pop }) => sum + pop.size, 0)
    if (totalSize <= 0) continue

    // Population-weighted averages (intensive)。v0.58: money は extensive → sum。
    let weightedNeedSat = 0
    let weightedUnrest = 0
    let totalMoney = 0
    for (const { pop } of allPops) {
      weightedNeedSat += pop.needSatisfaction * pop.size
      weightedUnrest += pop.unrest * pop.size
      totalMoney += pop.money
    }

    ws.popGroups[keepId] = {
      ...keepPop,
      size: totalSize,
      money: totalMoney,
      needSatisfaction: clamp(weightedNeedSat / totalSize, 0, 100),
      unrest: clamp(weightedUnrest / totalSize, 0, 100),
      attitudes: mergeAttitudesWeightedBySize(allPops.map(({ pop }) => pop)),
    }

    // Remove duplicates (all except first)
    for (let i = 1; i < popIds.length; i++) {
      const removeId = popIds[i]!
      removePopGroupMut(ws, removeId)
    }
  }
}
