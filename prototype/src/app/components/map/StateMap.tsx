import { useSimulationStore } from '@/app/stores/simulationStore'
import { StateMapSvg } from './StateMapSvg'
import stateMapBackground from '@/assets/map/state-map-background.png'
import { MAP_ICON_CONFIG } from '@/app/constants/mapConstants'

export function StateMap() {
  const session = useSimulationStore((s) => s.session)

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">No world loaded</div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${stateMapBackground})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: MAP_ICON_CONFIG.backgroundOpacity,
        }}
      />
      <div className="relative z-10 h-full w-full">
        <StateMapSvg />
      </div>
    </div>
  )
}
