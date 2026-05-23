import { clamp } from '../utils/math'
import type { WorldState } from '../types/world'
import type { ProvinceId, PopGroupId, HoldingId } from '../types/ids'
import type { PopClass, PopOccupation, PopGroup } from '../types/popGroup'
import type { AttitudeMap } from '../types/attitude'
import { createPopGroupId } from '../types/ids'

// Adjust wealth of ALL pops in a province by delta (clamped 0..100 per pop)
export function adjustProvincePopWealth(
  state: WorldState,
  provinceId: ProvinceId,
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
      if (!pop) continue
      const newWealth = clamp(pop.wealth + delta, 0, 100)
      if (newWealth === pop.wealth) continue
      if (!newPopGroups) {
        newPopGroups = { ...state.popGroups }
      }
      newPopGroups[popGroupId] = { ...pop, wealth: newWealth }
    }
  }

  if (!newPopGroups) return state

  return { ...state, popGroups: newPopGroups }
}

// Adjust unrest of ALL pops in a province by delta (clamped 0..100 per pop)
export function adjustProvincePopUnrest(
  state: WorldState,
  provinceId: ProvinceId,
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
      if (!pop) continue
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

// Adjust size of ALL pops in a province by delta (clamped to >= 0 per pop)
export function adjustProvincePopSize(
  state: WorldState,
  provinceId: ProvinceId,
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
      if (!pop) continue
      const newSize = Math.max(0, pop.size + delta)
      if (newSize === pop.size) continue
      if (!newPopGroups) {
        newPopGroups = { ...state.popGroups }
      }
      newPopGroups[popGroupId] = { ...pop, size: newSize }
    }
  }

  if (!newPopGroups) return state

  return { ...state, popGroups: newPopGroups }
}

// Adjust wealth of pops of a specific class in a province by delta (clamped 0..100)
export function adjustProvincePopWealthByClass(
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
      const newWealth = clamp(pop.wealth + delta, 0, 100)
      if (newWealth === pop.wealth) continue
      if (!newPopGroups) {
        newPopGroups = { ...state.popGroups }
      }
      newPopGroups[popGroupId] = { ...pop, wealth: newWealth }
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

// Adjust size of pops of a specific class in a province by delta (clamped to >= 0)
export function adjustProvincePopSizeByClass(
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
      const newSize = Math.max(0, pop.size + delta)
      if (newSize === pop.size) continue
      if (!newPopGroups) {
        newPopGroups = { ...state.popGroups }
      }
      newPopGroups[popGroupId] = { ...pop, size: newSize }
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
    occupation: PopOccupation
    size: number
    inheritFrom?: PopGroup
  },
): PopGroupId {
  // Find existing pop with same merge key (holdingId + class + occupation)
  const existingPopIds = ws.popIndex.byHolding[input.holdingId]
  if (existingPopIds) {
    for (const popId of existingPopIds) {
      const existing = ws.popGroups[popId]
      if (existing && existing.class === input.class && existing.occupation === input.occupation) {
        // Merge into existing pop using population-weighted average
        const oldSize = existing.size
        const newSize = oldSize + input.size
        if (newSize <= 0) return existing.id

        const sourceWealth = input.inheritFrom?.wealth ?? 50
        const sourceUnrest = input.inheritFrom?.unrest ?? 10
        const sourceAttitudes = input.inheritFrom?.attitudes ?? {}

        ws.popGroups[popId] = {
          ...existing,
          size: newSize,
          wealth: (existing.wealth * oldSize + sourceWealth * input.size) / newSize,
          unrest: (existing.unrest * oldSize + sourceUnrest * input.size) / newSize,
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
    occupation: input.occupation,
    size: input.size,
    wealth: input.inheritFrom?.wealth ?? 50,
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

export function splitPopGroupMut(
  ws: WorldState,
  popId: PopGroupId,
  splitSize: number,
  overrides: Partial<Omit<PopGroup, 'id' | 'size'>>,
): PopGroupId {
  const source = ws.popGroups[popId]
  if (!source || splitSize <= 0 || splitSize >= source.size) {
    throw new Error(
      `splitPopGroupMut: invalid split (popId=${popId}, splitSize=${splitSize}, sourceSize=${source?.size})`,
    )
  }

  // Reduce source size
  ws.popGroups[popId] = { ...source, size: source.size - splitSize }

  // Create new pop
  const newId = createPopGroupId(ws.nextPopGroupId)
  ws.nextPopGroupId++

  const newPop: PopGroup = {
    id: newId,
    holdingId: overrides.holdingId ?? source.holdingId,
    class: overrides.class ?? source.class,
    occupation: overrides.occupation ?? source.occupation,
    size: splitSize,
    wealth: overrides.wealth ?? source.wealth,
    unrest: overrides.unrest ?? source.unrest,
    attitudes: overrides.attitudes ?? { ...source.attitudes },
  }

  ws.popGroups[newId] = newPop

  // Update popIndex for the NEW pop's holdingId
  const targetHoldingId = newPop.holdingId
  const existingIndex = ws.popIndex.byHolding[targetHoldingId]
  if (existingIndex) {
    ws.popIndex.byHolding[targetHoldingId] = [...existingIndex, newId]
  } else {
    ws.popIndex.byHolding[targetHoldingId] = [newId]
  }

  return newId
}

export function movePopSizeToOccupationMut(
  ws: WorldState,
  input: {
    sourcePopId: PopGroupId
    targetOccupation: PopOccupation
    size: number
  },
): PopGroupId {
  const source = ws.popGroups[input.sourcePopId]
  if (!source || input.size <= 0) {
    throw new Error(`movePopSizeToOccupationMut: invalid input`)
  }

  const moveSize = Math.min(input.size, source.size)

  // Add to target (same holdingId, same class, different occupation)
  const targetPopId = addToOrCreatePopGroupMut(ws, {
    holdingId: source.holdingId,
    class: source.class,
    occupation: input.targetOccupation,
    size: moveSize,
    inheritFrom: source,
  })

  // Re-read source after mutation (addToOrCreatePopGroupMut may have modified it)
  const updatedSource = ws.popGroups[input.sourcePopId]
  if (!updatedSource) return targetPopId

  const remainingSize = updatedSource.size - moveSize
  if (remainingSize <= 0.01) {
    removePopGroupMut(ws, input.sourcePopId)
  } else {
    ws.popGroups[input.sourcePopId] = { ...updatedSource, size: remainingSize }
  }

  return targetPopId
}

export function mergeCompatiblePopsMut(ws: WorldState): void {
  // Build merge key map: "holdingId|class|occupation" -> PopGroupId[]
  const mergeMap = new Map<string, PopGroupId[]>()

  for (const popId of Object.keys(ws.popGroups).sort() as PopGroupId[]) {
    const pop = ws.popGroups[popId]
    if (!pop) continue
    const key = `${pop.holdingId}|${pop.class}|${pop.occupation}`
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

    // Population-weighted averages
    let weightedWealth = 0
    let weightedUnrest = 0
    for (const { pop } of allPops) {
      weightedWealth += pop.wealth * pop.size
      weightedUnrest += pop.unrest * pop.size
    }

    ws.popGroups[keepId] = {
      ...keepPop,
      size: totalSize,
      wealth: weightedWealth / totalSize,
      unrest: weightedUnrest / totalSize,
      attitudes: mergeAttitudesWeightedBySize(allPops.map(({ pop }) => pop)),
    }

    // Remove duplicates (all except first)
    for (let i = 1; i < popIds.length; i++) {
      const removeId = popIds[i]!
      removePopGroupMut(ws, removeId)
    }
  }
}
