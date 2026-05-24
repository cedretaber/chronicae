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
import { runDeadPersonLogPurgeSystem } from './deadPersonLogPurgeSystem'
import { runSuccessionSystem } from './successionSystem'
import { runMarriageSystem } from './marriageSystem'
import { runBirthSystem } from './birthSystem'
import { runAppointmentSystem } from './appointmentSystem'
import { runShareUpdateSystem } from './shareUpdateSystem'
import { runOfficeCompensationSystem } from './officeCompensationSystem'
import { runPublicSpendingSystem } from './publicSpendingSystem'
import { runControlSystem } from './controlSystem'
import { runPlotSystem } from './plotSystem'
import { runProvinceRevoltSystem } from './provinceRevoltSystem'
import { runDiplomaticPlaySystem } from './diplomaticPlaySystem'
import { runIntentGenerationSystem } from './intentGenerationSystem'
import { runAimToIntentGenerationSystem } from './aimToIntentGenerationSystem'
import { runIntentToDiplomaticPlaySystem } from './intentToDiplomaticPlaySystem'
import { runIntentActionSystem } from './intentActionSystem'
import { runGoalMaintenanceSystem } from './goalMaintenanceSystem'
import { runAimMaintenanceSystem } from './aimMaintenanceSystem'
import { runPersonGoalMaintenanceSystem } from './personGoalMaintenanceSystem'
import { runPersonAimMaintenanceSystem } from './personAimMaintenanceSystem'
import { runBailiffRevenueTaskSystem } from './bailiffRevenueTaskSystem'
import { runTaskSystem } from './taskSystem'
import { runConflictResolutionSystem } from './conflictResolutionSystem'
import { runAimOutcomeSystem } from './aimOutcomeSystem'
import { runGoalOutcomeSystem } from './goalOutcomeSystem'
import { runCleanupTerminalDecisions } from './cleanupTerminalDecisions'
import { runPolityOwnerConsistencySystem } from './polityOwnerConsistencySystem'
import { runOrganizationConsistencySystem } from './organizationConsistencySystem'
import { runAttitudeDecaySystem } from './attitudeDecaySystem'
import { runGovernanceSystem } from './governanceSystem'
import { runIntegritySystem } from './integritySystem'
import { runPopSystem, normalizePopSizes } from './popSystem'
import { runEmploymentRebalanceSystem } from './employmentRebalanceSystem'
import { mergeCompatiblePopsMut } from '../mutations/popMutations'
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
import { runProjectPreparationSystem } from './projectPreparationSystem'
import { runSellLandProjectGenerationSystem } from './sellLandProjectGenerationSystem'
import { runProjectTaskGenerationSystem } from './projectTaskGenerationSystem'
import { runProjectMaintenanceSystem } from './projectMaintenanceSystem'
import { runProjectOutcomeSystem } from './projectOutcomeSystem'
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
  {
    name: 'employmentRebalanceSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runEmploymentRebalanceSystem,
  },
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
    name: 'deadPersonLogPurgeSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runDeadPersonLogPurgeSystem,
  },
  {
    name: 'estateSettlementSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runEstateSettlementSystem,
  },
  { name: 'successionSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runSuccessionSystem },
  { name: 'marriageSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runMarriageSystem },
  { name: 'birthSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runBirthSystem },
  {
    name: 'unaffiliatedPersonSystem',
    intervalWeeks: 4,
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
  { name: 'appointmentSystem', intervalWeeks: 12, phaseOffsetWeeks: 0, run: runAppointmentSystem },
  {
    name: 'bailiffRevenueTaskSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runBailiffRevenueTaskSystem,
  },
  { name: 'taskSystem', intervalWeeks: 1, phaseOffsetWeeks: 0, run: runTaskSystem },
  {
    name: 'bailiffAppointmentSystem',
    intervalWeeks: 12,
    phaseOffsetWeeks: 0,
    run: runBailiffAppointmentSystem,
  },
  {
    name: 'officeCompensationSystem',
    intervalWeeks: 4,
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
    intervalWeeks: 12,
    phaseOffsetWeeks: 0,
    run: runFactionRecruitmentSystem,
  },
  {
    name: 'personGrowthSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runPersonGrowthSystem,
  },
  {
    name: 'publicSpendingSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runPublicSpendingSystem,
  },
  {
    name: 'popDevelopmentSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runPopDevelopmentSystem,
  },
  { name: 'plotSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runPlotSystem },
  {
    name: 'personGoalMaintenanceSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runPersonGoalMaintenanceSystem,
  },
  {
    name: 'personAimMaintenanceSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runPersonAimMaintenanceSystem,
  },
  {
    name: 'goalMaintenanceSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runGoalMaintenanceSystem,
  },
  {
    name: 'aimMaintenanceSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runAimMaintenanceSystem,
  },
  {
    name: 'projectPreparationSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runProjectPreparationSystem,
  },
  {
    name: 'sellLandProjectGenerationSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runSellLandProjectGenerationSystem,
  },
  {
    name: 'projectTaskGenerationSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runProjectTaskGenerationSystem,
  },
  {
    name: 'intentGenerationSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runIntentGenerationSystem,
  },
  {
    name: 'aimToIntentGenerationSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runAimToIntentGenerationSystem,
  },
  {
    name: 'intentToDiplomaticPlaySystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runIntentToDiplomaticPlaySystem,
  },
  {
    name: 'intentActionSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runIntentActionSystem,
  },
  {
    name: 'projectMaintenanceSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runProjectMaintenanceSystem,
  },
  {
    name: 'projectOutcomeSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runProjectOutcomeSystem,
  },
  {
    name: 'provinceRevoltSystem',
    intervalWeeks: 12,
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
    name: 'aimOutcomeSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runAimOutcomeSystem,
  },
  {
    name: 'goalOutcomeSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runGoalOutcomeSystem,
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
    name: 'mergeCompatiblePops',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: (ctx: TickContext): TickContext => {
      const ws = {
        ...ctx.state,
        popGroups: { ...ctx.state.popGroups },
        popIndex: { byHolding: { ...ctx.state.popIndex.byHolding } },
      }
      mergeCompatiblePopsMut(ws)
      return { ...ctx, state: ws }
    },
  },
  {
    name: 'cleanupTerminalDiplomacy',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runCleanupTerminalDiplomacy,
  },
  {
    name: 'cleanupTerminalDecisions',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runCleanupTerminalDecisions,
  },
]

export function tick(input: TickInput): TickResult {
  let ctx = createTickContext(input)
  const log = createLogger(ctx.config.debug)
  const debug = ctx.config.debug
  const timings: Record<string, number> = {}

  const run = (label: string, fn: (c: TickContext) => TickContext): void => {
    const t0 = performance.now()
    ctx = fn(ctx)
    const elapsed = performance.now() - t0
    timings[label] = (timings[label] ?? 0) + elapsed
    if (debug) {
      log.perf(label, elapsed)
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
  } else if (ctx.state.currentWeekOfYear === WEEKS_PER_YEAR) {
    ctx = runIntegritySystem(ctx)
  }

  return { ...toResult(ctx), systemTimings: timings }
}
