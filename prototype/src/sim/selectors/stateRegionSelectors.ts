import type { WorldState } from '../types/world'
import type { StateRegionId, PolityId, HouseId } from '../types/ids'
import { getProvinceUnrest, getProvincePopulation } from './popSelectors'
import {
  getProvinceTerminalPolityId,
  getProvinceRootPolityId,
  getProvinceEffectiveOwnerHouseId,
} from './landContractSelectors'

export function getStateDominantPolityId(
  world: WorldState,
  stateId: StateRegionId,
): PolityId | undefined {
  const stateRegion = world.states[stateId]
  if (!stateRegion) return undefined
  const counts = new Map<string, number>()
  for (const pid of stateRegion.provinceIds) {
    const terminalPolity = getProvinceTerminalPolityId(world, pid)
    if (terminalPolity) {
      const key = terminalPolity as string
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  let best: PolityId | undefined
  let bestCount = 0
  for (const [pid, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      best = pid as PolityId
    }
  }
  return best
}

export function getStatePopulation(state: WorldState, stateId: StateRegionId): number {
  const stateRegion = state.states[stateId]
  if (!stateRegion) return 0
  let total = 0
  for (const pid of stateRegion.provinceIds) {
    total += getProvincePopulation(state, pid)
  }
  return total
}

export function getStateAverageUnrest(state: WorldState, stateId: StateRegionId): number {
  const stateRegion = state.states[stateId]
  if (!stateRegion || stateRegion.provinceIds.length === 0) return 0
  let total = 0
  for (const pid of stateRegion.provinceIds) {
    total += getProvinceUnrest(state, pid)
  }
  return total / stateRegion.provinceIds.length
}

export function getStateDominantRootPolityId(
  world: WorldState,
  stateId: StateRegionId,
): PolityId | undefined {
  const stateRegion = world.states[stateId]
  if (!stateRegion) return undefined
  const counts = new Map<string, number>()
  for (const pid of stateRegion.provinceIds) {
    const rootPolity = getProvinceRootPolityId(world, pid)
    if (rootPolity) {
      const key = rootPolity as string
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  let best: PolityId | undefined
  let bestCount = 0
  for (const [pid, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      best = pid as PolityId
    }
  }
  return best
}

export function getStateDominantOwnerHouseId(
  world: WorldState,
  stateId: StateRegionId,
): HouseId | undefined {
  const stateRegion = world.states[stateId]
  if (!stateRegion) return undefined
  const counts = new Map<string, number>()
  for (const pid of stateRegion.provinceIds) {
    const houseId = getProvinceEffectiveOwnerHouseId(world, pid)
    if (houseId) {
      const key = houseId as string
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  let best: HouseId | undefined
  let bestCount = 0
  for (const [hid, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      best = hid as HouseId
    }
  }
  return best
}
