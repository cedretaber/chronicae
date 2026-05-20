import {
  type TickInput,
  type TickResult,
  type TickContext,
  createTickContext,
  toResult,
} from './context'
import { advanceTime } from './advanceTime'
import { runDevelopmentSystem } from './developmentSystem'
import { runLandRevenueSystem } from './landRevenueSystem'
import { runPolitySurplusDistributionSystem } from './politySurplusDistributionSystem'
import { runBailiffAppointmentSystem } from './bailiffAppointmentSystem'
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
import { runPlotSystem } from './plotSystem'
import { runProvinceRevoltSystem } from './provinceRevoltSystem'
import { runDiplomaticPlaySystem } from './diplomaticPlaySystem'
import { runIntentGenerationSystem } from './intentGenerationSystem'
import { runIntentToDiplomaticPlaySystem } from './intentToDiplomaticPlaySystem'
import { runConflictResolutionSystem } from './conflictResolutionSystem'
import { runPolityOwnerConsistencySystem } from './polityOwnerConsistencySystem'
import { runOrganizationConsistencySystem } from './organizationConsistencySystem'
import { runAttitudeDecaySystem } from './attitudeDecaySystem'
import { runGovernanceSystem } from './governanceSystem'
import { runIntegritySystem } from './integritySystem'
import { runPopSystem, normalizePopSizes } from './popSystem'
import { runCleanupTerminalDiplomacy } from './cleanupTerminalDiplomacy'
import { runPopDevelopmentSystem } from './popDevelopmentSystem'
import { runPersonGrowthSystem } from './personGrowthSystem'
import { runEstateSettlementSystem } from './estateSettlementSystem'
import { runHouseSurplusDistributionSystem } from './houseSurplusDistributionSystem'
import { runUnaffiliatedPersonSystem } from './unaffiliatedPersonSystem'
import { runOfficeTermSystem } from './officeTermSystem'
import { runFactionLifecycleSystem } from './factionLifecycleSystem'
import { runFactionMaintenanceSystem } from './factionMaintenanceSystem'
import { runFactionRecruitmentSystem } from './factionRecruitmentSystem'
import { runFactionPatronageSystem } from './factionPatronageSystem'
import { runFactionDefectionSystem } from './factionDefectionSystem'
import { createLogger } from '../debug/logger'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'

type ScheduledSystem = {
  name: string
  intervalWeeks: number
  phaseOffsetWeeks: number
  run: (ctx: TickContext) => TickContext
}

function shouldRun(system: ScheduledSystem, absoluteWeek: number): boolean {
  return (absoluteWeek - system.phaseOffsetWeeks) % system.intervalWeeks === 0
}

const scheduledSystems: ScheduledSystem[] = [
  { name: 'developmentSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runDevelopmentSystem },
  { name: 'controlSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runControlSystem },
  { name: 'popSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runPopSystem },
  { name: 'landRevenueSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runLandRevenueSystem },
  {
    name: 'politySurplusDistributionSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runPolitySurplusDistributionSystem,
  },
  {
    name: 'houseSurplusDistributionSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runHouseSurplusDistributionSystem,
  },
  {
    name: 'disasterSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runDisasterSystem,
  },
  { name: 'mortalitySystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runMortalitySystem },
  {
    name: 'estateSettlementSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runEstateSettlementSystem,
  },
  { name: 'successionSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runSuccessionSystem },
  {
    name: 'marriageSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runMarriageSystem,
  },
  { name: 'birthSystem', intervalWeeks: WEEKS_PER_YEAR, phaseOffsetWeeks: 0, run: runBirthSystem },
  {
    name: 'unaffiliatedPersonSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runUnaffiliatedPersonSystem,
  },
  {
    name: 'officeTermSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runOfficeTermSystem,
  },
  {
    name: 'shareUpdateSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runShareUpdateSystem,
  },
  {
    name: 'appointmentSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runAppointmentSystem,
  },
  {
    name: 'bailiffAppointmentSystem',
    intervalWeeks: 24,
    phaseOffsetWeeks: 0,
    run: runBailiffAppointmentSystem,
  },
  {
    name: 'officeCompensationSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runOfficeCompensationSystem,
  },
  {
    name: 'factionPatronageSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runFactionPatronageSystem,
  },
  {
    name: 'factionDefectionSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runFactionDefectionSystem,
  },
  {
    name: 'factionMaintenanceSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runFactionMaintenanceSystem,
  },
  {
    name: 'factionLifecycleSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runFactionLifecycleSystem,
  },
  {
    name: 'factionRecruitmentSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runFactionRecruitmentSystem,
  },
  {
    name: 'personGrowthSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runPersonGrowthSystem,
  },
  { name: 'ambitionSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runAmbitionSystem },
  {
    name: 'publicSpendingSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runPublicSpendingSystem,
  },
  {
    name: 'houseDevelopmentSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runHouseDevelopmentSystem,
  },
  {
    name: 'popDevelopmentSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runPopDevelopmentSystem,
  },
  { name: 'plotSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runPlotSystem },
  {
    name: 'intentGenerationSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runIntentGenerationSystem,
  },
  {
    name: 'intentToDiplomaticPlaySystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runIntentToDiplomaticPlaySystem,
  },
  {
    name: 'provinceRevoltSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runProvinceRevoltSystem,
  },
  {
    name: 'diplomaticPlaySystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runDiplomaticPlaySystem,
  },
  {
    name: 'conflictResolutionSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runConflictResolutionSystem,
  },
  {
    name: 'polityOwnerConsistencySystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runPolityOwnerConsistencySystem,
  },
  {
    name: 'organizationConsistencySystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runOrganizationConsistencySystem,
  },
  {
    name: 'attitudeDecaySystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runAttitudeDecaySystem,
  },
  {
    name: 'governanceSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runGovernanceSystem,
  },
  { name: 'normalizePopSizes', intervalWeeks: 4, phaseOffsetWeeks: 0, run: normalizePopSizes },
  {
    name: 'cleanupTerminalDiplomacy',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runCleanupTerminalDiplomacy,
  },
]

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

  for (const system of scheduledSystems) {
    if (shouldRun(system, ctx.state.absoluteWeek)) {
      run(system.name, system.run)
    }
  }

  if (debug) {
    try {
      run('integrityCheck', runIntegritySystem)
    } catch (e) {
      log.log('INTEGRITY', { error: String(e) })
    }
    log.perf('tick:total', performance.now() - tickStart)
  } else if (ctx.state.currentWeekOfYear === WEEKS_PER_YEAR) {
    ctx = runIntegritySystem(ctx)
  }

  return toResult(ctx)
}
