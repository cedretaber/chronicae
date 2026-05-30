import {
  type TickInput,
  type TickResult,
  type TickContext,
  createTickContext,
  toResult,
} from './context'
import { advanceTime } from './advanceTime'
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
import { runDiplomaticPlaySystem, cancelOrphanedPlays } from './diplomaticPlaySystem'
import { runGoalMaintenanceSystem } from './goalMaintenanceSystem'
import { runAimMaintenanceSystem } from './aimMaintenanceSystem'
import { runPersonGoalMaintenanceSystem } from './personGoalMaintenanceSystem'
import { runPersonAimMaintenanceSystem } from './personAimMaintenanceSystem'
import { runBailiffRevenueTaskSystem } from './bailiffRevenueTaskSystem'
import { runTaskSystem } from './taskSystem'
import { runConflictResolutionSystem } from './conflictResolutionSystem'
import { runWarCreationSystem } from './warCreationSystem'
import { runWarManeuverSystem } from './warManeuverSystem'
import { runRegimentRecoverySystem } from './regimentRecoverySystem'
import { runRegimentMaintenanceSystem } from './regimentMaintenanceSystem'
import { runCancelOrphanedWarsSystem } from './cancelOrphanedWarsSystem'
import { runPeaceSettlementSystem } from './peaceSettlementSystem'
import { runCleanupWarSystem } from './cleanupWarSystem'
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
import { runPersonGrowthSystem } from './personGrowthSystem'
import { runEstateSettlementSystem } from './estateSettlementSystem'
import { runHouseSurplusDistributionSystem } from './houseSurplusDistributionSystem'
import { runHouseFoundingSystem } from './houseFoundingSystem'
import { runHouseSplitEvaluationSystem } from './houseSplitEvaluationSystem'
import { runClanFormationSystem } from './clanFormationSystem'
import { runHouselessPersonGenerationSystem } from './houselessPersonGenerationSystem'
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
import { runProjectStageSystem } from './projectStageSystem'
import { runPressureSystem } from './pressureSystem'
import { removeProjectFromIndexMut } from '../mutations/projectMutations'
import { createLogger } from '../debug/logger'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import type { ProjectId } from '../types/ids'
import type { WorldState } from '../types/world'

type ScheduledSystem = {
  name: string
  intervalWeeks: number
  phaseOffsetWeeks: number
  run: (ctx: TickContext) => TickContext
}

function flushTerminalEntities(ctx: TickContext): TickContext {
  const terminalProjectIds: ProjectId[] = []
  for (const [id, p] of Object.entries(ctx.state.projects)) {
    if (p && (p.status === 'completed' || p.status === 'failed' || p.status === 'cancelled')) {
      terminalProjectIds.push(id as ProjectId)
    }
  }
  if (terminalProjectIds.length === 0) return ctx
  const ws: WorldState = {
    ...ctx.state,
    projects: { ...ctx.state.projects },
    projectIndex: {
      byOwner: { ...ctx.state.projectIndex.byOwner },
      byAim: { ...ctx.state.projectIndex.byAim },
      byParentProject: { ...ctx.state.projectIndex.byParentProject },
      byCreatorPerson: { ...ctx.state.projectIndex.byCreatorPerson },
      bySupervisorPerson: { ...ctx.state.projectIndex.bySupervisorPerson },
      byRelatedEntity: { ...ctx.state.projectIndex.byRelatedEntity },
    },
  }
  for (const pid of terminalProjectIds) {
    const p = ws.projects[pid]
    if (p) {
      removeProjectFromIndexMut(ws, p)
      delete ws.projects[pid]
    }
  }
  return { ...ctx, state: ws }
}

const scheduledSystems: ScheduledSystem[] = [
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
    name: 'houseFoundingSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runHouseFoundingSystem,
  },
  {
    name: 'houseSplitEvaluationSystem',
    intervalWeeks: 12,
    phaseOffsetWeeks: 0,
    run: runHouseSplitEvaluationSystem,
  },
  {
    name: 'clanFormationSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runClanFormationSystem,
  },
  {
    name: 'houselessPersonGenerationSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runHouselessPersonGenerationSystem,
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
    name: 'projectStageSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runProjectStageSystem,
  },
  {
    name: 'projectTaskGenerationSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runProjectTaskGenerationSystem,
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
    name: 'pressureSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runPressureSystem,
  },
  {
    name: 'provinceRevoltSystem',
    intervalWeeks: 12,
    phaseOffsetWeeks: 0,
    run: runProvinceRevoltSystem,
  },
  {
    name: 'cancelOrphanedPlays',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: cancelOrphanedPlays,
  },
  {
    name: 'diplomaticPlaySystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runDiplomaticPlaySystem,
  },
  {
    name: 'warCreationSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runWarCreationSystem,
  },
  {
    name: 'conflictResolutionSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runConflictResolutionSystem,
  },
  {
    // v0.35: 旧 WarProgressSystem を WarManeuverSystem に置換。intervalWeeks 1 (毎週、§2.4)。
    //   旧スロット位置を維持し、PeaceSettlement (interval 4 据え置き) の前に置く。
    name: 'warManeuverSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runWarManeuverSystem,
  },
  {
    // v0.36 §13: WarManeuver の battle damage 適用後に organization を週次回復。
    name: 'regimentRecoverySystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runRegimentRecoverySystem,
  },
  {
    name: 'peaceSettlementSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runPeaceSettlementSystem,
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
    // v0.34 §7.9 / §B advisor①: consistency 系の後ろに置き、PeaceSettlement 起因で
    // 同 tick に extinct した polity を参照する active War を年末 integrity 前に cancelled 化する。
    name: 'cancelOrphanedWarsSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runCancelOrphanedWarsSystem,
  },
  {
    // v0.36 §14: consistency 系の後・cleanupWar の前。stale war demobilize /
    //   owner 失効 disband / homeHolding 消失 disband / terminal 変化で owner 付け替え。
    name: 'regimentMaintenanceSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runRegimentMaintenanceSystem,
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
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runCleanupTerminalDiplomacy,
  },
  {
    name: 'cleanupWarSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runCleanupWarSystem,
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
  const integrityLog = createLogger(ctx.config.integrityPerSystem)
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
    if (ctx.config.integrityPerSystem) {
      try {
        runIntegritySystem(ctx)
      } catch (e) {
        integrityLog.log('INTEGRITY_AFTER', {
          system: label,
          year: ctx.state.currentYear,
          week: ctx.state.currentWeekOfYear,
          error: String(e),
        })
      }
    }
  }

  run('advanceTime', advanceTime)

  const intervalOverrides: Record<string, number> = {
    houseFoundingSystem: ctx.config.houseFoundingIntervalWeeks,
    houseSplitEvaluationSystem: ctx.config.houseSplitEvaluationIntervalWeeks,
    clanFormationSystem: ctx.config.clanFormationIntervalWeeks,
  }

  for (const system of scheduledSystems) {
    const interval = intervalOverrides[system.name] ?? system.intervalWeeks
    if ((ctx.state.absoluteWeek - system.phaseOffsetWeeks) % interval === 0) {
      run(system.name, system.run)
    }
  }

  if (debug) {
    run('preIntegrityFlush', flushTerminalEntities)
    try {
      run('integrityCheck', runIntegritySystem)
    } catch (e) {
      log.log('INTEGRITY', { error: String(e) })
    }
  } else if (ctx.state.currentWeekOfYear === WEEKS_PER_YEAR) {
    ctx = flushTerminalEntities(ctx)
    ctx = runIntegritySystem(ctx)
  }

  return { ...toResult(ctx), systemTimings: timings }
}
