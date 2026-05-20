import { Handle, Position, type NodeProps } from '@xyflow/react'

export type StateNodeData = {
  label: string
  provinceCount: number
  dominantPolityColor: string
  population: number
  averageUnrest: number
}

export function StateNode({ data }: NodeProps) {
  const { label, provinceCount, dominantPolityColor, population, averageUnrest } =
    data as StateNodeData

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        border: `3px solid ${dominantPolityColor}`,
        backgroundColor: '#1a1a2e',
        color: '#fff',
        minWidth: 140,
        cursor: 'pointer',
        textAlign: 'center',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} isConnectable={false} />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0 }}
        isConnectable={false}
      />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} isConnectable={false} />
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0 }}
        isConnectable={false}
      />
      <div style={{ fontWeight: 'bold', fontSize: 14, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#aaa' }}>
        {provinceCount} provinces · pop {Math.round(population)}
      </div>
      <div style={{ fontSize: 10, color: averageUnrest > 40 ? '#f87171' : '#6b7280' }}>
        unrest {averageUnrest.toFixed(0)}
      </div>
    </div>
  )
}
