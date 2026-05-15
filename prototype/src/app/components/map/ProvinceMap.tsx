import { useMemo } from 'react'
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { buildCountryColorMap } from '@/app/utils/countryColors'
import type { CountryId, HouseId, ProvinceId } from '@/sim/types/ids'

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
  const nodes: Node[] = useMemo(() => {
    if (!provinces) return []

    const isCountrySelected = selectedType === 'country'
    const isHouseSelected = selectedType === 'house'
    const anyEntityHighlighted = isCountrySelected || isHouseSelected

    const selectedCountry =
      isCountrySelected && selectedId && countries
        ? countries[selectedId as unknown as CountryId]
        : undefined
    const selectedHouse =
      isHouseSelected && selectedId && houses ? houses[selectedId as unknown as HouseId] : undefined

    const houseProvinceSet = new Set(
      (selectedHouse?.provinceIds ?? []).map((id: ProvinceId) => id as string),
    )
    const capitalProvinceId = selectedCountry?.capitalProvinceId
    const seatProvinceId = selectedHouse?.seatProvinceId

    return Object.values(provinces).map((province) => {
      // Determine style based on priority
      let border = '1px solid #666'
      let opacity = 1

      if (selectedId === province.id && selectedType === 'province') {
        // Priority 1: explicitly selected province
        border = '3px solid yellow'
        opacity = 1
      } else if (isCountrySelected && province.id === capitalProvinceId) {
        // Priority 2a: capital of highlighted country
        border = '3px solid #ffd700'
        opacity = 1
      } else if (isHouseSelected && province.id === seatProvinceId) {
        // Priority 2b: seat of highlighted house
        border = '3px solid #ffd700'
        opacity = 1
      } else if (isCountrySelected && province.countryId === selectedId) {
        // Priority 3: in highlighted country
        border = '2px solid white'
        opacity = 1
      } else if (isHouseSelected && houseProvinceSet.has(province.id)) {
        // Priority 4: in highlighted house
        border = '2px solid #22d3ee'
        opacity = 1
      } else if (anyEntityHighlighted) {
        // Priority 5: dimmed due to active highlight
        border = '1px solid #666'
        opacity = 0.4
      }

      const label =
        province.id === capitalProvinceId || province.id === seatProvinceId
          ? `★ ${province.name}`
          : province.name

      return {
        id: province.id,
        position: { x: province.x, y: province.y },
        data: {
          label,
          countryId: province.countryId,
          selected: selectedId === province.id,
        },
        style: {
          background: countryColorMap[province.countryId] ?? '#888',
          color: '#fff',
          border,
          opacity,
          borderRadius: '6px',
          padding: '4px 8px',
          fontSize: '11px',
          width: 90,
        },
      }
    })
  }, [provinces, countryColorMap, selectedId, selectedType, countries, houses])

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
      {selectedId && (
        <button
          className="absolute top-2 right-2 z-10 rounded bg-gray-800/80 px-2 py-1 text-xs text-white hover:bg-gray-700"
          onClick={clearSelected}
        >
          ✕ Clear
        </button>
      )}
      <ReactFlow nodes={nodes} edges={edges} fitView onNodeClick={handleNodeClick}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
