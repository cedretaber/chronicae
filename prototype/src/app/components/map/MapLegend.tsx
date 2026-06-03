import { useMemo } from 'react'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { unrestToColor } from '@/app/utils/polityColors'
import { getPolityTerminalProvinceIds } from '@sim/selectors/landContractSelectors'
import { getPolityEmitNameKey } from '@sim/selectors/nameRefSelectors'
import { useMapColorMaps } from '@/app/hooks/useMapColorMaps'

export function MapLegend() {
  const session = useSimulationStore((s) => s.session)
  const mapView = useSimulationStore((s) => s.mapView)
  const { polityColorMap, houseColorMap } = useMapColorMaps()

  const polityTop5 = useMemo(() => {
    if (!session) return []
    const state = session.currentState
    return Object.values(state.polities)
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        nameKey: getPolityEmitNameKey(state, p.id),
        size: getPolityTerminalProvinceIds(state, p.id).length,
      }))
      .filter((p) => p.size > 0)
      .sort((a, b) => b.size - a.size)
      .slice(0, 5)
  }, [session])

  const houseTop5 = useMemo(() => {
    if (!session) return []
    const state = session.currentState
    return Object.values(state.houses)
      .filter((h) => h.active && h.kind !== 'system')
      .sort((a, b) => b.legacyPrestige - a.legacyPrestige)
      .slice(0, 5)
      .map((h) => ({ id: h.id, nameKey: h.nameKey }))
  }, [session])

  if (!session) return null

  return (
    <div className="pointer-events-none absolute top-2 right-2 z-20 rounded bg-gray-900/80 px-2 py-1.5 text-[10px] text-gray-200 shadow-lg">
      {(mapView === 'terminal' || mapView === 'root') && (
        <div>
          <div className="mb-1 font-bold text-gray-400">
            {mapView === 'terminal' ? 'Terminal polity' : 'Root polity'}
          </div>
          {polityTop5.length === 0 ? (
            <div className="text-gray-500">no active polities</div>
          ) : (
            polityTop5.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: polityColorMap[p.id] ?? '#888' }}
                />
                <span className="truncate" style={{ maxWidth: 130 }}>
                  {p.nameKey}
                </span>
              </div>
            ))
          )}
        </div>
      )}
      {mapView === 'house' && (
        <div>
          <div className="mb-1 font-bold text-gray-400">Owner house</div>
          {houseTop5.length === 0 ? (
            <div className="text-gray-500">no active houses</div>
          ) : (
            houseTop5.map((h) => (
              <div key={h.id} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: houseColorMap[h.id] ?? '#888' }}
                />
                <span className="truncate" style={{ maxWidth: 130 }}>
                  {h.nameKey}
                </span>
              </div>
            ))
          )}
        </div>
      )}
      {mapView === 'share' && (
        <div>
          <div className="mb-1 font-bold text-gray-400">Owner-house share</div>
          <div className="text-gray-300">色 = terminal polity</div>
          <div className="text-gray-300">不透明度 = owner house の share</div>
          <div className="mt-1 flex items-center gap-1">
            <span className="h-2 w-3" style={{ background: '#3b6ea8', opacity: 0.4 }} />
            <span className="h-2 w-3" style={{ background: '#3b6ea8', opacity: 0.7 }} />
            <span className="h-2 w-3" style={{ background: '#3b6ea8', opacity: 1 }} />
            <span className="ml-1 text-gray-400">0% → 100%</span>
          </div>
        </div>
      )}
      {mapView === 'unrest' && (
        <div>
          <div className="mb-1 font-bold text-gray-400">Unrest heatmap</div>
          <div className="flex items-center gap-1">
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <span
                key={v}
                className="inline-block h-3 w-4"
                style={{ background: unrestToColor(v) }}
              />
            ))}
          </div>
          <div className="mt-0.5 flex justify-between text-gray-400">
            <span>0</span>
            <span>100</span>
          </div>
        </div>
      )}
    </div>
  )
}
