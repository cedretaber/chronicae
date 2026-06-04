import type { MapView } from '@/app/stores/simulationStore'
import { unrestToColor } from '@/app/utils/polityColors'
import type { ProvinceId, StateRegionId } from '@sim/types/ids'
import type { WorldState } from '@sim/types/world'
import {
  getStateDominantPolityId,
  getStateDominantRootPolityId,
  getStateDominantOwnerHouseId,
  getStateAverageUnrest,
} from '@sim/selectors/stateRegionSelectors'
import {
  getProvinceTerminalPolityId,
  getProvinceRootPolityId,
  getProvinceEffectiveOwnerHouseId,
} from '@sim/selectors/landContractSelectors'
import { getProvinceUnrest } from '@sim/selectors/popSelectors'
import { getActorInfluenceInPolity } from '@sim/selectors/influenceSelectors'
import { defaultConfig } from '@sim/config/defaultConfig'

/** color map に該当 id が無い / id 自体が無い場合のフォールバック色。 */
export const FALLBACK_COLOR = '#888'

/** color map から id の色を引く。id が無い・未登録ならフォールバック色。 */
export function resolveColor(
  colorMap: Record<string, string>,
  id: string | null | undefined,
): string {
  return id ? (colorMap[id] ?? FALLBACK_COLOR) : FALLBACK_COLOR
}

export function computeStateColor(
  world: WorldState,
  stateId: StateRegionId,
  mapView: MapView,
  polityColorMap: Record<string, string>,
  houseColorMap: Record<string, string>,
): { fill: string; opacity: number } {
  if (mapView === 'terminal') {
    return {
      fill: resolveColor(polityColorMap, getStateDominantPolityId(world, stateId)),
      opacity: 1,
    }
  }
  if (mapView === 'root') {
    return {
      fill: resolveColor(polityColorMap, getStateDominantRootPolityId(world, stateId)),
      opacity: 1,
    }
  }
  if (mapView === 'house') {
    return {
      fill: resolveColor(houseColorMap, getStateDominantOwnerHouseId(world, stateId)),
      opacity: 1,
    }
  }
  if (mapView === 'influence') {
    return {
      fill: resolveColor(polityColorMap, getStateDominantPolityId(world, stateId)),
      opacity: 0.7,
    }
  }
  const unrest = getStateAverageUnrest(world, stateId)
  return { fill: unrestToColor(unrest / 100), opacity: 1 }
}

export function computeProvinceColor(
  world: WorldState,
  provinceId: ProvinceId,
  mapView: MapView,
  polityColorMap: Record<string, string>,
  houseColorMap: Record<string, string>,
): { fill: string; opacity: number } {
  const terminalPolityId = getProvinceTerminalPolityId(world, provinceId)
  if (mapView === 'terminal') {
    return { fill: resolveColor(polityColorMap, terminalPolityId), opacity: 1 }
  }
  if (mapView === 'root') {
    return {
      fill: resolveColor(polityColorMap, getProvinceRootPolityId(world, provinceId)),
      opacity: 1,
    }
  }
  if (mapView === 'house') {
    return {
      fill: resolveColor(houseColorMap, getProvinceEffectiveOwnerHouseId(world, provinceId)),
      opacity: 1,
    }
  }
  if (mapView === 'influence') {
    const fill = resolveColor(polityColorMap, terminalPolityId)
    const ownerHouseId = getProvinceEffectiveOwnerHouseId(world, provinceId)
    if (terminalPolityId && ownerHouseId) {
      // v0.42 §16.4: share% → influence% (UI 表示は defaultConfig 係数で十分)
      const pct = getActorInfluenceInPolity(
        world,
        defaultConfig,
        { kind: 'house', id: ownerHouseId },
        terminalPolityId,
      ).percent
      return { fill, opacity: 0.4 + (Math.max(0, Math.min(100, pct)) / 100) * 0.6 }
    }
    return { fill, opacity: 0.4 }
  }
  const u = getProvinceUnrest(world, provinceId)
  return { fill: unrestToColor(u / 100), opacity: 1 }
}
