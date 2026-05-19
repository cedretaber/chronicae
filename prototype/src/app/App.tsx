import { ControlBar } from './components/controls/ControlBar'
import { ProvinceMap } from './components/map/ProvinceMap'
import { MapViewSwitcher } from './components/map/MapViewSwitcher'
import { Sidebar } from './components/panels/Sidebar'
import { DetailPanel } from './components/panels/DetailPanel'
import { EventLog } from './components/logs/EventLog'
import { NotificationOverlay } from './components/notifications/NotificationOverlay'

export function App() {
  return (
    <div className="flex h-screen flex-col bg-gray-950 text-white">
      <ControlBar />
      <div className="flex flex-1 overflow-hidden">
        <MapViewSwitcher />
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1">
              <ProvinceMap />
            </div>
            <Sidebar />
            <DetailPanel />
          </div>
          <EventLog />
        </div>
      </div>
      <NotificationOverlay />
    </div>
  )
}
