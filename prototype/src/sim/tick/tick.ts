import { type TickInput, type TickResult, createTickContext, toResult } from './context'
import { advanceTime } from './advanceTime'
import { runDevelopmentSystem } from './developmentSystem'
import { runEconomySystem } from './economySystem'
import { runDisasterSystem } from './disasterSystem'
import { runMortalitySystem } from './mortalitySystem'
import { runSuccessionSystem } from './successionSystem'
import { runMarriageSystem } from './marriageSystem'
import { runBirthSystem } from './birthSystem'
import { runAppointmentSystem } from './appointmentSystem'
import { runAmbitionSystem } from './ambitionSystem'
import { runPublicSpendingSystem } from './publicSpendingSystem'
import { runHouseDevelopmentSystem } from './houseDevelopmentSystem'
import { runControlSystem } from './controlSystem'
import { runLordshipTransitionSystem } from './lordshipTransitionSystem'
import { runPlotSystem } from './plotSystem'
import { runWarSystem } from './warSystem'
import { runRebellionSystem } from './rebellionSystem'
import { runStabilitySystem } from './stabilitySystem'
import { runGovernanceSystem } from './governanceSystem'
import { runIntegrityCheck } from './integritySystem'

export function tick(input: TickInput): TickResult {
  let ctx = createTickContext(input)
  ctx = advanceTime(ctx)
  ctx = runDevelopmentSystem(ctx)
  ctx = runControlSystem(ctx)
  ctx = runLordshipTransitionSystem(ctx)
  ctx = runEconomySystem(ctx)
  ctx = runDisasterSystem(ctx)
  ctx = runMortalitySystem(ctx)
  ctx = runSuccessionSystem(ctx)
  ctx = runMarriageSystem(ctx)
  ctx = runBirthSystem(ctx)
  ctx = runAppointmentSystem(ctx)
  ctx = runAmbitionSystem(ctx)
  ctx = runPublicSpendingSystem(ctx)
  ctx = runHouseDevelopmentSystem(ctx)
  ctx = runPlotSystem(ctx)
  ctx = runWarSystem(ctx)
  ctx = runRebellionSystem(ctx)
  ctx = runStabilitySystem(ctx)
  ctx = runGovernanceSystem(ctx)
  if (ctx.config.debug) {
    try {
      ctx = runIntegrityCheck(ctx)
    } catch (e) {
      process.stdout.write('[INTEGRITY FAIL] ' + String(e) + '\n')
    }
  } else {
    ctx = runIntegrityCheck(ctx)
  }
  return toResult(ctx)
}
