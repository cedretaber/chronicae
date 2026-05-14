import { useState } from 'react'
import { ConfigPanel } from './ConfigPanel'
import { useSimulationStore } from '@/app/stores/simulationStore'

export function ControlBar() {
  const session = useSimulationStore((s) => s.session)
  const isRunning = useSimulationStore((s) => s.isRunning)
  const speed = useSimulationStore((s) => s.speed)
  const generateNewWorld = useSimulationStore((s) => s.generateNewWorld)
  const resetWorld = useSimulationStore((s) => s.resetWorld)
  const tickOnce = useSimulationStore((s) => s.tickOnce)
  const tickYear = useSimulationStore((s) => s.tickYear)
  const setRunning = useSimulationStore((s) => s.setRunning)
  const setSpeed = useSimulationStore((s) => s.setSpeed)

  const currentYear = session?.currentState.currentYear ?? null
  const currentMonth = session?.currentState.currentMonth ?? null
  const [seedInput, setSeedInput] = useState(session?.initialSeed ?? 'chronicae-default')

  return (
    <div className="flex h-12 w-full items-center gap-2 bg-gray-900 px-4 py-2 text-white">
      <span className="text-lg font-bold">Chronicae</span>

      <span className="min-w-36">
        {currentYear != null && currentMonth != null
          ? `Year ${currentYear} / Month ${currentMonth}`
          : '---'}
      </span>

      <button onClick={resetWorld} title="Reset world">
        ⏮
      </button>
      <button disabled className="cursor-not-allowed text-gray-500" title="Cannot go back">
        ◀
      </button>
      <button onClick={() => setRunning(!isRunning)} title={isRunning ? 'Pause' : 'Play'}>
        {isRunning ? '⏸' : '▶'}
      </button>
      <button onClick={tickOnce} title="Advance 1 month">
        ▶|
      </button>
      <button onClick={tickYear} title="Advance 1 year">
        ▶▶|
      </button>

      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="rounded bg-gray-800 px-1 py-0.5"
      >
        <option value={1}>1x</option>
        <option value={2}>2x</option>
        <option value={4}>4x</option>
        <option value={8}>8x</option>
      </select>

      <span>Seed:</span>
      <input
        type="text"
        value={seedInput}
        onChange={(e) => setSeedInput(e.target.value)}
        placeholder="Enter seed"
        className="w-40 rounded bg-gray-800 px-2 py-0.5 text-white"
      />
      <button
        onClick={() => {
          if (seedInput) generateNewWorld(seedInput)
        }}
        className="rounded bg-gray-700 px-3 py-1 hover:bg-gray-600"
      >
        Generate
      </button>

      <div className="relative ml-auto">
        <ConfigPanel />
      </div>
    </div>
  )
}
