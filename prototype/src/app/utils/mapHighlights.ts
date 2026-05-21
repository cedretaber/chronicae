import type { WorldState } from '@sim/types/world'
import type { ProvinceId, PolityId, HouseId, StateRegionId } from '@sim/types/ids'
import {
  getProvinceTerminalPolityId,
  getHouseControlledProvinceIds,
  getHouseRelevantProvinceIds,
  getPolityOverlordProvinceIds,
} from '@sim/selectors/landContractSelectors'

export type HighlightTier = 'direct' | 'indirect' | 'none'

export const TIER_OPACITY: Record<HighlightTier, number> = {
  direct: 1,
  indirect: 0.65,
  none: 0.3,
}

export function computeProvinceTiers(
  world: WorldState,
  focusedEntity: { type: string; id: string } | undefined,
): Map<ProvinceId, HighlightTier> {
  const result = new Map<ProvinceId, HighlightTier>()

  if (!focusedEntity || (focusedEntity.type !== 'polity' && focusedEntity.type !== 'house')) {
    for (const pid of Object.keys(world.provinces)) {
      result.set(pid as ProvinceId, 'direct')
    }
    return result
  }

  const isPolity = focusedEntity.type === 'polity'
  const polity = isPolity ? world.polities[focusedEntity.id as PolityId] : undefined
  const house = !isPolity ? world.houses[focusedEntity.id as HouseId] : undefined

  const capitalProvinceId = polity?.capitalProvinceId
  const seatProvinceId = house?.seatProvinceId

  const directSet = new Set<string>()
  const indirectSet = new Set<string>()

  if (isPolity && polity) {
    for (const pid of Object.keys(world.provinces)) {
      const terminal = getProvinceTerminalPolityId(world, pid as ProvinceId)
      if (terminal === polity.id) directSet.add(pid)
    }
    for (const pid of getPolityOverlordProvinceIds(world, polity.id)) {
      indirectSet.add(pid)
    }
  } else if (house) {
    for (const pid of getHouseControlledProvinceIds(world, house.id)) {
      directSet.add(pid)
    }
    for (const pid of getHouseRelevantProvinceIds(world, house.id)) {
      indirectSet.add(pid)
    }
  }

  for (const pid of Object.keys(world.provinces)) {
    if (pid === (capitalProvinceId as string) || pid === (seatProvinceId as string)) {
      result.set(pid as ProvinceId, 'direct')
    } else if (directSet.has(pid)) {
      result.set(pid as ProvinceId, 'direct')
    } else if (indirectSet.has(pid)) {
      result.set(pid as ProvinceId, 'indirect')
    } else {
      result.set(pid as ProvinceId, 'none')
    }
  }

  return result
}

export function computeStateTiers(
  provinceTiers: Map<ProvinceId, HighlightTier>,
  world: WorldState,
): Map<StateRegionId, HighlightTier> {
  const result = new Map<StateRegionId, HighlightTier>()
  const tierRank: Record<HighlightTier, number> = { direct: 2, indirect: 1, none: 0 }

  for (const state of Object.values(world.states)) {
    if (!state) continue
    let maxRank = 0
    for (const pid of state.provinceIds) {
      const tier = provinceTiers.get(pid) ?? 'none'
      const rank = tierRank[tier]
      if (rank > maxRank) maxRank = rank
    }
    result.set(state.id, maxRank >= 2 ? 'direct' : maxRank >= 1 ? 'indirect' : 'none')
  }

  return result
}
