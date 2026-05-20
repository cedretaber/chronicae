import { useMemo } from 'react'
import { ReactFlow, Controls, type Node, type Edge, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { buildPolityColorMap } from '@/app/utils/polityColors'
import type { StateRegionId } from '@/sim/types/ids'
import {
  getStateNeighborIds,
  getStateDominantPolityId,
  getStatePopulation,
  getStateAverageUnrest,
} from '@/sim/selectors/stateRegionSelectors'
import { StateNode, type StateNodeData } from './StateNode'

const nodeTypes: NodeTypes = { stateRegion: StateNode }
const STATE_NODE_SPACING = 250

export function StateMap() {
  const session = useSimulationStore((s) => s.session)
  const focusState = useSimulationStore((s) => s.focusState)

  const polities = session?.currentState.polities
  const polityColorMap = useMemo(() => {
    if (!polities) return {}
    return buildPolityColorMap(Object.keys(polities))
  }, [polities])

  const nodes: Node[] = useMemo(() => {
    if (!session) return []
    const world = session.currentState
    return Object.values(world.states)
      .map((stateRegion) => {
        if (!stateRegion) return null
        const dominantPolityId = getStateDominantPolityId(world, stateRegion.id)
        const color = dominantPolityId ? (polityColorMap[dominantPolityId] ?? '#888') : '#888'
        const population = getStatePopulation(world, stateRegion.id)
        const averageUnrest = getStateAverageUnrest(world, stateRegion.id)
        return {
          id: stateRegion.id,
          type: 'stateRegion',
          position: {
            x: stateRegion.gridCol * STATE_NODE_SPACING,
            y: stateRegion.gridRow * STATE_NODE_SPACING,
          },
          data: {
            label: stateRegion.name,
            provinceCount: stateRegion.provinceIds.length,
            dominantPolityColor: color,
            population,
            averageUnrest,
          } satisfies StateNodeData,
        }
      })
      .filter((n): n is NonNullable<typeof n> => n !== null)
  }, [session, polityColorMap])

  const edges: Edge[] = useMemo(() => {
    if (!session) return []
    const world = session.currentState
    const edgeSet = new Set<string>()
    const result: Edge[] = []
    for (const stateRegion of Object.values(world.states)) {
      if (!stateRegion) continue
      const neighborIds = getStateNeighborIds(world, stateRegion.id)
      for (const nid of neighborIds) {
        const a = stateRegion.id as string
        const b = nid as string
        if (a >= b) continue
        const edgeId = `se-${a}-${b}`
        if (edgeSet.has(edgeId)) continue
        edgeSet.add(edgeId)
        result.push({
          id: edgeId,
          source: stateRegion.id,
          target: nid,
          type: 'straight',
          style: { stroke: '#78716c', strokeWidth: 3 },
        })
      }
    }
    return result
  }, [session])

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    focusState(node.id as StateRegionId)
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">No world loaded</div>
    )
  }

  return (
    <div className="relative h-full w-full">
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
