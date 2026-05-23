import { create } from 'zustand'
import { tick } from '@sim/tick/tick'
import { generateWorld } from '@sim/worldgen/generateWorld'
import { defaultConfig } from '@sim/config/defaultConfig'
import type { SimulationSession } from '@sim/types/world'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { WorldPresetName } from '@sim/worldgen/worldPresets'
import YAML from 'yaml'
import { createNamePoolService } from '@sim/namegen/namePoolService'
import type { NamePoolService } from '@sim/namegen/namePoolTypes'

export type EntityType =
  | 'polity'
  | 'house'
  | 'person'
  | 'province'
  | 'popGroup'
  | 'faction'
  | 'diplomaticPlay'
// Backwards-friendly alias retained as named export (some modules import SelectedType)
export type SelectedType = EntityType
export type MapView = 'terminal' | 'root' | 'house' | 'share' | 'unrest'

export type DetailWindow = {
  id: string
  entityType: EntityType
  entityId: string
  position: { x: number; y: number }
  zIndex: number
}

type SimState = {
  session: SimulationSession | null
  isRunning: boolean
  speed: number
  mapView: MapView
  openWindows: DetailWindow[]
  nextZIndex: number
  watchlist: string[]
  config: SimulationConfig
}

type SimActions = {
  generateNewWorld: (seed: string, preset?: WorldPresetName) => void
  resetWorld: () => void
  tickOnce: () => void
  tickMonth: () => void
  tickYear: () => void
  setRunning: (running: boolean) => void
  setSpeed: (speed: number) => void
  setMapView: (view: MapView) => void
  openDetailWindow: (entityType: EntityType, entityId: string) => void
  closeDetailWindow: (windowId: string) => void
  focusDetailWindow: (windowId: string) => void
  moveDetailWindow: (windowId: string, position: { x: number; y: number }) => void
  toggleWatchlist: (id: string) => void
  setConfig: (partial: Partial<SimulationConfig>) => void
}

type SimStore = SimState & SimActions

let intervalId: ReturnType<typeof setInterval> | null = null

function computeIntervalMs(speed: number): number {
  return Math.floor(1000 / speed)
}

function stopInterval(): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

const WINDOW_CASCADE_STEP = 24
const WINDOW_INITIAL_X = 300
const WINDOW_INITIAL_Y = 80
// 360px window width 想定で、おおむね右端を超えない位置に折り返す
const WINDOW_MAX_X = 600

// Lazy NamePoolService initialization
let _namePoolService: NamePoolService | null = null

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
const namePoolsRaw = import.meta.glob('../../sim/namegen/namePools.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function getNamePoolService(): NamePoolService {
  if (!_namePoolService) {
    const yamlStr = Object.values(namePoolsRaw)[0]
    if (!yamlStr) throw new Error('namePools.yaml not found')
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data: import('@sim/namegen/namePoolTypes').NamePoolData = YAML.parse(yamlStr)
    _namePoolService = createNamePoolService(data)
  }
  return _namePoolService
}

export const useSimulationStore = create<SimStore>((set, get) => ({
  session: null,
  isRunning: false,
  speed: 1,
  mapView: 'terminal',
  openWindows: [],
  nextZIndex: 1,
  watchlist: [],
  config: { ...defaultConfig },

  generateNewWorld: (seed: string, preset?: WorldPresetName) => {
    const nps = getNamePoolService()
    const { world, rng } = generateWorld(seed, preset, nps)
    const session: SimulationSession = {
      initialSeed: seed,
      currentState: world,
      rng,
      eventHistory: [],
    }
    set({ session })
  },

  resetWorld: () => {
    const { session: currentSession } = get()
    if (!currentSession) return
    const nps = getNamePoolService()
    const { world, rng } = generateWorld(currentSession.initialSeed, undefined, nps)
    const session: SimulationSession = {
      initialSeed: currentSession.initialSeed,
      currentState: world,
      rng,
      eventHistory: [],
    }
    set({ session })
  },

  tickOnce: () => {
    const { session: currentSession, config } = get()
    if (!currentSession) return

    const nps = getNamePoolService()
    const input = {
      state: currentSession.currentState,
      rng: currentSession.rng,
      config,
      namePoolService: nps,
    }
    const result = tick(input)

    const allEvents = [...currentSession.eventHistory, ...result.events]
    const cappedEvents =
      allEvents.length > config.maxRawEvents
        ? allEvents.slice(allEvents.length - config.maxRawEvents)
        : allEvents

    set({
      session: {
        ...currentSession,
        currentState: result.state,
        rng: result.rng,
        eventHistory: cappedEvents,
      },
    })
  },

  tickMonth: () => {
    for (let i = 0; i < 4; i++) {
      get().tickOnce()
    }
  },

  tickYear: () => {
    for (let i = 0; i < 48; i++) {
      get().tickOnce()
    }
  },

  setRunning: (running: boolean) => {
    set({ isRunning: running })
    if (running) {
      const speed = get().speed
      stopInterval()
      intervalId = setInterval(() => {
        get().tickOnce()
      }, computeIntervalMs(speed))
    } else {
      stopInterval()
    }
  },

  setSpeed: (speed: number) => {
    set({ speed })
    if (get().isRunning) {
      const newSpeed = speed
      stopInterval()
      intervalId = setInterval(() => {
        get().tickOnce()
      }, computeIntervalMs(newSpeed))
    }
  },

  setMapView: (view) => {
    set({ mapView: view })
  },

  openDetailWindow: (entityType, entityId) => {
    const windowId = `${entityType}:${entityId}`
    const { openWindows, nextZIndex } = get()
    const existing = openWindows.find((w) => w.id === windowId)
    if (existing) {
      // bring-to-front
      set({
        openWindows: openWindows.map((w) => (w.id === windowId ? { ...w, zIndex: nextZIndex } : w)),
        nextZIndex: nextZIndex + 1,
      })
      return
    }
    // cascade: 最後に focus されたウィンドウから +step, +step。窓ゼロなら initial 位置
    const topWindow =
      openWindows.length > 0
        ? openWindows.reduce((a, b) => (a.zIndex >= b.zIndex ? a : b))
        : undefined
    let x = WINDOW_INITIAL_X
    let y = WINDOW_INITIAL_Y
    if (topWindow) {
      x = topWindow.position.x + WINDOW_CASCADE_STEP
      y = topWindow.position.y + WINDOW_CASCADE_STEP
      if (x > WINDOW_MAX_X) x = 16
      if (y > 360) y = 60
    }
    const win: DetailWindow = {
      id: windowId,
      entityType,
      entityId,
      position: { x, y },
      zIndex: nextZIndex,
    }
    set({ openWindows: [...openWindows, win], nextZIndex: nextZIndex + 1 })
  },

  closeDetailWindow: (windowId) => {
    set((state) => ({ openWindows: state.openWindows.filter((w) => w.id !== windowId) }))
  },

  focusDetailWindow: (windowId) => {
    const { openWindows, nextZIndex } = get()
    const target = openWindows.find((w) => w.id === windowId)
    if (!target) return
    if (target.zIndex === nextZIndex - 1) return
    set({
      openWindows: openWindows.map((w) => (w.id === windowId ? { ...w, zIndex: nextZIndex } : w)),
      nextZIndex: nextZIndex + 1,
    })
  },

  moveDetailWindow: (windowId, position) => {
    set((state) => ({
      openWindows: state.openWindows.map((w) => (w.id === windowId ? { ...w, position } : w)),
    }))
  },

  toggleWatchlist: (id: string) => {
    const { watchlist } = get()
    const isWatching = watchlist.includes(id)
    set({
      watchlist: isWatching ? watchlist.filter((wid) => wid !== id) : [...watchlist, id],
    })
  },

  setConfig: (partial) => set((state) => ({ config: { ...state.config, ...partial } })),
}))

// Initialize by generating a default world
useSimulationStore.getState().generateNewWorld('chronicae-default')
