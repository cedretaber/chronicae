import type { WorldState } from '../types/world'
import type { StateRegionId, PolityId } from '../types/ids'
import { getProvinceUnrest, getProvincePopulation } from './popSelectors'
import { getProvinceTerminalPolityId } from './landContractSelectors'

export function getStateNeighborIds(state: WorldState, stateId: StateRegionId): StateRegionId[] {
  const stateRegion = state.states[stateId]
  if (!stateRegion) return []
  const provinceSet = new Set(stateRegion.provinceIds.map((id) => id as string))
  const neighborStates = new Set<StateRegionId>()
  for (const pid of stateRegion.provinceIds) {
    const province = state.provinces[pid]
    if (!province) continue
    for (const nid of province.neighbors) {
      if (!provinceSet.has(nid)) {
        const neighbor = state.provinces[nid]
        if (neighbor && (neighbor.stateId as string) !== (stateId as string)) {
          neighborStates.add(neighbor.stateId)
        }
      }
    }
  }
  return Array.from(neighborStates)
}

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
