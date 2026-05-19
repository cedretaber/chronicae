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
import { runWarSystem } from './warSystem'
import { runProvinceRevoltSystem } from './provinceRevoltSystem'
import { runLandContractPurchaseSystem } from './landContractPurchaseSystem'
import { runPolityOwnerConsistencySystem } from './polityOwnerConsistencySystem'
import { runOrganizationConsistencySystem } from './organizationConsistencySystem'
import { runAttitudeDecaySystem } from './attitudeDecaySystem'
import { runGovernanceSystem } from './governanceSystem'
import { runIntegritySystem } from './integritySystem'
import { runPopSystem, normalizePopSizes } from './popSystem'
import { runPopDevelopmentSystem } from './popDevelopmentSystem'
import { runPersonGrowthSystem } from './personGrowthSystem'
import { runEstateSettlementSystem } from './estateSettlementSystem'
import { runHouseSurplusDistributionSystem } from './houseSurplusDistributionSystem'
import { runUnaffiliatedPersonSystem } from './unaffiliatedPersonSystem'
import { runOfficeTermSystem } from './officeTermSystem'
import { runFactionLifecycleSystem } from './factionLifecycleSystem'
import { runFactionRecruitmentSystem } from './factionRecruitmentSystem'
import { runFactionPatronageSystem } from './factionPatronageSystem'
import { runFactionDefectionSystem } from './factionDefectionSystem'
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
  run('popSystem', runPopSystem)
  run('landRevenueSystem', runLandRevenueSystem)
  run('politySurplusDistributionSystem', runPolitySurplusDistributionSystem)
  run('houseSurplusDistributionSystem', runHouseSurplusDistributionSystem)
  run('disasterSystem', runDisasterSystem)
  run('mortalitySystem', runMortalitySystem)
  run('estateSettlementSystem', runEstateSettlementSystem)
  run('successionSystem', runSuccessionSystem)
  run('marriageSystem', runMarriageSystem)
  run('birthSystem', runBirthSystem)
  run('unaffiliatedPersonSystem', runUnaffiliatedPersonSystem)
  run('officeTermSystem', runOfficeTermSystem)
  run('shareUpdateSystem', runShareUpdateSystem)
  run('appointmentSystem', runAppointmentSystem)
  run('bailiffAppointmentSystem', runBailiffAppointmentSystem)
  run('officeCompensationSystem', runOfficeCompensationSystem)
  run('factionPatronageSystem', runFactionPatronageSystem)
  run('factionDefectionSystem', runFactionDefectionSystem)
  run('factionLifecycleSystem', runFactionLifecycleSystem)
  run('factionRecruitmentSystem', runFactionRecruitmentSystem)
  run('personGrowthSystem', runPersonGrowthSystem)
  run('ambitionSystem', runAmbitionSystem)
  run('publicSpendingSystem', runPublicSpendingSystem)
  run('houseDevelopmentSystem', runHouseDevelopmentSystem)
  run('popDevelopmentSystem', runPopDevelopmentSystem)
  run('plotSystem', runPlotSystem)
  run('warSystem', runWarSystem)
  run('provinceRevoltSystem', runProvinceRevoltSystem)
  run('landContractPurchaseSystem', runLandContractPurchaseSystem)
  run('polityOwnerConsistencySystem', runPolityOwnerConsistencySystem)
  run('organizationConsistencySystem', runOrganizationConsistencySystem)
  run('attitudeDecaySystem', runAttitudeDecaySystem)
  run('governanceSystem', runGovernanceSystem)
  run('normalizePopSizes', normalizePopSizes)

  if (debug) {
    // debug モードは細粒度デバッグ用に毎 tick 走らせる
    try {
      run('integrityCheck', runIntegritySystem)
    } catch (e) {
      log.log('INTEGRITY', { error: String(e) })
    }
    log.perf('tick:total', performance.now() - tickStart)
  } else if (ctx.state.currentMonth === 12) {
    // v0.17.3: default (non-debug) では年末のみ実行する。
    // 違反は即時 throw して終了 (year-end 検知でも原因 year は特定できる)。
    // tick 単位で per-tick check したい場合は --integrity-check flag を使う。
    ctx = runIntegritySystem(ctx)
  }

  return toResult(ctx)
}
