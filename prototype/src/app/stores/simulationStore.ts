import { create } from 'zustand'
import { tick } from '@sim/tick/tick'
import { generateWorld } from '@sim/worldgen/generateWorld'
import { defaultConfig } from '@sim/config/defaultConfig'
import type { SimulationSession } from '@sim/types/world'
import type { SimulationConfig } from '@sim/config/defaultConfig'

export type EntityType = 'polity' | 'house' | 'person' | 'province' | 'popGroup' | 'faction'
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
  pendingNotifications: { id: string; message: string; timestamp: number }[]
}

type SimActions = {
  generateNewWorld: (seed: string) => void
  resetWorld: () => void
  tickOnce: () => void
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
  dismissNotification: (id: string) => void
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

export const useSimulationStore = create<SimStore>((set, get) => ({
  session: null,
  isRunning: false,
  speed: 1,
  mapView: 'terminal',
  openWindows: [],
  nextZIndex: 1,
  watchlist: [],
  config: { ...defaultConfig },
  pendingNotifications: [],

  generateNewWorld: (seed: string) => {
    const { world, rng } = generateWorld(seed)
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
    const { world, rng } = generateWorld(currentSession.initialSeed)
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

    const input = {
      state: currentSession.currentState,
      rng: currentSession.rng,
      config,
    }
    const result = tick(input)

    const newNotifications = result.events
      .filter((e) => e.importance === 'critical')
      .map((e) => ({ id: e.id, message: e.summary, timestamp: Date.now() }))

    const allEvents = [...currentSession.eventHistory, ...result.events]
    const cappedEvents =
      allEvents.length > config.maxRawEvents
        ? allEvents.slice(allEvents.length - config.maxRawEvents)
        : allEvents

    const combined = [...get().pendingNotifications, ...newNotifications]
    const cappedNotifications = combined.length > 5 ? combined.slice(combined.length - 5) : combined

    set({
      session: {
        ...currentSession,
        currentState: result.state,
        rng: result.rng,
        eventHistory: cappedEvents,
      },
      pendingNotifications: cappedNotifications,
    })
  },

  tickYear: () => {
    for (let i = 0; i < 12; i++) {
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

  dismissNotification: (id) => {
    set((state) => ({
      pendingNotifications: state.pendingNotifications.filter((n) => n.id !== id),
    }))
  },
}))

// Initialize by generating a default world
useSimulationStore.getState().generateNewWorld('chronicae-default')
