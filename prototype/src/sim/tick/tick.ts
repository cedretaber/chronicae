import { type TickInput, type TickResult, createTickContext, toResult } from './context'
import { advanceTime } from './advanceTime'
import { runEconomySystem } from './economySystem'
import { runMortalitySystem } from './mortalitySystem'
import { runEmergenceSystem } from './emergenceSystem'
import { runSuccessionSystem } from './successionSystem'
import { runAppointmentSystem } from './appointmentSystem'
import { runAmbitionSystem } from './ambitionSystem'
import { runPlotSystem } from './plotSystem'
import { runRebellionSystem } from './rebellionSystem'
import { runStabilitySystem } from './stabilitySystem'
import { runGovernanceSystem } from './governanceSystem'
import { runIntegrityCheck } from './integritySystem'

export function tick(input: TickInput): TickResult {
  let ctx = createTickContext(input)
  ctx = advanceTime(ctx)
  ctx = runEconomySystem(ctx)
  ctx = runMortalitySystem(ctx)
  ctx = runEmergenceSystem(ctx)
  ctx = runSuccessionSystem(ctx)
  ctx = runAppointmentSystem(ctx)
  ctx = runAmbitionSystem(ctx)
  ctx = runPlotSystem(ctx)
  ctx = runRebellionSystem(ctx)
  ctx = runStabilitySystem(ctx)
  ctx = runGovernanceSystem(ctx)
  ctx = runIntegrityCheck(ctx)
  return toResult(ctx)
}
