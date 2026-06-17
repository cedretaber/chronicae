import { useMemo, useState, useCallback, useRef } from 'react'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { computeVoronoi, polygonToSvgPath, type VoronoiCell } from '@/app/utils/voronoi'
import { addOceanPoints, OCEAN_STATE_ID } from '@/app/utils/oceanPoints'
import {
  computeProvinceTiers,
  computeStateTiers,
  TIER_OPACITY,
  type HighlightTier,
} from '@/app/utils/mapHighlights'
import { usePanZoom } from '@/app/hooks/usePanZoom'
import { MAP_ICON_CONFIG, UNIFIED_ICON_SIZE, getZoomTier } from '@/app/constants/mapConstants'
import { MapLegend } from './MapLegend'
import { computeStateColor, computeProvinceColor, FALLBACK_COLOR } from './mapColors'
import { computeBounds, computeFocusTransform } from './mapGeometry'
import { useMapColorMaps } from '@/app/hooks/useMapColorMaps'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getPolityShortName } from '@/app/hooks/entityNameHelpers'
import type { ProvinceId, StateRegionId } from '@sim/types/ids'
import { getStatePopulation, getStateAverageUnrest } from '@sim/selectors/stateRegionSelectors'
import { getProvinceTerminalPolityId } from '@sim/selectors/landContractSelectors'
import { getProvincePops, getProvinceUnrest } from '@sim/selectors/popSelectors'
import stateMapBackground from '@/assets/map/state-map-background.png'
import provinceUrbanIcon from '@/assets/map/province-urban.png'
import provinceRuralIcon from '@/assets/map/province-rural.png'
import provinceCastleIcon from '@/assets/map/badge-castle.png'
import provinceManorIcon from '@/assets/map/badge-manor.png'

export function UnifiedMap() {
  const resolveName = useEntityName()
  const session = useSimulationStore((s) => s.session)
  const mapView = useSimulationStore((s) => s.mapView)
  const openWindows = useSimulationStore((s) => s.openWindows)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)
  const [hoveredProvinceId, setHoveredProvinceId] = useState<ProvinceId | null>(null)
  const [hoveredStateId, setHoveredStateId] = useState<StateRegionId | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const { transform, handlers, animateTo, zoomBy, resetZoom } = usePanZoom()
  const containerRef = useRef<HTMLDivElement>(null)

  const zoomTier = getZoomTier(transform.scale)

  const provinces = session?.currentState.provinces

  const { polityColorMap, houseColorMap } = useMapColorMaps()

  const voronoi = useMemo(() => {
    if (!provinces) return null
    const input = Object.values(provinces).map((p) => ({
      id: p.id,
      stateId: p.stateId,
      x: p.x,
      y: p.y,
    }))
    const { allPoints } = addOceanPoints(input)
    const excludeIds = new Set([OCEAN_STATE_ID])
    return computeVoronoi(allPoints, 60, excludeIds)
  }, [provinces])

  // State-level colors
  const stateColors = useMemo(() => {
    if (!session || !voronoi) return new Map<string, { fill: string; opacity: number }>()
    const world = session.currentState
    const colors = new Map<string, { fill: string; opacity: number }>()
    for (const [stateId] of voronoi.centroids) {
      colors.set(stateId, computeStateColor(world, stateId, mapView, polityColorMap, houseColorMap))
    }
    return colors
  }, [session, voronoi, mapView, polityColorMap, houseColorMap])

  // Province-level colors
  const provinceColors = useMemo(() => {
    if (!session || !voronoi) return new Map<string, { fill: string; opacity: number }>()
    const world = session.currentState
    const colors = new Map<string, { fill: string; opacity: number }>()
    for (const cell of voronoi.cells) {
      colors.set(
        cell.provinceId,
        computeProvinceColor(world, cell.provinceId, mapView, polityColorMap, houseColorMap),
      )
    }
    return colors
  }, [session, voronoi, mapView, polityColorMap, houseColorMap])

  // Highlight tiers
  const focused = useMemo(() => {
    if (openWindows.length === 0) return undefined
    const top = openWindows.reduce((a, b) => (a.zIndex >= b.zIndex ? a : b))
    return { type: top.entityType, id: top.entityId }
  }, [openWindows])

  const provinceTiers = useMemo(() => {
    if (!session) return new Map<ProvinceId, HighlightTier>()
    return computeProvinceTiers(session.currentState, focused)
  }, [session, focused])

  const stateTiers = useMemo(() => {
    if (!session) return new Map<StateRegionId, HighlightTier>()
    return computeStateTiers(provinceTiers, session.currentState)
  }, [session, provinceTiers])

  // State labels
  const stateLabels = useMemo(() => {
    if (!session || !voronoi) return []
    const world = session.currentState
    return Array.from(voronoi.centroids.entries()).map(([stateId, { cx, cy }]) => {
      const stateRegion = world.states[stateId]
      const pop = getStatePopulation(world, stateId)
      const unrest = getStateAverageUnrest(world, stateId)
      return {
        stateId,
        name: stateRegion
          ? resolveName('state_region', stateRegion.nameKey, stateRegion.nameKey)
          : '?',
        provinceCount: stateRegion?.provinceIds.length ?? 0,
        population: Math.round(pop),
        unrest,
        cx,
        cy,
      }
    })
  }, [session, voronoi, resolveName])

  // Province data for icons and labels
  const provinceData = useMemo(() => {
    if (!session || !provinces) return []
    const world = session.currentState
    const popGroups = world.popGroups
    const capitalIds = new Set(Object.values(world.polities).map((p) => p.capitalProvinceId))
    const seatIds = new Set(Object.values(world.houses).map((h) => h.seatProvinceId))

    return Object.values(provinces).map((prov) => {
      const pops = popGroups ? getProvincePops(world, prov.id) : []
      const peasants = pops.find((p) => p.class === 'peasants')?.size ?? 0
      const townsmen = pops.find((p) => p.class === 'townsmen')?.size ?? 0
      const urbanRatio = peasants + townsmen > 0 ? townsmen / (peasants + townsmen) : 0
      return {
        id: prov.id,
        stateId: prov.stateId,
        name: resolveName('province', prov.nameKey, prov.nameKey),
        x: prov.x,
        y: prov.y,
        neighbors: prov.neighbors,
        isUrban: urbanRatio >= MAP_ICON_CONFIG.provinceUrbanIconThreshold,
        isCapital: capitalIds.has(prov.id),
        isSeat: seatIds.has(prov.id),
      }
    })
  }, [session, provinces, resolveName])

  // Neighbor edges (deduplicated)
  const neighborEdges = useMemo(() => {
    if (!provinces) return []
    const edges: {
      a: ProvinceId
      b: ProvinceId
      ax: number
      ay: number
      bx: number
      by: number
    }[] = []
    const seen = new Set<string>()
    for (const prov of Object.values(provinces)) {
      for (const nid of prov.neighbors) {
        const key = prov.id < nid ? `${prov.id}-${nid}` : `${nid}-${prov.id}`
        if (seen.has(key)) continue
        seen.add(key)
        const neighbor = provinces[nid]
        if (!neighbor) continue
        edges.push({ a: prov.id, b: nid, ax: prov.x, ay: prov.y, bx: neighbor.x, by: neighbor.y })
      }
    }
    return edges
  }, [provinces])

  // Group cells by stateId for far-zoom hover
  const cellsByState = useMemo(() => {
    if (!voronoi) return new Map<string, VoronoiCell[]>()
    const map = new Map<string, VoronoiCell[]>()
    for (const cell of voronoi.cells) {
      const key = cell.stateId as string
      const arr = map.get(key)
      if (arr) arr.push(cell)
      else map.set(key, [cell])
    }
    return map
  }, [voronoi])

  // Click handlers
  const handleCellClick = useCallback(
    (provinceId: ProvinceId, stateId: StateRegionId) => {
      if (!session || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()

      if (zoomTier !== 'far') {
        openDetailWindow('province', provinceId)
        return
      }

      // Compute bounding box of target area
      const world = session.currentState
      const state = world.states[stateId]
      const targetProvIds = state?.provinceIds ?? [provinceId]

      const targetPoints = targetProvIds
        .map((pid) => world.provinces[pid])
        .filter((p): p is NonNullable<typeof p> => p !== undefined)
      const bounds = computeBounds(targetPoints)
      if (!voronoi || !bounds) return

      const pad = zoomTier === 'far' ? 60 : 30
      const target = computeFocusTransform({
        target: bounds,
        viewBounds: voronoi.bounds,
        rectWidth: rect.width,
        rectHeight: rect.height,
        pad,
      })
      animateTo(target, 400)
    },
    [session, zoomTier, voronoi, openDetailWindow, animateTo],
  )

  if (!session || !voronoi) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">No world loaded</div>
    )
  }

  const [bx0, by0, bx1, by1] = voronoi.bounds
  const vw = bx1 - bx0
  const vh = by1 - by0
  const viewBox = `${bx0} ${by0} ${vw} ${vh}`

  const isFar = zoomTier === 'far'
  const isNear = zoomTier === 'near'
  const isMediumOrNear = !isFar

  const stateBorderWidth = isFar ? 3 : isNear ? 1 : 2
  const intraBorderWidth = isFar ? 0.5 : isNear ? 1.5 : 1
  const intraBorderOpacity = isFar ? 0.1 : isNear ? 0.6 : 0.4
  const iconSize = isNear ? UNIFIED_ICON_SIZE.near : UNIFIED_ICON_SIZE.medium
  const badgeSize = isNear ? UNIFIED_ICON_SIZE.badgeNear : UNIFIED_ICON_SIZE.badgeMedium

  return (
    <div className="relative h-full w-full">
      <MapLegend />
      {/* Zoom controls */}
      <div className="absolute bottom-3 left-3 z-20 flex flex-col gap-1">
        <button
          className="flex h-8 w-8 items-center justify-center rounded bg-gray-800/80 text-lg text-white hover:bg-gray-700"
          onClick={() => zoomBy(1.5, containerRef.current)}
          title="Zoom in"
        >
          +
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded bg-gray-800/80 text-lg text-white hover:bg-gray-700"
          onClick={() => zoomBy(1 / 1.5, containerRef.current)}
          title="Zoom out"
        >
          -
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded bg-gray-800/80 text-sm text-white hover:bg-gray-700"
          onClick={resetZoom}
          title="Reset zoom"
        >
          ⟲
        </button>
      </div>
      <div
        ref={containerRef}
        className="relative z-10 h-full w-full overflow-hidden"
        style={{ cursor: zoomTier === 'near' ? 'pointer' : 'grab' }}
        {...handlers}
      >
        <svg
          viewBox={viewBox}
          className="h-full w-full"
          style={{
            transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {/* Layer 0: 背景地図。地図座標系 (viewBox) に固定し、pan/zoom と連動させる
              (旧: ビューポート固定の cover div で、拡大時に背景だけ動かず不自然だった)。
              slice = CSS の background-size:cover 相当 (アスペクト比を保って box を充填)。 */}
          <image
            href={stateMapBackground}
            x={bx0}
            y={by0}
            width={vw}
            height={vh}
            preserveAspectRatio="xMidYMid slice"
            opacity={MAP_ICON_CONFIG.backgroundOpacity}
            pointerEvents="none"
          />

          {/* Layer 1: Province cells — state-colored (far) */}
          <g
            style={{
              opacity: isFar ? 1 : 0,
              transition: 'opacity 0.25s',
              pointerEvents: isFar ? 'auto' : 'none',
            }}
          >
            {Array.from(cellsByState.entries()).map(([stateKey, cells]) => {
              const color = stateColors.get(stateKey)
              const tier = stateTiers.get(stateKey as StateRegionId) ?? 'direct'
              const tierOp = TIER_OPACITY[tier] ?? 1
              const isHovered = hoveredStateId !== null && (hoveredStateId as string) === stateKey
              const isDimmed = hoveredStateId !== null && (hoveredStateId as string) !== stateKey
              return (
                <g
                  key={`s-${stateKey}`}
                  opacity={(isDimmed ? 0.45 : 1) * tierOp}
                  style={{ transition: 'opacity 0.15s' }}
                  onMouseEnter={() => setHoveredStateId(stateKey as StateRegionId)}
                  onMouseLeave={() => setHoveredStateId(null)}
                  onClick={() => {
                    const firstCell = cells[0]
                    if (firstCell) handleCellClick(firstCell.provinceId, stateKey as StateRegionId)
                  }}
                  cursor="pointer"
                >
                  {cells.map((cell) => (
                    <path
                      key={cell.provinceId}
                      d={polygonToSvgPath(cell.polygon)}
                      fill={color?.fill ?? FALLBACK_COLOR}
                      fillOpacity={0.08}
                      stroke={color?.fill ?? FALLBACK_COLOR}
                      strokeWidth={4}
                      strokeOpacity={0.5}
                      paintOrder="stroke"
                    />
                  ))}
                  {isHovered &&
                    cells.map((cell) => (
                      <path
                        key={`h-${cell.provinceId}`}
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
          </g>

          {/* Layer 1b: Province cells — province-colored (medium/near) */}
          <g
            style={{
              opacity: isFar ? 0 : 1,
              transition: 'opacity 0.25s',
              pointerEvents: isFar ? 'none' : 'auto',
            }}
          >
            {voronoi.cells.map((cell) => {
              const color = provinceColors.get(cell.provinceId)
              const tier = provinceTiers.get(cell.provinceId) ?? 'direct'
              const tierOp = TIER_OPACITY[tier] ?? 1
              const isHovered = hoveredProvinceId !== null && hoveredProvinceId === cell.provinceId
              return (
                <g key={`p-${cell.provinceId}`}>
                  <path
                    d={polygonToSvgPath(cell.polygon)}
                    fill={color?.fill ?? FALLBACK_COLOR}
                    fillOpacity={0.08 * tierOp}
                    stroke={color?.fill ?? FALLBACK_COLOR}
                    strokeWidth={3}
                    strokeOpacity={0.45 * tierOp}
                    paintOrder="stroke"
                    onMouseEnter={() => setHoveredProvinceId(cell.provinceId)}
                    onMouseMove={(e) => setTooltipPos({ x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => {
                      setHoveredProvinceId(null)
                      setTooltipPos(null)
                    }}
                    onClick={() => handleCellClick(cell.provinceId, cell.stateId)}
                    cursor="pointer"
                  />
                  {isHovered && (
                    <path
                      d={polygonToSvgPath(cell.polygon)}
                      fill="white"
                      fillOpacity={0.15}
                      stroke="none"
                      pointerEvents="none"
                    />
                  )}
                </g>
              )
            })}
          </g>

          {/* Layer 2: Intra-state borders */}
          <g pointerEvents="none">
            {voronoi.intraBorders.map((seg, i) => (
              <line
                key={`ib-${i}`}
                x1={seg[0]}
                y1={seg[1]}
                x2={seg[2]}
                y2={seg[3]}
                stroke="#9ca3af"
                strokeWidth={intraBorderWidth}
                opacity={intraBorderOpacity}
              />
            ))}
          </g>

          {/* Layer 3: State borders */}
          <g pointerEvents="none">
            {voronoi.stateBorders.map((seg, i) => (
              <line
                key={`sb-${i}`}
                x1={seg[0]}
                y1={seg[1]}
                x2={seg[2]}
                y2={seg[3]}
                stroke="#1a1a2e"
                strokeWidth={stateBorderWidth}
                strokeLinecap="round"
              />
            ))}
          </g>

          {/* Layer 4: Province neighbor edges (medium+ zoom) */}
          {isMediumOrNear && (
            <g pointerEvents="none" opacity={0.35}>
              {neighborEdges.map((e) => (
                <line
                  key={`ne-${e.a}-${e.b}`}
                  x1={e.ax}
                  y1={e.ay}
                  x2={e.bx}
                  y2={e.by}
                  stroke="#78716c"
                  strokeWidth={isNear ? 1.2 : 0.6}
                />
              ))}
            </g>
          )}

          {/* Layer 5: Province icons (medium+ zoom) */}
          {isMediumOrNear && (
            <g pointerEvents="none">
              {provinceData.map((prov) => {
                const tier = provinceTiers.get(prov.id) ?? 'direct'
                const tierOp = TIER_OPACITY[tier] ?? 1
                return (
                  <g key={`icon-${prov.id}`} opacity={tierOp}>
                    <image
                      href={prov.isUrban ? provinceUrbanIcon : provinceRuralIcon}
                      x={prov.x - iconSize / 2}
                      y={prov.y - iconSize / 2}
                      width={iconSize}
                      height={iconSize}
                    />
                    {prov.isCapital && (
                      <image
                        href={provinceCastleIcon}
                        x={prov.x + iconSize / 2 - badgeSize}
                        y={prov.y + iconSize / 2 - badgeSize}
                        width={badgeSize}
                        height={badgeSize}
                      />
                    )}
                    {prov.isSeat && (
                      <image
                        href={provinceManorIcon}
                        x={
                          prov.isCapital ? prov.x - iconSize / 2 : prov.x + iconSize / 2 - badgeSize
                        }
                        y={prov.y + iconSize / 2 - badgeSize}
                        width={badgeSize}
                        height={badgeSize}
                      />
                    )}
                  </g>
                )
              })}
            </g>
          )}

          {/* Layer 6: Province labels (medium+ zoom) */}
          {isMediumOrNear && (
            <g pointerEvents="none">
              {provinceData.map((prov) => {
                const tier = provinceTiers.get(prov.id) ?? 'direct'
                const tierOp = TIER_OPACITY[tier] ?? 1
                return (
                  <text
                    key={`pl-${prov.id}`}
                    x={prov.x}
                    y={prov.y + iconSize / 2 + (isNear ? 8 : 5)}
                    textAnchor="middle"
                    fontSize={isNear ? 8 : 5}
                    fill="white"
                    stroke="#1a1a2e"
                    strokeWidth={isNear ? 2 : 1.5}
                    paintOrder="stroke"
                    opacity={tierOp}
                  >
                    {prov.name}
                  </text>
                )
              })}
            </g>
          )}

          {/* Layer 7: State labels (far + medium zoom) */}
          {!isNear && (
            <g pointerEvents="none">
              {stateLabels.map((label) => (
                <g key={`sl-${label.stateId}`} transform={`translate(${label.cx},${label.cy})`}>
                  <text
                    textAnchor="middle"
                    dy={isFar ? -8 : -4}
                    fontSize={isFar ? 14 : 9}
                    fontWeight="bold"
                    fill="white"
                    stroke="#1a1a2e"
                    strokeWidth={isFar ? 3 : 2}
                    paintOrder="stroke"
                  >
                    {label.name}
                  </text>
                  {isFar && (
                    <>
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
                    </>
                  )}
                </g>
              ))}
            </g>
          )}
        </svg>
        {/* Tooltip */}
        {hoveredProvinceId &&
          tooltipPos &&
          isMediumOrNear &&
          session &&
          (() => {
            const prov = session.currentState.provinces[hoveredProvinceId]
            if (!prov) return null
            const world = session.currentState
            const pop = getProvincePops(world, hoveredProvinceId)
            const totalPop = pop.reduce((s, p) => s + p.size, 0)
            const unrest = getProvinceUnrest(world, hoveredProvinceId)
            const terminalPolity = getProvinceTerminalPolityId(world, hoveredProvinceId)
            const polityName = terminalPolity
              ? getPolityShortName(world, resolveName, terminalPolity)
              : undefined
            const stateName = world.states[prov.stateId]?.nameKey
            return (
              <div
                className="pointer-events-none fixed z-50 rounded bg-gray-900/90 px-2.5 py-1.5 text-xs text-white shadow-lg"
                style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 10 }}
              >
                <div className="font-bold">
                  {resolveName('province', prov.nameKey, prov.nameKey)}
                </div>
                <div className="text-gray-400">{stateName}</div>
                {polityName && <div>Polity: {polityName}</div>}
                <div>
                  Pop: {Math.round(totalPop)} · Unrest: {unrest.toFixed(0)}
                </div>
                <div>Holdings: {prov.holdingIds.length}</div>
              </div>
            )
          })()}
      </div>
    </div>
  )
}
