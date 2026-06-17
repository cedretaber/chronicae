import { useSimulationStore, type MapView } from '@/app/stores/simulationStore'
import { CHROME } from '@/app/theme/chrome'

const VIEWS: { key: MapView; label: string; tooltip: string }[] = [
  { key: 'terminal', label: 'T', tooltip: 'Terminal polity (実効領主)' },
  { key: 'root', label: 'R', tooltip: 'Root polity (宗主)' },
  { key: 'house', label: 'H', tooltip: 'Owner house' },
  { key: 'influence', label: '%', tooltip: 'House influence' },
  { key: 'unrest', label: '!', tooltip: 'Unrest heatmap' },
]

export function MapViewSwitcher() {
  const mapView = useSimulationStore((s) => s.mapView)
  const setMapView = useSimulationStore((s) => s.setMapView)
  return (
    <div className="flex w-12 flex-col items-stretch border-r border-gray-800 bg-gray-900">
      {VIEWS.map((v) => {
        const active = v.key === mapView
        return (
          <button
            key={v.key}
            className={`flex h-12 items-center justify-center text-sm font-bold transition-colors ${
              active ? 'text-white' : 'text-gray-300 hover:bg-gray-700'
            }`}
            style={active ? { backgroundColor: CHROME.accentFill } : undefined}
            onClick={() => setMapView(v.key)}
            aria-pressed={active}
            title={v.tooltip}
          >
            {v.label}
          </button>
        )
      })}
    </div>
  )
}
