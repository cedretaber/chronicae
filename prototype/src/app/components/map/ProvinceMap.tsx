import { useMemo } from 'react'
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { buildCountryColorMap } from '@/app/utils/countryColors'

export function ProvinceMap() {
  const session = useSimulationStore((s) => s.session)
  const selectedId = useSimulationStore((s) => s.selectedId)
  const selectedType = useSimulationStore((s) => s.selectedType)
  const setSelected = useSimulationStore((s) => s.setSelected)

  const provinces = session?.currentState.provinces
  const countries = session?.currentState.countries

  const countryColorMap = useMemo(() => {
    if (!countries) return {}
    return buildCountryColorMap(Object.keys(countries))
  }, [countries])

  const highlightedCountryId = selectedType === 'country' && selectedId ? selectedId : null

  // Convert provinces to React Flow nodes
  const nodes: Node[] = useMemo(() => {
    if (!provinces) return []
    return Object.values(provinces).map((province) => ({
      id: province.id,
      position: { x: province.x, y: province.y },
      data: {
        label: province.name,
        countryId: province.countryId,
        selected: selectedId === province.id,
      },
      style: {
        background: countryColorMap[province.countryId] ?? '#888',
        color: '#fff',
        border:
          selectedId === province.id
            ? '3px solid yellow'
            : highlightedCountryId === province.countryId
              ? '2px solid white'
              : '1px solid #666',
        opacity: highlightedCountryId && highlightedCountryId !== province.countryId ? 0.4 : 1,
        borderRadius: '6px',
        padding: '4px 8px',
        fontSize: '11px',
        width: 90,
      },
    }))
  }, [provinces, countryColorMap, selectedId, highlightedCountryId])

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
    <div className="h-full w-full">
      <ReactFlow nodes={nodes} edges={edges} fitView onNodeClick={handleNodeClick}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
