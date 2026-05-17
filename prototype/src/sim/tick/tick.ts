import {
  type TickInput,
  type TickResult,
  type TickContext,
  createTickContext,
  toResult,
} from './context'
import { advanceTime } from './advanceTime'
import { runDevelopmentSystem } from './developmentSystem'
import { runEconomySystem } from './economySystem'
import { runDisasterSystem } from './disasterSystem'
import { runMortalitySystem } from './mortalitySystem'
import { runSuccessionSystem } from './successionSystem'
import { runMarriageSystem } from './marriageSystem'
import { runBirthSystem } from './birthSystem'
import { runAppointmentSystem } from './appointmentSystem'
import { runShareUpdateSystem } from './shareUpdateSystem'
import { runOfficeCompensationSystem } from './officeCompensationSystem'
import { runAmbitionSystem } from './ambitionSystem'
import { runPublicSpendingSystem } from './publicSpendingSystem'
import { runHouseDevelopmentSystem } from './houseDevelopmentSystem'
import { runControlSystem } from './controlSystem'
import { runLordshipTransitionSystem } from './lordshipTransitionSystem'
import { runPlotSystem } from './plotSystem'
import { runWarSystem } from './warSystem'
import { runProvinceRevoltSystem } from './provinceRevoltSystem'
import { runRebellionSystem } from './rebellionSystem'
import { runAttitudeDecaySystem } from './attitudeDecaySystem'
import { runGovernanceSystem } from './governanceSystem'
import { runIntegritySystem } from './integritySystem'
import { runPopSystem, normalizePopSizes } from './popSystem'
import { runPopDevelopmentSystem } from './popDevelopmentSystem'
import { runPersonGrowthSystem } from './personGrowthSystem'
import { runEstateSettlementSystem } from './estateSettlementSystem'
import { createLogger } from '../debug/logger'

export function tick(input: TickInput): TickResult {
  let ctx = createTickContext(input)
  const log = createLogger(ctx.config.debug)
  const debug = ctx.config.debug
  const tickStart = performance.now()

  const run = (label: string, fn: (c: TickContext) => TickContext): void => {
    if (debug) {
      const t0 = performance.now()
      ctx = fn(ctx)
      log.perf(label, performance.now() - t0)
    } else {
      ctx = fn(ctx)
    }
  }

  run('advanceTime', advanceTime)
  run('developmentSystem', runDevelopmentSystem)
  run('controlSystem', runControlSystem)
  run('lordshipTransitionSystem', runLordshipTransitionSystem)
  run('popSystem', runPopSystem)
  run('economySystem', runEconomySystem)
  run('disasterSystem', runDisasterSystem)
  run('mortalitySystem', runMortalitySystem)
  run('estateSettlementSystem', runEstateSettlementSystem)
  run('successionSystem', runSuccessionSystem)
  run('marriageSystem', runMarriageSystem)
  run('birthSystem', runBirthSystem)
  run('shareUpdateSystem', runShareUpdateSystem)
  run('appointmentSystem', runAppointmentSystem)
  run('officeCompensationSystem', runOfficeCompensationSystem)
  run('personGrowthSystem', runPersonGrowthSystem)
  run('ambitionSystem', runAmbitionSystem)
  run('publicSpendingSystem', runPublicSpendingSystem)
  run('houseDevelopmentSystem', runHouseDevelopmentSystem)
  run('popDevelopmentSystem', runPopDevelopmentSystem)
  run('plotSystem', runPlotSystem)
  run('warSystem', runWarSystem)
  run('provinceRevoltSystem', runProvinceRevoltSystem)
  run('rebellionSystem', runRebellionSystem)
  run('attitudeDecaySystem', runAttitudeDecaySystem)
  run('governanceSystem', runGovernanceSystem)
  run('normalizePopSizes', normalizePopSizes)

  if (debug) {
    try {
      run('integrityCheck', runIntegritySystem)
    } catch (e) {
      log.log('INTEGRITY', { error: String(e) })
    }
    log.perf('tick:total', performance.now() - tickStart)
  } else {
    ctx = runIntegritySystem(ctx)
  }

  return toResult(ctx)
}
