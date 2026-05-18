import { Handle, Position, type NodeProps } from '@xyflow/react'
import provinceCastleIcon from '@/assets/map/badge-castle.png'
import provinceManorIcon from '@/assets/map/badge-manor.png'
import provinceUrbanIcon from '@/assets/map/province-urban.png'
import provinceRuralIcon from '@/assets/map/province-rural.png'
import { MAP_ICON_CONFIG } from '@/app/constants/mapConstants'

export type ProvinceNodeData = {
  label: string
  isUrban: boolean
  isCapital: boolean
  isSeat: boolean
  polityColor: string
  isDimmed: boolean
  isSelected: boolean
}

export function ProvinceNode({ data }: NodeProps) {
  const { label, isUrban, isCapital, isSeat, polityColor, isDimmed, isSelected } =
    data as ProvinceNodeData

  return (
    <div
      style={{
        position: 'relative',
        width: MAP_ICON_CONFIG.provinceIconSize,
        opacity: isDimmed ? 0.35 : 1,
      }}
    >
      {/* Handles on all 4 sides for edges */}
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

      {/* Province icon */}
      <div
        style={{
          position: 'relative',
          width: MAP_ICON_CONFIG.provinceIconSize,
          height: MAP_ICON_CONFIG.provinceIconSize,
          overflow: 'visible',
        }}
      >
        <img
          src={isUrban ? provinceUrbanIcon : provinceRuralIcon}
          alt={label}
          width={MAP_ICON_CONFIG.provinceIconSize}
          height={MAP_ICON_CONFIG.provinceIconSize}
          style={{ display: 'block' }}
          draggable={false}
        />
        {/* Castle badge — bottom-right */}
        {isCapital && (
          <img
            src={provinceCastleIcon}
            alt=""
            width={MAP_ICON_CONFIG.provinceBadgeSize}
            height={MAP_ICON_CONFIG.provinceBadgeSize}
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.5)',
            }}
            draggable={false}
          />
        )}
        {/* Manor badge — bottom-left when both, bottom-right when only seat */}
        {isSeat && (
          <img
            src={provinceManorIcon}
            alt=""
            width={MAP_ICON_CONFIG.provinceBadgeSize}
            height={MAP_ICON_CONFIG.provinceBadgeSize}
            style={{
              position: 'absolute',
              bottom: 0,
              ...(isCapital ? { left: 0 } : { right: 0 }),
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.5)',
            }}
            draggable={false}
          />
        )}
        {/* Label — overlaid at bottom-center of the icon */}
        <span
          style={{
            position: 'absolute',
            bottom: 6,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 10,
            color: '#fff',
            backgroundColor: polityColor,
            padding: '1px 4px',
            borderRadius: 3,
            outline: isSelected ? '2px solid yellow' : 'none',
            outlineOffset: 1,
            whiteSpace: 'nowrap',
            maxWidth: 90,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          {label}
        </span>
      </div>
    </div>
  )
}
