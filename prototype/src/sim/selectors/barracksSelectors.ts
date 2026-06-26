import type { WorldState } from '../types/world'
import type { RegimentTroopKind } from '../types/regiment'
import type { PolityId, HoldingId } from '../types/ids'
import type { PopType } from '../types/popGroup'
import type { SimulationConfig } from '../config/defaultConfig'

export function computeBarracksRequiredByPopType(
  config: SimulationConfig,
  troopKind: RegimentTroopKind,
): Partial<Record<PopType, number>> {
  const total = config.regimentBarracksRequiredTotalPopByTroopKind[troopKind]
  const ratios = config.regimentBarracksRequiredPopRatioByTroopKind[troopKind]
  const result: Partial<Record<PopType, number>> = {}
  for (const [pt, ratio] of Object.entries(ratios) as [PopType, number][]) {
    const count = Math.round(total * ratio)
    if (count > 0) {
      result[pt] = count
    }
  }
  return result
}

export function selectCavalryBarracksHolding(
  state: WorldState,
  polityId: PolityId,
): HoldingId | undefined {
  const polity = state.polities[polityId]
  if (!polity) return undefined
  if (polity.capitalProvinceId) {
    const province = state.provinces[polity.capitalProvinceId]
    if (province) {
      const holdingIds = (Object.keys(state.holdings) as HoldingId[])
        .filter((hId) => {
          const h = state.holdings[hId]
          return h && h.provinceId === polity.capitalProvinceId
        })
        .sort()
      if (holdingIds.length > 0) {
        return holdingIds[0]
      }
    }
  }
  return undefined
}
