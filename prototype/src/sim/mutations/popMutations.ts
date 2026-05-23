import { clamp } from '../utils/math'
import type { WorldState } from '../types/world'
import type { ProvinceId } from '../types/ids'
import type { PopClass } from '../types/popGroup'

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
