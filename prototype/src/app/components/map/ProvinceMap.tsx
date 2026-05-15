import { useMemo } from 'react'
import { ReactFlow, Controls, type Node, type Edge, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { buildCountryColorMap } from '@/app/utils/countryColors'
import type { CountryId, HouseId, ProvinceId } from '@/sim/types/ids'
import { getProvincePops } from '@/sim/selectors/popSelectors'
import { ProvinceNode, type ProvinceNodeData } from './ProvinceNode'
import { MAP_ICON_CONFIG } from '@/app/constants/mapConstants'
import mapBackground from '@/assets/map/map-background.png'

const nodeTypes: NodeTypes = { province: ProvinceNode }

export function ProvinceMap() {
  const session = useSimulationStore((s) => s.session)
  const selectedId = useSimulationStore((s) => s.selectedId)
  const selectedType = useSimulationStore((s) => s.selectedType)
  const setSelected = useSimulationStore((s) => s.setSelected)
  const clearSelected = useSimulationStore((s) => s.clearSelected)

  const provinces = session?.currentState.provinces
  const countries = session?.currentState.countries
  const houses = session?.currentState.houses

  const countryColorMap = useMemo(() => {
    if (!countries) return {}
    return buildCountryColorMap(Object.keys(countries))
  }, [countries])

  // Convert provinces to React Flow nodes
  const nodes = useMemo(() => {
    if (!provinces) return []

    const popGroups = session?.currentState.popGroups
    const isCountrySelected = selectedType === 'country'
    const isHouseSelected = selectedType === 'house'
    const anyEntityHighlighted = isCountrySelected || isHouseSelected

    const selectedCountry =
      isCountrySelected && selectedId && countries
        ? countries[selectedId as unknown as CountryId]
        : undefined
    const selectedHouse =
      isHouseSelected && selectedId && houses ? houses[selectedId as unknown as HouseId] : undefined

    const capitalProvinceIds = new Set<string>(
      Object.values(countries ?? {}).map((c) => c.capitalProvinceId),
    )
    const seatProvinceIds = new Set<string>(
      Object.values(houses ?? {}).map((h) => h.seatProvinceId),
    )

    const houseProvinceSet = new Set(
      (selectedHouse?.provinceIds ?? []).map((id: ProvinceId) => id as string),
    )
    const capitalProvinceId = selectedCountry?.capitalProvinceId
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

      const isDimmed =
        anyEntityHighlighted &&
        province.id !== capitalProvinceId &&
        province.id !== seatProvinceId &&
        (isCountrySelected ? province.countryId !== selectedId : !houseProvinceSet.has(province.id))

      const isSelected = selectedId === province.id && selectedType === 'province'

      return {
        id: province.id,
        type: 'province',
        position: { x: province.x, y: province.y },
        data: {
          label: province.name,
          isUrban,
          isCapital,
          isSeat,
          countryColor: countryColorMap[province.countryId] ?? '#888',
          isDimmed,
          isSelected,
        } satisfies ProvinceNodeData,
      }
    })
  }, [provinces, countryColorMap, selectedId, selectedType, countries, houses, session])

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
    setSelected(node.id, 'province')
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
      {/* Clear button */}
      {selectedId && (
        <button
          className="absolute top-2 right-2 z-20 rounded bg-gray-800/80 px-2 py-1 text-xs text-white hover:bg-gray-700"
          onClick={clearSelected}
        >
          ✕ Clear
        </button>
      )}
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
