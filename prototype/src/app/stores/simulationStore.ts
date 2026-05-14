import { create } from 'zustand'
import { tick } from '@sim/tick/tick'
import { generateWorld } from '@sim/worldgen/generateWorld'
import { defaultConfig } from '@sim/config/defaultConfig'
import type { SimulationSession } from '@sim/types/world'
import type { SimulationConfig } from '@sim/config/defaultConfig'

type SelectedType = 'country' | 'house' | 'person' | 'province'

type SimState = {
  session: SimulationSession | null
  isRunning: boolean
  speed: number
  selectedId: string | null
  selectedType: SelectedType | null
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
  setSelected: (id: string, type: SelectedType) => void
  clearSelected: () => void
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

export const useSimulationStore = create<SimStore>((set, get) => ({
  session: null,
  isRunning: false,
  speed: 1,
  selectedId: null,
  selectedType: null,
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

  setSelected: (id: string, type: SelectedType) => {
    set({ selectedId: id, selectedType: type })
  },

  clearSelected: () => {
    set({ selectedId: null, selectedType: null })
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
