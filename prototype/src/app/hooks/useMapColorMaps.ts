import { useMemo } from 'react'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { buildPolityColorMap, buildHouseColorMap } from '@/app/utils/polityColors'

/**
 * Polity / House の色マップを構築する共有フック。
 * UnifiedMap と MapLegend で同じ色を使うため一本化する。依存は polities/houses
 * のオブジェクト identity に限定し、session 全体 (毎 tick 変化) では再計算しない。
 */
export function useMapColorMaps(): {
  polityColorMap: Record<string, string>
  houseColorMap: Record<string, string>
} {
  const polities = useSimulationStore((s) => s.session?.currentState.polities)
  const houses = useSimulationStore((s) => s.session?.currentState.houses)

  const polityColorMap = useMemo(
    () => (polities ? buildPolityColorMap(Object.keys(polities)) : {}),
    [polities],
  )
  const houseColorMap = useMemo(
    () => (houses ? buildHouseColorMap(Object.keys(houses)) : {}),
    [houses],
  )

  return { polityColorMap, houseColorMap }
}
