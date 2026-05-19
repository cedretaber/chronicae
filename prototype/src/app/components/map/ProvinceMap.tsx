import { useMemo } from 'react'
import { ReactFlow, Controls, type Node, type Edge, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { buildPolityColorMap, buildHouseColorMap, unrestToColor } from '@/app/utils/polityColors'
import type { PolityId, HouseId, ProvinceId } from '@/sim/types/ids'
import { getProvincePops, getProvinceUnrest } from '@/sim/selectors/popSelectors'
import {
  getProvinceTerminalPolityId,
  getProvinceRootPolityId,
  getProvinceEffectiveOwnerHouseId,
  getHouseControlledProvinceIds,
  getHouseRelevantProvinceIds,
  getPolityOverlordProvinceIds,
} from '@/sim/selectors/landContractSelectors'
import { getHousePolitySharePercent } from '@/sim/selectors/shareSelectors'
import { ProvinceNode, type ProvinceNodeData, type HighlightTier } from './ProvinceNode'
import { MapLegend } from './MapLegend'
import { MAP_ICON_CONFIG } from '@/app/constants/mapConstants'
import mapBackground from '@/assets/map/map-background.png'

const nodeTypes: NodeTypes = { province: ProvinceNode }

export function ProvinceMap() {
  const session = useSimulationStore((s) => s.session)
  const openWindows = useSimulationStore((s) => s.openWindows)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)
  const mapView = useSimulationStore((s) => s.mapView)

  const focused = useMemo(() => {
    if (openWindows.length === 0) return undefined
    return openWindows.reduce((a, b) => (a.zIndex >= b.zIndex ? a : b))
  }, [openWindows])
  const focusedType = focused?.entityType
  const focusedId = focused?.entityId

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

  // Convert provinces to React Flow nodes
  const nodes = useMemo(() => {
    if (!provinces) return []

    const popGroups = session?.currentState.popGroups
    const isPolitySelected = focusedType === 'polity'
    const isHouseSelected = focusedType === 'house'
    const anyEntityHighlighted = isPolitySelected || isHouseSelected

    const selectedPolity =
      isPolitySelected && focusedId && polities
        ? polities[focusedId as unknown as PolityId]
        : undefined
    const selectedHouse =
      isHouseSelected && focusedId && houses ? houses[focusedId as unknown as HouseId] : undefined

    const capitalProvinceIds = new Set<string>(
      Object.values(polities ?? {}).map((p) => p.capitalProvinceId),
    )
    const seatProvinceIds = new Set<string>(
      Object.values(houses ?? {}).map((h) => h.seatProvinceId),
    )

    const houseDirectSet =
      selectedHouse && session?.currentState
        ? new Set(
            getHouseControlledProvinceIds(session.currentState, selectedHouse.id).map(
              (id: ProvinceId) => id as string,
            ),
          )
        : new Set<string>()
    const houseIndirectSet =
      selectedHouse && session?.currentState
        ? new Set(
            getHouseRelevantProvinceIds(session.currentState, selectedHouse.id).map(
              (id: ProvinceId) => id as string,
            ),
          )
        : new Set<string>()
    const polityIndirectSet =
      selectedPolity && session?.currentState
        ? new Set(
            getPolityOverlordProvinceIds(session.currentState, selectedPolity.id).map(
              (id: ProvinceId) => id as string,
            ),
          )
        : new Set<string>()
    const capitalProvinceId = selectedPolity?.capitalProvinceId
    const seatProvinceId = selectedHouse?.seatProvinceId

    return Object.values(provinces).map((province) => {
      const pops = popGroups ? getProvincePops(session.currentState, province.id) : []
      const peasantsSize = pops.find((p) => p.class === 'peasants')?.size ?? 0
      const townsmenSize = pops.find((p) => p.class === 'townsmen')?.size ?? 0
      const urbanRatio =
        peasantsSize + townsmenSize > 0 ? townsmenSize / (peasantsSize + townsmenSize) : 0
      const isUrban = urbanRatio >= MAP_ICON_CONFIG.provinceUrbanIconThreshold

      const isCapital = capitalProvinceIds.has(province.id)
      const isSeat = seatProvinceIds.has(province.id)

      const terminalPolityId = session?.currentState
        ? getProvinceTerminalPolityId(session.currentState, province.id)
        : undefined

      let highlightTier: HighlightTier
      if (!anyEntityHighlighted) {
        highlightTier = 'direct'
      } else if (province.id === capitalProvinceId || province.id === seatProvinceId) {
        highlightTier = 'direct'
      } else if (isPolitySelected) {
        if (terminalPolityId === focusedId) highlightTier = 'direct'
        else if (polityIndirectSet.has(province.id)) highlightTier = 'indirect'
        else highlightTier = 'none'
      } else {
        if (houseDirectSet.has(province.id)) highlightTier = 'direct'
        else if (houseIndirectSet.has(province.id)) highlightTier = 'indirect'
        else highlightTier = 'none'
      }

      const isSelected = focusedId === province.id && focusedType === 'province'

      // mapView ベースの色 / opacity 計算
      let cellColor = '#888'
      let extraOpacity = 1
      const state = session?.currentState
      if (state) {
        if (mapView === 'terminal') {
          if (terminalPolityId) cellColor = polityColorMap[terminalPolityId] ?? '#888'
        } else if (mapView === 'root') {
          const rootId = getProvinceRootPolityId(state, province.id)
          if (rootId) cellColor = polityColorMap[rootId] ?? '#888'
        } else if (mapView === 'house') {
          const ownerHouseId = getProvinceEffectiveOwnerHouseId(state, province.id)
          if (ownerHouseId) cellColor = houseColorMap[ownerHouseId] ?? '#888'
        } else if (mapView === 'share') {
          if (terminalPolityId) cellColor = polityColorMap[terminalPolityId] ?? '#888'
          const ownerHouseId = getProvinceEffectiveOwnerHouseId(state, province.id)
          if (terminalPolityId && ownerHouseId) {
            const pct = getHousePolitySharePercent(state, terminalPolityId, ownerHouseId)
            extraOpacity = 0.4 + (Math.max(0, Math.min(100, pct)) / 100) * 0.6
          } else {
            extraOpacity = 0.4
          }
        } else if (mapView === 'unrest') {
          const u = getProvinceUnrest(state, province.id)
          cellColor = unrestToColor(u / 100)
        }
      }

      return {
        id: province.id,
        type: 'province',
        position: { x: province.x, y: province.y },
        data: {
          label: province.name,
          isUrban,
          isCapital,
          isSeat,
          polityColor: cellColor,
          highlightTier,
          isSelected,
          extraOpacity,
        } satisfies ProvinceNodeData,
      }
    })
  }, [
    provinces,
    polityColorMap,
    houseColorMap,
    focusedId,
    focusedType,
    polities,
    houses,
    session,
    mapView,
  ])

  // Convert province neighbors to edges (deduplicate: only when a < b)
  const edges: Edge[] = useMemo(() => {
    if (!provinces) return []
    const edgeSet = new Set<string>()
    const result: Edge[] = []
    for (const province of Object.values(provinces)) {
      for (const neighborId of province.neighbors) {
        const a = province.id
        const b = neighborId
        if (a >= b) continue
        const edgeId = `e-${a}-${b}`
        if (edgeSet.has(edgeId)) continue
        edgeSet.add(edgeId)
        result.push({
          id: edgeId,
          source: a,
          target: b,
          type: 'straight',
          style: { stroke: '#555', strokeWidth: 1 },
        })
      }
    }
    return result
  }, [provinces])

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    if (!session) return
    openDetailWindow('province', node.id)
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">No world loaded</div>
    )
  }

  return (
    <div className="relative h-full w-full">
      {/* Background image layer */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${mapBackground})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: MAP_ICON_CONFIG.backgroundOpacity,
        }}
      />
      <MapLegend />
      {/* ReactFlow layer */}
      <div className="relative z-10 h-full w-full">
        <ReactFlow
          nodeTypes={nodeTypes}
          nodes={nodes}
          edges={edges}
          fitView
          onNodeClick={handleNodeClick}
        >
          <Controls />
        </ReactFlow>
      </div>
    </div>
  )
}
