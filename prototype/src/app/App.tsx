import { ControlBar } from './components/controls/ControlBar'
import { UnifiedMap } from './components/map/UnifiedMap'
import { MapViewSwitcher } from './components/map/MapViewSwitcher'
import { Sidebar } from './components/panels/Sidebar'
import { EventLog } from './components/logs/EventLog'
import { WindowManager } from './components/windows/WindowManager'
import { FamilyTreeWindow } from './components/windows/FamilyTreeWindow'

export function App() {
  return (
    <div className="flex h-screen flex-col bg-gray-950 text-white">
      <ControlBar />
      <div className="flex flex-1 overflow-hidden">
        <MapViewSwitcher />
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1">
              <UnifiedMap />
            </div>
            <Sidebar />
          </div>
          <EventLog />
        </div>
      </div>
      <FamilyTreeWindow />
      <WindowManager />
    </div>
  )
}
