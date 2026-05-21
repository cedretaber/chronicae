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
import { getProvinceMapBackground } from '@/app/utils/assetHash'

const nodeTypes: NodeTypes = { province: ProvinceNode }

export function ProvinceMap() {
  const session = useSimulationStore((s) => s.session)
  const openWindows = useSimulationStore((s) => s.openWindows)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)
  const mapView = useSimulationStore((s) => s.mapView)
  const focusedStateId = useSimulationStore((s) => s.focusedStateId)
  const exitToStateMap = useSimulationStore((s) => s.exitToStateMap)

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

  // Convert provinces to React Flow nodes + gate edges
  const { nodes, gateEdges } = useMemo(() => {
    if (!provinces) return { nodes: [], gateEdges: [] }

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

    const filteredProvinces = focusedStateId
      ? Object.values(provinces).filter((p) => (p.stateId as string) === (focusedStateId as string))
      : Object.values(provinces)

    // Gate indicators for cross-State connections
    // Place gate nodes outside the province cluster, in the direction of the external province
    const gateNodes: Node[] = []
    const gateEdges: Edge[] = []
    if (focusedStateId && session) {
      const world = session.currentState
      const GATE_OFFSET = 150
      const gateTargets = new Map<
        string,
        {
          fromProvinceId: string
          fromX: number
          fromY: number
          neighborX: number
          neighborY: number
          toStateName: string
        }
      >()
      for (const province of filteredProvinces) {
        for (const nid of province.neighbors) {
          const neighbor = world.provinces[nid]
          if (!neighbor) continue
          const neighborStateId = neighbor.stateId as string
          if (neighborStateId === (focusedStateId as string)) continue
          const targetState = world.states[neighbor.stateId]
          if (!targetState) continue
          const key = `${province.id as string}-${neighborStateId}`
          if (!gateTargets.has(key)) {
            gateTargets.set(key, {
              fromProvinceId: province.id,
              fromX: province.x,
              fromY: province.y,
              neighborX: neighbor.x,
              neighborY: neighbor.y,
              toStateName: targetState.name,
            })
          }
        }
      }
      let gateIndex = 0
      for (const [
        ,
        { fromProvinceId, fromX, fromY, neighborX, neighborY, toStateName },
      ] of gateTargets) {
        const gateId = `gate-${gateIndex++}`
        const dx = neighborX - fromX
        const dy = neighborY - fromY
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const gateX = fromX + (dx / dist) * GATE_OFFSET
        const gateY = fromY + (dy / dist) * GATE_OFFSET
        gateNodes.push({
          id: gateId,
          type: 'default',
          position: { x: gateX, y: gateY },
          data: { label: `→ ${toStateName}` },
          style: {
            fontSize: 9,
            padding: '2px 6px',
            background: '#374151',
            color: '#9ca3af',
            border: '1px dashed #6b7280',
            borderRadius: 4,
            pointerEvents: 'none' as const,
            minWidth: 'auto',
          },
          selectable: false,
          draggable: false,
        })
        gateEdges.push({
          id: `ge-${gateId}`,
          source: fromProvinceId,
          target: gateId,
          type: 'straight',
          style: { stroke: '#6b7280', strokeWidth: 2, strokeDasharray: '6 4' },
        })
      }
    }

    const provinceNodes = filteredProvinces.map((province) => {
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

    return { nodes: [...provinceNodes, ...gateNodes], gateEdges }
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
    focusedStateId,
  ])

  // Convert province neighbors to edges (deduplicate: only when a < b)
  const edges: Edge[] = useMemo(() => {
    if (!provinces) return []
    const edgeSet = new Set<string>()
    const result: Edge[] = []
    const filteredProvinceIds = focusedStateId
      ? new Set(
          Object.values(provinces)
            .filter((p) => (p.stateId as string) === (focusedStateId as string))
            .map((p) => p.id as string),
        )
      : null

    for (const province of Object.values(provinces)) {
      if (filteredProvinceIds && !filteredProvinceIds.has(province.id)) continue
      for (const neighborId of province.neighbors) {
        const a = province.id
        const b = neighborId
        if (a >= b) continue
        const edgeId = `e-${a}-${b}`
        if (edgeSet.has(edgeId)) continue
        edgeSet.add(edgeId)

        const isGate = filteredProvinceIds && !filteredProvinceIds.has(neighborId)
        if (isGate) continue // don't draw edges to provinces outside the focused state

        result.push({
          id: edgeId,
          source: a,
          target: b,
          type: 'straight',
          style: { stroke: '#78716c', strokeWidth: 2.5 },
        })
      }
    }
    return [...result, ...gateEdges]
  }, [provinces, focusedStateId, gateEdges])

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
      {focusedStateId && (
        <button
          className="absolute top-3 left-3 z-20 rounded bg-gray-700 px-3 py-1.5 text-sm text-white hover:bg-gray-600"
          onClick={exitToStateMap}
        >
          ← State Map
        </button>
      )}
      {/* Background image layer */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${getProvinceMapBackground(focusedStateId as string | undefined)})`,
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
