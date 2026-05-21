import { useMemo, useState } from 'react'
import { useSimulationStore, type MapView } from '@/app/stores/simulationStore'
import { buildPolityColorMap, buildHouseColorMap, unrestToColor } from '@/app/utils/polityColors'
import { computeVoronoi, polygonToSvgPath, type VoronoiCell } from '@/app/utils/voronoi'
import { usePanZoom } from '@/app/hooks/usePanZoom'
import type { StateRegionId } from '@sim/types/ids'
import type { WorldState } from '@sim/types/world'
import {
  getStateDominantPolityId,
  getStateDominantRootPolityId,
  getStateDominantOwnerHouseId,
  getStatePopulation,
  getStateAverageUnrest,
} from '@sim/selectors/stateRegionSelectors'

function computeStateColor(
  world: WorldState,
  stateId: StateRegionId,
  mapView: MapView,
  polityColorMap: Record<string, string>,
  houseColorMap: Record<string, string>,
): { fill: string; opacity: number } {
  if (mapView === 'terminal') {
    const pid = getStateDominantPolityId(world, stateId)
    return { fill: pid ? (polityColorMap[pid] ?? '#888') : '#888', opacity: 1 }
  }
  if (mapView === 'root') {
    const pid = getStateDominantRootPolityId(world, stateId)
    return { fill: pid ? (polityColorMap[pid] ?? '#888') : '#888', opacity: 1 }
  }
  if (mapView === 'house') {
    const hid = getStateDominantOwnerHouseId(world, stateId)
    return { fill: hid ? (houseColorMap[hid] ?? '#888') : '#888', opacity: 1 }
  }
  if (mapView === 'share') {
    const pid = getStateDominantPolityId(world, stateId)
    return { fill: pid ? (polityColorMap[pid] ?? '#888') : '#888', opacity: 0.7 }
  }
  // unrest
  const unrest = getStateAverageUnrest(world, stateId)
  return { fill: unrestToColor(unrest / 100), opacity: 1 }
}

export function StateMapSvg() {
  const session = useSimulationStore((s) => s.session)
  const focusState = useSimulationStore((s) => s.focusState)
  const mapView = useSimulationStore((s) => s.mapView)
  const [hoveredStateId, setHoveredStateId] = useState<StateRegionId | null>(null)
  const { transform, handlers } = usePanZoom()

  const polities = session?.currentState.polities
  const houses = session?.currentState.houses
  const provinces = session?.currentState.provinces

  const polityColorMap = useMemo(() => {
    if (!polities) return {}
    return buildPolityColorMap(Object.keys(polities))
  }, [polities])

  const houseColorMap = useMemo(() => {
    if (!houses) return {}
    return buildHouseColorMap(Object.keys(houses))
  }, [houses])

  const voronoi = useMemo(() => {
    if (!provinces) return null
    const input = Object.values(provinces).map((p) => ({
      id: p.id,
      stateId: p.stateId,
      x: p.x,
      y: p.y,
    }))
    return computeVoronoi(input)
  }, [provinces])

  const stateColors = useMemo(() => {
    if (!session || !voronoi) return new Map<string, { fill: string; opacity: number }>()
    const world = session.currentState
    const colors = new Map<string, { fill: string; opacity: number }>()
    for (const [stateId] of voronoi.centroids) {
      colors.set(stateId, computeStateColor(world, stateId, mapView, polityColorMap, houseColorMap))
    }
    return colors
  }, [session, voronoi, mapView, polityColorMap, houseColorMap])

  const stateLabels = useMemo(() => {
    if (!session || !voronoi) return []
    const world = session.currentState
    return Array.from(voronoi.centroids.entries()).map(([stateId, { cx, cy }]) => {
      const stateRegion = world.states[stateId]
      const pop = getStatePopulation(world, stateId)
      const unrest = getStateAverageUnrest(world, stateId)
      return {
        stateId,
        name: stateRegion?.name ?? '?',
        provinceCount: stateRegion?.provinceIds.length ?? 0,
        population: Math.round(pop),
        unrest,
        cx,
        cy,
      }
    })
  }, [session, voronoi])

  // Group cells by stateId for hover effects
  const cellsByState = useMemo(() => {
    if (!voronoi) return new Map<string, VoronoiCell[]>()
    const map = new Map<string, VoronoiCell[]>()
    for (const cell of voronoi.cells) {
      const key = cell.stateId as string
      const arr = map.get(key)
      if (arr) {
        arr.push(cell)
      } else {
        map.set(key, [cell])
      }
    }
    return map
  }, [voronoi])

  if (!session || !voronoi) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">No world loaded</div>
    )
  }

  const [bx0, by0, bx1, by1] = voronoi.bounds
  const vw = bx1 - bx0
  const vh = by1 - by0
  const viewBox = `${bx0} ${by0} ${vw} ${vh}`

  return (
    <div className="h-full w-full overflow-hidden" style={{ cursor: 'grab' }} {...handlers}>
      <svg
        viewBox={viewBox}
        className="h-full w-full"
        style={{
          transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Province cells grouped by state */}
        {Array.from(cellsByState.entries()).map(([stateKey, cells]) => {
          const color = stateColors.get(stateKey)
          const isHovered = hoveredStateId !== null && (hoveredStateId as string) === stateKey
          const isDimmed = hoveredStateId !== null && (hoveredStateId as string) !== stateKey
          return (
            <g
              key={stateKey}
              opacity={isDimmed ? 0.45 : 1}
              style={{ transition: 'opacity 0.15s' }}
              onMouseEnter={() => setHoveredStateId(stateKey as StateRegionId)}
              onMouseLeave={() => setHoveredStateId(null)}
              onClick={() => focusState(stateKey as StateRegionId)}
              cursor="pointer"
            >
              {cells.map((cell) => (
                <path
                  key={cell.provinceId}
                  d={polygonToSvgPath(cell.polygon)}
                  fill={color?.fill ?? '#888'}
                  fillOpacity={color?.opacity ?? 1}
                  stroke="none"
                />
              ))}
              {isHovered &&
                cells.map((cell) => (
                  <path
                    key={`hover-${cell.provinceId}`}
                    d={polygonToSvgPath(cell.polygon)}
                    fill="white"
                    fillOpacity={0.12}
                    stroke="none"
                    pointerEvents="none"
                  />
                ))}
            </g>
          )
        })}

        {/* Intra-state borders (thin) */}
        <g pointerEvents="none">
          {voronoi.intraBorders.map((seg, i) => (
            <line
              key={`ib-${i}`}
              x1={seg[0]}
              y1={seg[1]}
              x2={seg[2]}
              y2={seg[3]}
              stroke="#9ca3af"
              strokeWidth={0.5}
              opacity={0.2}
            />
          ))}
        </g>

        {/* State borders (thick) */}
        <g pointerEvents="none">
          {voronoi.stateBorders.map((seg, i) => (
            <line
              key={`sb-${i}`}
              x1={seg[0]}
              y1={seg[1]}
              x2={seg[2]}
              y2={seg[3]}
              stroke="#1a1a2e"
              strokeWidth={3}
              strokeLinecap="round"
            />
          ))}
        </g>

        {/* State labels */}
        <g pointerEvents="none">
          {stateLabels.map((label) => (
            <g key={label.stateId} transform={`translate(${label.cx},${label.cy})`}>
              <text
                textAnchor="middle"
                dy={-8}
                fontSize={14}
                fontWeight="bold"
                fill="white"
                stroke="#1a1a2e"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {label.name}
              </text>
              <text
                textAnchor="middle"
                dy={8}
                fontSize={10}
                fill="#d1d5db"
                stroke="#1a1a2e"
                strokeWidth={2}
                paintOrder="stroke"
              >
                {label.provinceCount} prov · pop {label.population}
              </text>
              <text
                textAnchor="middle"
                dy={20}
                fontSize={9}
                fill={label.unrest > 40 ? '#f87171' : '#9ca3af'}
                stroke="#1a1a2e"
                strokeWidth={2}
                paintOrder="stroke"
              >
                unrest {label.unrest.toFixed(0)}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
