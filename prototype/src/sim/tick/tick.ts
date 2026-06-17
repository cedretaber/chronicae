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
import { runHarvestSystem } from './harvestSystem'
import { runCrisisSystem } from './crisisSystem'
import { runUnrestCrisisSystem } from './unrestCrisisSystem'
import { runFacilityMaintenanceSystem } from './facilityMaintenanceSystem'
import { runMortalitySystem } from './mortalitySystem'
import { runDeadPersonLogPurgeSystem } from './deadPersonLogPurgeSystem'
import { runPersonReputationCleanupSystem } from './personReputationCleanupSystem'
import { runSuccessionSystem, applyMinorHeadPenalties } from './successionSystem'
import { runMarriageSystem } from './marriageSystem'
import { runBirthSystem } from './birthSystem'
import { runAppointmentSystem } from './appointmentSystem'
import { runHouseShareUpdateSystem } from './houseShareUpdateSystem'
import { runOfficeCompensationSystem } from './officeCompensationSystem'
import { runControlSystem } from './controlSystem'
import { runProvinceRevoltSystem } from './provinceRevoltSystem'
import { runTaxRevisionSystem } from './taxRevisionSystem'
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
import { runRightConsistencySystem } from './rightConsistencySystem'
import { runInfluenceModifierConsistencySystem } from './influenceModifierConsistencySystem'
import { runRegimentReinforcementSystem } from './regimentReinforcementSystem'
import { runCancelOrphanedWarsSystem } from './cancelOrphanedWarsSystem'
import { runPeaceSettlementSystem } from './peaceSettlementSystem'
import { runCleanupWarSystem } from './cleanupWarSystem'
import { runCleanupBattleLogSystem } from './cleanupBattleLogSystem'
import { runAimOutcomeSystem } from './aimOutcomeSystem'
import { runGoalOutcomeSystem } from './goalOutcomeSystem'
import { runCleanupTerminalDecisions } from './cleanupTerminalDecisions'
import { runChronicleProjectionSystem } from './chronicleProjectionSystem'
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
import { runLifeStageProgressionSystem } from './lifeStageProgressionSystem'
import { runLifeStageInfluenceSystem } from './lifeStageInfluenceSystem'
import { runEstateSettlementSystem } from './estateSettlementSystem'
import { runHouseSurplusDistributionSystem } from './houseSurplusDistributionSystem'
import { runHouseFoundingSystem } from './houseFoundingSystem'
import { runHouseSplitEvaluationSystem } from './houseSplitEvaluationSystem'
import { runClanFormationSystem } from './clanFormationSystem'
import { runHouselessPersonGenerationSystem } from './houselessPersonGenerationSystem'
import { runOfficeTermSystem } from './officeTermSystem'
import { runRepublicPoliticalInitializationSystem } from './republicPoliticalInitializationSystem'
import { runRepublicLeadershipSystem } from './republicLeadershipSystem'
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
    // v0.48 §4: 正イベント (BountifulHarvest) のみ。負イベントは crisisSystem に移設。
    name: 'harvestSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runHarvestSystem,
  },
  {
    // v0.40 §7.3: progression の直前。幼年期/思春期はその年の段階として影響を受けてから遷移する。
    //   RNG 不使用の決定的処理。
    name: 'lifeStageInfluenceSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runLifeStageInfluenceSystem,
  },
  {
    // v0.40 §5.3: advanceTime で age が上がった後、年次で LifeStage を一方向に進める。
    //   influence→progression の順（直前に LifeStageInfluenceSystem）。
    //   lifeStage を参照する appointment/faction/plot/project/personGoal より前に置く。
    name: 'lifeStageProgressionSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runLifeStageProgressionSystem,
  },
  { name: 'mortalitySystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runMortalitySystem },
  {
    name: 'deadPersonLogPurgeSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runDeadPersonLogPurgeSystem,
  },
  {
    // v0.44 §4.5: expiryWeek 超過 + 死亡者残骸の PersonReputation cleanup (年次)
    name: 'personReputationCleanupSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runPersonReputationCleanupSystem,
  },
  {
    name: 'estateSettlementSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runEstateSettlementSystem,
  },
  { name: 'successionSystem', intervalWeeks: 4, phaseOffsetWeeks: 0, run: runSuccessionSystem },
  {
    // spec §6.12 未成年当主ペナルティ: 当主が未成年 (age < adultAge) の間、4 週ごとに家
    // メンバーの respect (cohesion) / 当主の primary polity への affection (loyalty) を
    // Attitude 経由で削る。ロジックは successionSystem.ts (applyMinorHeadPenalties) に
    // 存在したが v0.7 以来 tick へ未配線だった (調査 §5 #5)。
    // 配線位置: successionSystem (位置 177) の直後。年末 succession re-pass は
    // runSuccessionSystem のみを再実行するため、このペナルティを runSuccessionSystem 内に
    // 入れず独立 system にすることで week 48 での二重適用を回避する。
    name: 'minorHeadPenaltySystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: applyMinorHeadPenalties,
  },
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
    // v0.42c: polity 枝削除に伴い house 専用に改名 (PERF ログ名も変わる)
    name: 'houseShareUpdateSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runHouseShareUpdateSystem,
  },
  {
    // v0.46 §5.2.2: 任期 leader 交代。年次・AppointmentSystem より前 (交代後に同年の
    //   AppointmentSystem が新 leader を踏まえて通常 office appointment を行える)。
    name: 'republicLeadershipSystem',
    intervalWeeks: WEEKS_PER_YEAR,
    phaseOffsetWeeks: 0,
    run: runRepublicLeadershipSystem,
  },
  {
    // v0.46 §5.1.2: AppointmentSystem の直前に置く。AppointmentSystem は commonwealth の
    //   非 leader slot を housed 候補で埋める (POLITY_APPOINTABLE_ROLES) ため、RepublicInit を
    //   直前に置けば AppointmentSystem が発火する週は必ず RepublicInit (4週) も発火する週となり、
    //   houseless 功臣 seed・personal right・REPUBLIC_FOUNDED を取りこぼさない。
    name: 'republicPoliticalInitializationSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runRepublicPoliticalInitializationSystem,
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
    // v0.48 Crisis: spawn 年次・処理週次。projectOutcomeSystem の後に置き、resolved/purge 済みの
    //   Crisis を読まずに済むようにする (§2.4 / 順序の落とし穴 4)。
    name: 'crisisSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runCrisisSystem,
  },
  {
    // v0.48 Phase C (Decision 1): crisisSystem が mark した unrest Crisis の terminal 処理
    //   (譲歩/鎮圧/武装蜂起) を ctx ベースで適用。crisisSystem の直後に置く (同 tick で完結)。
    name: 'unrestCrisisSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runUnrestCrisisSystem,
  },
  {
    // v0.48.1 設備維持管理: condition 減衰 → 機能不全 (disrepair Crisis) → 破壊 (§2.5)。
    //   projectOutcomeSystem と同 interval(4)・同 offset(0) にし crisisSystem の後に置く。これにより
    //   「同サイクルに完了した修理 (projectOutcome) が先に condition を回復 → その後で減衰・破壊判定」が
    //   毎回保証され、完了直前の improvement の誤破壊を防ぐ (順序の落とし穴 3)。
    name: 'facilityMaintenanceSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runFacilityMaintenanceSystem,
  },
  {
    name: 'pressureSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runPressureSystem,
  },
  {
    name: 'taxRevisionSystem',
    intervalWeeks: 48,
    phaseOffsetWeeks: 0,
    run: runTaxRevisionSystem,
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
    // v0.47.3: interval 1 (weekly)。旧 interval 4 では年末 integrity tick (absoluteWeek ≡ 47
    //   mod 48) に走らず、週 45〜47 で landless 化した Polity (granted polity が holding を
    //   失う等) が titular 化/abolish されないまま §25 #17 (landless active = 違反) に捕まった。
    //   cancelOrphanedWars / rightConsistency と同じく weekly 化して年末 tick をカバーする。
    name: 'polityOwnerConsistencySystem',
    intervalWeeks: 1,
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
    // v0.42 §7: PoliticalRight drift の安全網。regimentMaintenance の owner 同期の後・
    //   cleanup 系の前。年末 integrity (absoluteWeek ≡ 47 mod 48) は interval 4 系の実行週に
    //   当たらないため、cancelOrphanedWars と同じく weekly 必須 (§3.4)。
    name: 'rightConsistencySystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runRightConsistencySystem,
  },
  {
    // v0.51 陰謀リファイン: InfluenceModifier の期限切れ・target/polity 消滅を回収する。
    //   weekly (rightConsistency と同型)。年末 integrity tick (absoluteWeek ≡ 47 mod 48) は
    //   interval 4 系の実行週に当たらないため、target/polity liveness を年末 integrity が
    //   検査するには weekly で毎 tick 掃除する必要がある (§3.4 と同じ理由)。
    name: 'influenceModifierConsistencySystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runInfluenceModifierConsistencySystem,
  },
  {
    // v0.36 補充・再編成: maintenance 直後。active strength の月次補充 + destroyed reform。
    //   maintenance が owner/home の不整合を整理した後なので整合した状態を前提にできる。
    name: 'regimentReinforcementSystem',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runRegimentReinforcementSystem,
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
    // v0.49 §15.6: war 系 cleanup と同じ後段。期限切れ normal BattleLog を purge (major は恒久)。
    name: 'cleanupBattleLogSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runCleanupBattleLogSystem,
  },
  {
    name: 'cleanupTerminalDecisions',
    intervalWeeks: 4,
    phaseOffsetWeeks: 0,
    run: runCleanupTerminalDecisions,
  },
  {
    // v0.38 §4.3: scheduledSystems 末尾 (全 system / cleanup の後)。同 tick の ctx.events が
    //   全量揃った状態で curated allowlist を ChronicleEntry に projection する。
    //   flushTerminalEntities / integrityCheck の前に走るので、生成した chronicle の
    //   index↔entry 整合を同 tick で検査できる (§7)。毎週実行。
    name: 'chronicleProjectionSystem',
    intervalWeeks: 1,
    phaseOffsetWeeks: 0,
    run: runChronicleProjectionSystem,
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

  // 整合性 invariant は設計上「年末 (cleanup 後 + flush 後)」にのみ成立する契約。
  // 多くの system が複数週間隔で走り、その間は意図的な中間状態 (terminal Project 未 flush /
  // Task→project dangling / 死亡 office holder など) を持つため、per-tick で検査すると必ず
  // 誤検知する。よって flush + integrity は debug/非 debug いずれも WEEKS_PER_YEAR でのみ実行する。
  // debug 時は観察継続のため catch-and-log (非 fatal)、非 debug は throw でゲートにする。
  if (ctx.state.currentWeekOfYear === WEEKS_PER_YEAR) {
    // 年末 succession re-pass: successionSystem は週次スケジュール (位置 177) で走るが、
    // その後に実行される death-causing system (戦争・処刑等) が year-end tick で
    // House leader を殺すと、その tick では succession が走り終えており House が leaderless のまま
    // 年末 integrity check に到達する (翌年 week 1 の succession で自己修復するため通常は無害だが、
    // §1.8 leaderless detector が year-end の一過性 leaderless を fatal 化させる)。
    // ここで再度 succession を走らせ、年末 invariant「active House は leader を持つ」を確実に成立させる。
    // 通常 (leaderless House/polity 無し) は no-op (RNG draw 無し) のため bit-identical。
    run('successionSystemYearEnd', runSuccessionSystem)
    if (debug) {
      run('preIntegrityFlush', flushTerminalEntities)
      try {
        run('integrityCheck', runIntegritySystem)
      } catch (e) {
        log.log('INTEGRITY', { error: String(e) })
      }
    } else {
      ctx = flushTerminalEntities(ctx)
      ctx = runIntegritySystem(ctx)
    }
  }

  return { ...toResult(ctx), systemTimings: timings }
}
