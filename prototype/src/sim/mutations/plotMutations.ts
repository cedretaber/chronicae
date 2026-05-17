import type { PlotId } from '../types/ids'
import type { Plot } from '../types/plot'
import type { WorldState } from '../types/world'
import type { StateResult } from './result'
import { ok, err } from './result'

export function addPlot(state: WorldState, plot: Plot): StateResult {
  if (state.activePlots[plot.id])
    return err({
      code: 'INTEGRITY_VIOLATION',
      message: 'addPlot: plot already exists: ' + plot.id,
    })

  return ok({ ...state, activePlots: { ...state.activePlots, [plot.id]: plot } })
}

export function removePlot(state: WorldState, plotId: PlotId): StateResult {
  if (!state.activePlots[plotId]) return ok(state)

  const newPlots = { ...state.activePlots }
  delete newPlots[plotId]
  return ok({ ...state, activePlots: newPlots })
}

export function resolvePlot(state: WorldState, plotId: PlotId): StateResult {
  if (!state.activePlots[plotId])
    return err({
      code: 'INTEGRITY_VIOLATION',
      message: 'resolvePlot: plot not found: ' + plotId,
    })

  const newPlots: Record<PlotId, Plot> = { ...state.activePlots }
  delete newPlots[plotId]
  return ok({ ...state, activePlots: newPlots })
}
