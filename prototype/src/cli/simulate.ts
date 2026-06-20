import { generateWorld } from '@sim/worldgen/generateWorld'
import type { WorldPresetName } from '@sim/worldgen/worldPresets'
import { tick } from '@sim/tick/tick'
import { defaultConfig } from '@sim/config/defaultConfig'
import { createLogger } from '@sim/debug/logger'
import type { WorldState } from '@sim/types/world'
import { getHoldingDevelopment } from '@sim/selectors/holdingImprovementSelectors'
import type { SimEvent } from '@sim/types/event'
import type { EventMessageParams } from '@sim/types/event'
import type { ProvinceId, HoldingId, PolityId } from '@sim/types/ids'
import { getPolityEmitNameKey } from '@sim/selectors/nameRefSelectors'
import {
  getProvinceTerminalPolityId,
  getProvincePolityControlFromHoldings,
} from '@sim/selectors/landContractSelectors'
import { getProvinceUnrest, getPopUnrestByClass } from '@sim/selectors/popSelectors'
import { RESOURCE_PRICE_DEFINITIONS } from '@sim/config/resourceEconomyDefinitions'
import { RESOURCE_KINDS } from '@sim/types/resource'
import type { ResourceKind } from '@sim/types/resource'
import { buildActivityReport } from '@sim/report/activityReport'
import { takeSnapshot } from '@sim/report/snapshot'
import type { ActivitySnapshot } from '@sim/report/types'
import { writeFileSync } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { createNamePoolService } from '@sim/namegen/namePoolService'
import type { NamePoolData } from '@sim/namegen/namePoolTypes'
import { createChronicaeI18n } from '../i18n'
import { createNodeResourceLoader } from '../i18n/loaders/nodeResourceLoader'
import { createNameTranslator } from '../i18n/nameTranslator'
import { createEventRenderer } from '../i18n/eventRenderer'
import type { LocaleCode } from '../i18n/types'

function printUsage(): void {
  console.log(`Usage: npm run cli [options]

Options:
  --seed <text>         Seed for world generation (default: "chronicae-default")
  --years <n>           Number of years to simulate (default: 10)
  --weeks <n>           Number of weeks to simulate (alternative to --years)
  --json                Output each tick as NDJSON
  --debug               Enable debug mode (entity IDs in events, structured debug log on stderr)
  --integrity-per-system  Run integrity check after every system (very slow, for diagnosis)
  --dump-world          Dump full WorldState as JSON to stderr after simulation ends
  --digest              Output WorldDigest summary as JSON to stdout after simulation
  --config <json>       Override config values with a JSON object (e.g. '{"taxRevisionTaxChangeAmount":0.10}')
  --report <path>       Write Activity Report (4-axis observation JSON) to <path>; use "-" for stdout
  --report-snapshot <n> Capture a snapshot every <n> years for the report (default: off)
  --perf                Output performance summary (entity counts, elapsed time, tick time)
  --preset <name>       World size preset (tiny, small, standard, perfLarge)
  --locale <code>       Locale for event rendering (en, ja; default: en)
  --help                Show this help message`)
}

function parseArgs(argv: string[]): {
  seed: string
  years: number
  weeks: number | undefined
  json: boolean
  integrityPerSystem: boolean
  debug: boolean
  perf: boolean
  dumpWorld: boolean
  digest: boolean
  configOverrides: Record<string, unknown>
  reportPath: string | undefined
  reportSnapshotYears: number
  preset: WorldPresetName | undefined
  locale: LocaleCode
  showHelp: boolean
} {
  let seed = 'chronicae-default'
  let years = 10
  let weeks: number | undefined = undefined
  let json = false
  let integrityPerSystem = false
  let debug = false
  let perf = false
  let dumpWorld = false
  let digest = false
  let configOverrides: Record<string, unknown> = {}
  let reportPath: string | undefined = undefined
  let reportSnapshotYears = 0
  let preset: WorldPresetName | undefined = undefined
  let locale: LocaleCode = 'en'
  let showHelp = false

  let i = 2
  while (i < argv.length) {
    const arg = argv[i]
    if (arg === '--seed') {
      i++
      const val = argv[i]
      if (i < argv.length && val !== undefined) {
        seed = val
      }
    } else if (arg === '--years') {
      i++
      const val = argv[i]
      if (i < argv.length && val !== undefined) {
        years = parseInt(val, 10)
      }
    } else if (arg === '--weeks') {
      i++
      const val = argv[i]
      if (i < argv.length && val !== undefined) {
        weeks = parseInt(val, 10)
      }
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--integrity-per-system') {
      integrityPerSystem = true
    } else if (arg === '--debug') {
      debug = true
    } else if (arg === '--perf') {
      perf = true
    } else if (arg === '--dump-world') {
      dumpWorld = true
    } else if (arg === '--digest') {
      digest = true
    } else if (arg === '--config') {
      i++
      const val = argv[i]
      if (i < argv.length && val !== undefined) {
        try {
          const parsed: unknown = JSON.parse(val)
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            configOverrides = parsed as Record<string, unknown>
          } else {
            console.error('Error: --config value must be a JSON object')
            process.exit(1)
          }
        } catch {
          console.error('Error: --config value is not valid JSON')
          process.exit(1)
        }
      }
    } else if (arg === '--report') {
      i++
      const val = argv[i]
      if (i < argv.length && val !== undefined) {
        reportPath = val
      }
    } else if (arg === '--report-snapshot') {
      i++
      const val = argv[i]
      if (i < argv.length && val !== undefined) {
        reportSnapshotYears = parseInt(val, 10)
      }
    } else if (arg === '--preset') {
      i++
      const val = argv[i]
      if (val && ['tiny', 'small', 'standard', 'perfLarge'].includes(val)) {
        preset = val as WorldPresetName
      } else {
        console.error('Error: --preset must be one of: tiny, small, standard, perfLarge')
        process.exit(1)
      }
    } else if (arg === '--locale') {
      i++
      const val = argv[i]
      if (val && (val === 'en' || val === 'ja')) {
        locale = val
      } else {
        console.error('Error: --locale must be one of: en, ja')
        process.exit(1)
      }
    } else if (arg === '--help') {
      showHelp = true
    }
    i++
  }

  return {
    seed,
    years,
    weeks,
    json,
    integrityPerSystem,
    debug,
    perf,
    dumpWorld,
    digest,
    configOverrides,
    reportPath,
    reportSnapshotYears,
    preset,
    locale,
    showHelp,
  }
}

function countActivePolities(state: WorldState): number {
  let count = 0
  for (const id of Object.keys(state.polities)) {
    const polity = state.polities[id as keyof typeof state.polities]
    if (polity && polity.active) {
      count++
    }
  }
  return count
}

function countActiveHouses(state: WorldState): number {
  let count = 0
  for (const id of Object.keys(state.houses)) {
    const house = state.houses[id as keyof typeof state.houses]
    if (house && house.active) {
      count++
    }
  }
  return count
}

function countProvincesPerPolity(state: WorldState): Record<string, number> {
  const result: Record<string, number> = {}
  for (const id of Object.keys(state.provinces)) {
    const province = state.provinces[id as keyof typeof state.provinces]
    if (!province) continue
    const polityId = getProvinceTerminalPolityId(state, id as ProvinceId)
    if (!polityId) continue
    if (!result[polityId]) {
      result[polityId] = 0
    }
    result[polityId]++
  }
  return result
}

function computeAvgPolityControl(state: WorldState): number {
  let total = 0
  let count = 0
  for (const id of Object.keys(state.provinces)) {
    const provinceControl = getProvincePolityControlFromHoldings(state, id as ProvinceId)
    total += provinceControl
    count++
  }
  if (count === 0) return 0
  return Math.round((total / count) * 10) / 10
}

// v0.16: houseControl 廃止により本関数は polityControl を返す (互換のため signature 維持)
function computeAvgHouseControl(state: WorldState): number {
  return computeAvgPolityControl(state)
}

function countLivingPersons(state: WorldState): number {
  return state.livingPersonIds.length
}

function countLandContracts(state: WorldState): number {
  return Object.keys(state.landContracts).length
}

// 調査 §4.1: byProvince 撤去に伴い byHolding ベースへ再定義 (holding あたり契約チェーン長の平均)。
// 1 province=複数 holding のため値域は旧 byProvince 版と異なる (digest 比較時は本コミット以降を基準に)。
function avgChainDepth(state: WorldState): number {
  let totalDepth = 0
  let count = 0
  for (const chain of Object.values(state.landContractIndex.byHolding)) {
    if (!chain) continue
    totalDepth += chain.length
    count++
  }
  if (count === 0) return 0
  return Math.round((totalDepth / count) * 10) / 10
}

function countHoldings(state: WorldState): number {
  return Object.keys(state.holdings).length
}

function computeAvgHoldingDevelopment(state: WorldState): number {
  let total = 0
  let count = 0
  for (const holding of Object.values(state.holdings)) {
    if (!holding) continue
    total += getHoldingDevelopment(state, defaultConfig, holding.id)
    count++
  }
  if (count === 0) return 0
  return Math.round((total / count) * 10) / 10
}

function computeAvgHoldingPolityControl(state: WorldState): number {
  let total = 0
  let count = 0
  for (const holding of Object.values(state.holdings)) {
    if (!holding) continue
    total += holding.polityControl
    count++
  }
  if (count === 0) return 0
  return Math.round((total / count) * 10) / 10
}

function countHoldingBailiffsByKind(state: WorldState): {
  normal: number
  placeholder: number
  vacant: number
} {
  let normal = 0
  let placeholder = 0
  let vacant = 0
  for (const holdingId of Object.keys(state.holdings)) {
    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId as HoldingId]
    if (!assignmentId) {
      vacant++
      continue
    }
    const assignment = state.holdingOfficeAssignments[assignmentId]
    if (!assignment || !assignment.active) {
      vacant++
      continue
    }
    const holder = state.persons[assignment.holderPersonId]
    if (!holder) {
      vacant++
      continue
    }
    if (holder.kind === 'placeholder') {
      placeholder++
    } else {
      normal++
    }
  }
  return { normal, placeholder, vacant }
}

function computeUnrestStats(state: WorldState): {
  avgUnrest: number
  avgPeasantUnrest: number
  avgTownsmenUnrest: number
  avgNobleUnrest: number
  highUnrestCount: number
  totalProvinces: number
} {
  const provinceIds = Object.keys(state.provinces) as ProvinceId[]
  let totalUnrest = 0
  let totalPeasant = 0
  let totalTownsmen = 0
  let totalNoble = 0
  let highUnrestCount = 0
  let count = 0

  for (const pid of provinceIds) {
    const unrest = getProvinceUnrest(state, pid)
    totalUnrest += unrest
    totalPeasant += getPopUnrestByClass(state, pid, 'peasants')
    totalTownsmen += getPopUnrestByClass(state, pid, 'townsmen')
    totalNoble += getPopUnrestByClass(state, pid, 'nobles')
    if (unrest > 50) highUnrestCount++
    count++
  }

  if (count === 0) {
    return {
      avgUnrest: 0,
      avgPeasantUnrest: 0,
      avgTownsmenUnrest: 0,
      avgNobleUnrest: 0,
      highUnrestCount: 0,
      totalProvinces: 0,
    }
  }

  return {
    avgUnrest: Math.round((totalUnrest / count) * 10) / 10,
    avgPeasantUnrest: Math.round((totalPeasant / count) * 10) / 10,
    avgTownsmenUnrest: Math.round((totalTownsmen / count) * 10) / 10,
    avgNobleUnrest: Math.round((totalNoble / count) * 10) / 10,
    highUnrestCount,
    totalProvinces: count,
  }
}

// v0.54 §22.2: 資源経済の観察統計。価格縮退・POP wealth 床張り付き・財政経路 (owned vs holding due) を見る。
function computeEconomyStats(state: WorldState): {
  avgPopWealth: number
  resource: Record<
    ResourceKind,
    { avgPriceRatio: number; clampedPct: number; avgFulfillment: number }
  >
  ownedRevenueRatio: number
  totalHoldingDue: number
  totalOwnerIncome: number
} {
  // POP wealth (size 加重平均)
  let wealthSum = 0
  let sizeSum = 0
  for (const pop of Object.values(state.popGroups)) {
    if (!pop) continue
    wealthSum += pop.wealth * pop.size
    sizeSum += pop.size
  }
  const avgPopWealth = sizeSum > 0 ? wealthSum / sizeSum : 0

  // 資源価格・充足率 (market ごとの lastPrice / 直近 history)
  const resource = {} as Record<
    ResourceKind,
    { avgPriceRatio: number; clampedPct: number; avgFulfillment: number }
  >
  for (const r of RESOURCE_KINDS) {
    const def = RESOURCE_PRICE_DEFINITIONS[r]
    let priceRatioSum = 0
    let clamped = 0
    let fulfillSum = 0
    let n = 0
    for (const ps of Object.values(state.marketResourcePrices)) {
      if (!ps || ps.resource !== r) continue
      n++
      priceRatioSum += ps.lastPrice / def.basePrice
      const swing = defaultConfig.marketPriceSwing
      const atFloor = Math.abs(ps.lastPrice - def.basePrice * (1 - swing)) < 1e-3
      const atCeil = Math.abs(ps.lastPrice - def.basePrice * (1 + swing)) < 1e-3
      if (atFloor || atCeil) clamped++
      const last = ps.history[ps.history.length - 1]
      if (last) fulfillSum += last.fulfillmentRatio
    }
    resource[r] = {
      avgPriceRatio: n > 0 ? priceRatioSum / n : 0,
      clampedPct: n > 0 ? (100 * clamped) / n : 0,
      avgFulfillment: n > 0 ? fulfillSum / n : 0,
    }
  }

  // 財政経路: owned vs 全 asset の positiveNet、holding due / owner income (月額)
  let allNet = 0
  let ownedNet = 0
  let totalHoldingDue = 0
  let totalOwnerIncome = 0
  for (const snap of Object.values(state.monthlyHoldingResourceRevenue)) {
    if (!snap) continue
    for (const ar of snap.assetResults) {
      const positiveNet = Math.max(0, ar.netRevenue)
      if (positiveNet <= 0) continue
      allNet += positiveNet
      const asset = state.realEstateAssets[ar.assetId]
      if (asset?.owner) {
        ownedNet += positiveNet
        const due = positiveNet * defaultConfig.realEstateHoldingDueRate
        totalHoldingDue += due
        totalOwnerIncome += positiveNet - due
      }
    }
  }

  return {
    avgPopWealth,
    resource,
    ownedRevenueRatio: allNet > 0 ? ownedNet / allNet : 0,
    totalHoldingDue,
    totalOwnerIncome,
  }
}

function countRebelPolities(state: WorldState): number {
  let count = 0
  for (const id of Object.keys(state.polities)) {
    if (id.startsWith('dp-')) count++
  }
  return count
}

function countSystemHouses(state: WorldState): number {
  let count = 0
  for (const house of Object.values(state.houses)) {
    if (house?.kind === 'system') count++
  }
  return count
}

function countPlaceholderPersons(state: WorldState): number {
  let count = 0
  for (const person of Object.values(state.persons)) {
    if (person?.kind === 'placeholder') count++
  }
  return count
}

function countDecisionEntities(state: WorldState): {
  activeProjects: number
  activePlays: number
  activePressures: number
  activeTasks: number
  activeGoals: number
  activeAims: number
} {
  let activeProjects = 0
  let activePlays = 0
  let activePressures = 0
  let activeTasks = 0
  let activeGoals = 0
  let activeAims = 0
  for (const p of Object.values(state.projects)) {
    if (p?.status === 'active') activeProjects++
  }
  for (const dp of Object.values(state.diplomaticPlays)) {
    if (dp) activePlays++
  }
  for (const pr of Object.values(state.pressures)) {
    if (pr?.status === 'active') activePressures++
  }
  for (const t of Object.values(state.tasks)) {
    if (t?.status === 'active') activeTasks++
  }
  for (const g of Object.values(state.goals)) {
    if (g?.status === 'active') activeGoals++
  }
  for (const a of Object.values(state.aims)) {
    if (a?.status === 'active') activeAims++
  }
  return { activeProjects, activePlays, activePressures, activeTasks, activeGoals, activeAims }
}

function countEventsByType(events: SimEvent[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const event of events) {
    result[event.type] = (result[event.type] ?? 0) + 1
  }
  return result
}

function buildDecisionSummary(state: WorldState): {
  goals: {
    id: string
    owner: string
    kind: string
    status: string
    progress: number
    targetProgress: number
  }[]
  aims: {
    id: string
    owner: string
    goalId: string
    kind: string
    status: string
    progress: number
    targetProgress: number
    deadline: number
  }[]
  projects: {
    id: string
    owner: string
    kind: string
    status: string
    progress: number
    targetProgress: number
  }[]
  decisionReasonCount: number
} {
  const goals = Object.values(state.goals)
    .filter((g): g is NonNullable<typeof g> => g !== undefined)
    .map((g) => ({
      id: g.id,
      owner: `${g.owner.kind}:${g.owner.id}`,
      kind: g.kind,
      status: g.status,
      progress: g.progress,
      targetProgress: g.targetProgress,
    }))

  const aims = Object.values(state.aims)
    .filter((a): a is NonNullable<typeof a> => a !== undefined)
    .map((a) => ({
      id: a.id,
      owner: `${a.owner.kind}:${a.owner.id}`,
      goalId: a.goalId ?? '',
      kind: a.kind,
      status: a.status,
      progress: a.progress,
      targetProgress: a.targetProgress,
      deadline: a.deadlineWeek,
    }))

  const projects = Object.values(state.projects)
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .map((p) => ({
      id: p.id,
      owner: `${p.owner.kind}:${p.owner.id}`,
      kind: p.kind,
      status: p.status,
      progress: p.progress,
      targetProgress: p.targetProgress,
    }))

  return {
    goals,
    aims,
    projects,
    decisionReasonCount: Object.keys(state.decisionReasons).length,
  }
}

function formatTreasury(treasury: number): string {
  return String(Math.round(treasury))
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  if (args.showHelp) {
    printUsage()
    process.exit(0)
  }

  if (args.years !== undefined && args.weeks !== undefined) {
    console.error('Error: --years and --weeks cannot be specified together')
    process.exit(1)
  }

  const totalTicks = args.weeks !== undefined ? args.weeks : args.years * 48

  // Load NamePoolService for CLI
  const namePoolsPath = path.resolve(import.meta.dirname, '../sim/namegen/namePools.yaml')
  const namePoolsYaml = fs.readFileSync(namePoolsPath, 'utf-8')
  const namePoolData = YAML.parse(namePoolsYaml) as NamePoolData
  const namePoolService = createNamePoolService(namePoolData)

  // Initialize i18n for locale-aware event rendering
  const i18n = await createChronicaeI18n({
    locale: args.locale,
    fallbackLocale: 'en',
    resourceLoader: createNodeResourceLoader(),
  })
  const nodeLoader = createNodeResourceLoader()
  const localeNames = await nodeLoader.loadAllNameTranslations(args.locale)
  const fallbackNames =
    args.locale !== 'en' ? await nodeLoader.loadAllNameTranslations('en') : undefined
  const nameTranslator = createNameTranslator(localeNames, fallbackNames)
  const eventRenderer = createEventRenderer(i18n, nameTranslator)
  const renderEvent = (e: { messageKey: string; messageParams: EventMessageParams }): string =>
    eventRenderer.render(e.messageKey, e.messageParams)

  const { world, rng: initialRng } = generateWorld(args.seed, args.preset, namePoolService)

  const initialPolityCount = countActivePolities(world)
  const initialHouseCount = countActiveHouses(world)

  const polityAnnexedInfo: Record<string, { nameKey: string; year: number }> = {}
  for (const id of Object.keys(world.polities)) {
    const polity = world.polities[id as keyof typeof world.polities]
    if (!polity) continue
    polityAnnexedInfo[id] = { nameKey: getPolityEmitNameKey(world, id as PolityId), year: 0 }
  }

  let state: WorldState = world
  let currentRng = initialRng
  const allEvents: SimEvent[] = []
  const validConfigKeys = new Set(Object.keys(defaultConfig))
  for (const key of Object.keys(args.configOverrides)) {
    if (!validConfigKeys.has(key)) {
      console.error(`Warning: unknown config key "${key}" (ignored)`)
    }
  }
  const configBase: typeof defaultConfig = Object.assign({}, defaultConfig, args.configOverrides)
  const config = {
    ...configBase,
    ...(args.debug ? { debug: true } : {}),
    ...(args.integrityPerSystem ? { integrityPerSystem: true } : {}),
  }
  const snapshots: ActivitySnapshot[] = []
  // 初期状態 (year 0) のスナップショットも取る (--report-snapshot 有効時のみ)
  if (args.reportPath !== undefined && args.reportSnapshotYears > 0) {
    snapshots.push(takeSnapshot(state, state.currentYear))
  }

  if (!args.json && !args.digest) {
    console.log('Starting simulation with seed:', args.seed)
    console.log('Simulating', args.years, 'years,', totalTicks, 'ticks')
    console.log('')
  }

  const simStartTime = performance.now()
  let tickTimeTotal = 0
  const systemTimingsTotal: Record<string, number> = {}

  for (let tickIndex = 0; tickIndex < totalTicks; tickIndex++) {
    const tickT0 = performance.now()
    const result = tick({ state, rng: currentRng, config, namePoolService })
    tickTimeTotal += performance.now() - tickT0

    if (result.systemTimings) {
      for (const [sys, ms] of Object.entries(result.systemTimings)) {
        systemTimingsTotal[sys] = (systemTimingsTotal[sys] ?? 0) + ms
      }
    }

    const year = result.state.currentYear
    const weekOfYear = result.state.currentWeekOfYear
    const events = result.events
    const activePolities = countActivePolities(result.state)
    const activeHouses = countActiveHouses(result.state)

    for (const event of events) {
      if (event.type === 'POLITY_ANNEXED') {
        const refs = event.entityRefs ?? []
        for (const ref of refs) {
          if (ref.kind !== 'polity') continue
          const info = polityAnnexedInfo[ref.id]
          if (info) {
            info.year = year
          }
        }
      }
    }

    if (events.length > 0 && !args.digest) {
      if (args.json) {
        const output = {
          year,
          week: weekOfYear,
          events: events.map((e) => ({ type: e.type, summary: renderEvent(e) })),
          activePolities,
          activeHouses,
        }
        console.log(JSON.stringify(output))
      } else {
        console.log('Year ' + year + ', Week ' + weekOfYear)
        for (const event of events) {
          if (args.debug) {
            const ids = (event.entityRefs ?? []).map((r) => r.id)
            const idStr = ids.length > 0 ? ' [' + ids.join(', ') + ']' : ''
            console.log('  ' + event.type + ': ' + renderEvent(event) + idStr)
          } else {
            console.log('  ' + event.type + ': ' + renderEvent(event))
          }
        }
        console.log('')
      }
    }

    if (weekOfYear === 48) {
      if (args.debug) {
        const debugLog = createLogger(true)
        let livingPersons = 0
        for (const p of Object.values(result.state.persons)) {
          if (p?.alive) livingPersons++
        }
        const decisions = countDecisionEntities(result.state)
        debugLog.log('YEAR', {
          year,
          persons: livingPersons,
          houses: activeHouses,
          polities: activePolities,
          projects: decisions.activeProjects,
          plays: decisions.activePlays,
          pressures: decisions.activePressures,
          tasks: decisions.activeTasks,
          goals: decisions.activeGoals,
          aims: decisions.activeAims,
        })
      }

      if (args.json) {
        const output = {
          year,
          week: weekOfYear,
          events: events.map((e) => ({ type: e.type, summary: renderEvent(e) })),
          activePolities,
          activeHouses,
          decisions: buildDecisionSummary(result.state),
        }
        console.log(JSON.stringify(output))
      } else if (!args.digest) {
        console.log('')
        console.log('--- Year ' + year + ' Summary ---')
        const activeClans = Object.values(result.state.clans).filter((c) => c?.active).length
        console.log(
          '  Polities: ' +
            activePolities +
            ' active | Houses: ' +
            activeHouses +
            ' active | Clans: ' +
            activeClans +
            ' active',
        )
        const avgPolityControl = computeAvgPolityControl(result.state)
        const avgHouseControl = computeAvgHouseControl(result.state)
        console.log(
          '  Provinces: avg polityControl=' +
            avgPolityControl.toFixed(1) +
            ', avg houseControl=' +
            avgHouseControl.toFixed(1),
        )
        const holdingCount = countHoldings(result.state)
        const avgHDev = computeAvgHoldingDevelopment(result.state)
        const avgHCtrl = computeAvgHoldingPolityControl(result.state)
        console.log(
          '  Holdings: ' +
            holdingCount +
            ', avg dev=' +
            avgHDev.toFixed(1) +
            ', avg polityControl=' +
            avgHCtrl.toFixed(1),
        )
        const chainDepth = avgChainDepth(result.state)
        const lcCount = countLandContracts(result.state)
        const holdingBailiffs = countHoldingBailiffsByKind(result.state)
        const rebelCount = countRebelPolities(result.state)
        console.log(
          '  Land: ' +
            lcCount +
            ' contracts, avg chain depth=' +
            chainDepth.toFixed(1) +
            (rebelCount > 0 ? ' | Rebel polities: ' + rebelCount : ''),
        )
        console.log(
          '  Bailiffs: ' +
            holdingBailiffs.normal +
            ' normal / ' +
            holdingBailiffs.placeholder +
            ' placeholder' +
            (holdingBailiffs.vacant > 0 ? ' / ' + holdingBailiffs.vacant + ' vacant' : ''),
        )
        const eventCounts = countEventsByType(events)
        let totalYearEvents = 0
        for (const count of Object.values(eventCounts)) {
          totalYearEvents += count
        }
        const unrestStats = computeUnrestStats(result.state)
        console.log(
          '  Unrest: avg=' +
            unrestStats.avgUnrest.toFixed(1) +
            ' (peasants=' +
            unrestStats.avgPeasantUnrest.toFixed(1) +
            ', townsmen=' +
            unrestStats.avgTownsmenUnrest.toFixed(1) +
            ', nobles=' +
            unrestStats.avgNobleUnrest.toFixed(1) +
            ') | high(>50): ' +
            unrestStats.highUnrestCount +
            '/' +
            unrestStats.totalProvinces,
        )
        const econ = computeEconomyStats(result.state)
        console.log(
          '  Economy: popWealth=' +
            econ.avgPopWealth.toFixed(1) +
            ' | food p/base=' +
            econ.resource.food.avgPriceRatio.toFixed(2) +
            ' clamp=' +
            econ.resource.food.clampedPct.toFixed(0) +
            '% ful=' +
            econ.resource.food.avgFulfillment.toFixed(2) +
            ' | raw p/base=' +
            econ.resource.raw_materials.avgPriceRatio.toFixed(2) +
            ' clamp=' +
            econ.resource.raw_materials.clampedPct.toFixed(0) +
            '% | goods p/base=' +
            econ.resource.processed_goods.avgPriceRatio.toFixed(2) +
            ' clamp=' +
            econ.resource.processed_goods.clampedPct.toFixed(0) +
            '% ful=' +
            econ.resource.processed_goods.avgFulfillment.toFixed(2) +
            ' | owned=' +
            (econ.ownedRevenueRatio * 100).toFixed(0) +
            '% due=' +
            econ.totalHoldingDue.toFixed(0) +
            ' ownerInc=' +
            econ.totalOwnerIncome.toFixed(0),
        )
        const decisions = countDecisionEntities(result.state)
        console.log(
          '  Decisions: ' +
            decisions.activeProjects +
            ' projects / ' +
            decisions.activePlays +
            ' plays / ' +
            decisions.activePressures +
            ' pressures | ' +
            decisions.activeTasks +
            ' tasks / ' +
            decisions.activeGoals +
            ' goals / ' +
            decisions.activeAims +
            ' aims',
        )
        console.log('  Major events this year: ' + totalYearEvents)
        console.log('')
      }
    }

    state = result.state
    currentRng = result.rng
    for (const event of events) {
      allEvents.push(event)
    }

    // --report-snapshot 指定時、年末 (weekOfYear=52) かつ指定間隔で snapshot を取る
    if (
      args.reportPath !== undefined &&
      args.reportSnapshotYears > 0 &&
      weekOfYear === 48 &&
      year % args.reportSnapshotYears === 0
    ) {
      snapshots.push(takeSnapshot(result.state, year))
    }
  }

  const simElapsedMs = performance.now() - simStartTime

  if (args.perf) {
    const perfData = {
      elapsed: {
        totalMs: Math.round(simElapsedMs),
        tickTotalMs: Math.round(tickTimeTotal),
        tickAvgMs: Math.round((tickTimeTotal / totalTicks) * 1000) / 1000,
        ticks: totalTicks,
      },
      entities: {
        states: Object.keys(state.states).length,
        provinces: Object.keys(state.provinces).length,
        holdings: countHoldings(state),
        polities: countActivePolities(state),
        houses: countActiveHouses(state),
        persons: countLivingPersons(state),
        landContracts: countLandContracts(state),
      },
      seed: args.seed,
      preset: args.preset ?? 'default',
      years: args.years,
      systemTimings: Object.fromEntries(
        Object.entries(systemTimingsTotal)
          .sort(([, a], [, b]) => b - a)
          .map(([k, v]) => [k, Math.round(v)]),
      ),
    }
    if (args.json) {
      console.log(JSON.stringify(perfData))
    } else {
      process.stderr.write('\n=== PERF SUMMARY ===\n')
      process.stderr.write(
        `Seed: ${perfData.seed} | Preset: ${perfData.preset} | Years: ${perfData.years}\n`,
      )
      process.stderr.write(
        `Elapsed: ${perfData.elapsed.totalMs}ms (tick total: ${perfData.elapsed.tickTotalMs}ms, avg: ${perfData.elapsed.tickAvgMs}ms/tick, ${perfData.elapsed.ticks} ticks)\n`,
      )
      process.stderr.write(
        `Entities: ${perfData.entities.states} states, ${perfData.entities.provinces} provinces, ${perfData.entities.holdings} holdings, ${perfData.entities.polities} polities, ${perfData.entities.houses} houses, ${perfData.entities.persons} persons, ${perfData.entities.landContracts} contracts\n`,
      )
      process.stderr.write('System timings (ms):\n')
      for (const [sys, ms] of Object.entries(perfData.systemTimings)) {
        process.stderr.write(`  ${sys.padEnd(34)} ${String(ms).padStart(8)}\n`)
      }
    }
  }

  if (args.dumpWorld) {
    process.stderr.write(JSON.stringify(state, null, 2) + '\n')
  }

  if (args.reportPath !== undefined) {
    const report = buildActivityReport(state, allEvents, config, snapshots, {
      seed: args.seed,
      years: args.years,
    })
    const json = JSON.stringify(report, null, 2)
    if (args.reportPath === '-') {
      console.log(json)
    } else {
      writeFileSync(args.reportPath, json + '\n')
      process.stderr.write('Wrote activity report to ' + args.reportPath + '\n')
    }
  }

  if (args.digest) {
    const bailiffs = countHoldingBailiffsByKind(state)
    const digest = {
      seed: args.seed,
      years: args.years,
      finalYear: state.currentYear,
      finalWeekOfYear: state.currentWeekOfYear,
      activePolities: countActivePolities(state),
      activeHouses: countActiveHouses(state),
      livingPersons: countLivingPersons(state),
      totalProvinces: Object.keys(state.provinces).length,
      totalHoldings: countHoldings(state),
      totalStates: Object.keys(state.states).length,
      avgHoldingDevelopment: computeAvgHoldingDevelopment(state),
      avgHoldingPolityControl: computeAvgHoldingPolityControl(state),
      avgPolityControl: computeAvgPolityControl(state),
      avgHouseControl: computeAvgHouseControl(state),
      landContracts: countLandContracts(state),
      avgChainDepth: avgChainDepth(state),
      bailiffNormal: bailiffs.normal,
      bailiffPlaceholder: bailiffs.placeholder,
      bailiffVacant: bailiffs.vacant,
      rebelPolities: countRebelPolities(state),
      systemHouses: countSystemHouses(state),
      placeholderPersons: countPlaceholderPersons(state),
      eventCounts: countEventsByType(allEvents),
      totalEvents: allEvents.length,
    }
    console.log(JSON.stringify(digest, null, 2))
  }

  if (args.json) {
    const finalOutput = {
      year: state.currentYear,
      week: state.currentWeekOfYear,
      events: allEvents.map((e) => ({ type: e.type, summary: renderEvent(e) })),
      activePolities: countActivePolities(state),
      activeHouses: countActiveHouses(state),
    }
    console.log(JSON.stringify(finalOutput))
  } else if (!args.digest) {
    console.log('=== FINAL SUMMARY (after ' + args.years + ' years, ' + totalTicks + ' ticks) ===')
    const finalActivePolities = countActivePolities(state)
    const finalActiveHouses = countActiveHouses(state)
    console.log('Polities: ' + finalActivePolities + ' active / ' + initialPolityCount + ' initial')

    const provinceCounts = countProvincesPerPolity(state)
    for (const id of Object.keys(state.polities)) {
      const polity = state.polities[id as keyof typeof state.polities]
      if (!polity) continue
      const info = polityAnnexedInfo[id]
      if (!info) continue
      const name = info.nameKey
      if (polity.active) {
        const provCount = provinceCounts[id] || 0
        console.log(
          '  ' +
            name +
            ': ' +
            provCount +
            ' provinces, treasury=' +
            formatTreasury(polity.treasury),
        )
      } else {
        console.log('  [ANNEXED] ' + name + ' -> annexed (year ' + info.year + ')')
      }
    }

    console.log('Houses: ' + finalActiveHouses + ' active / ' + initialHouseCount + ' initial')

    const holdingTotal = countHoldings(state)
    const avgHDev = computeAvgHoldingDevelopment(state)
    const avgHCtrl = computeAvgHoldingPolityControl(state)
    const holdingBailiffs = countHoldingBailiffsByKind(state)
    console.log(
      'Holdings: ' +
        holdingTotal +
        ', avg dev=' +
        avgHDev.toFixed(1) +
        ', avg polityControl=' +
        avgHCtrl.toFixed(1) +
        ' | Bailiffs: ' +
        holdingBailiffs.normal +
        ' normal / ' +
        holdingBailiffs.placeholder +
        ' placeholder' +
        (holdingBailiffs.vacant > 0 ? ' / ' + holdingBailiffs.vacant + ' vacant' : ''),
    )

    const finalBailiffs = countHoldingBailiffsByKind(state)
    console.log(
      'Land: ' +
        countLandContracts(state) +
        ' contracts, avg chain depth=' +
        avgChainDepth(state).toFixed(1) +
        ' | Bailiffs: ' +
        finalBailiffs.normal +
        ' normal / ' +
        finalBailiffs.placeholder +
        ' placeholder' +
        (finalBailiffs.vacant > 0 ? ' / ' + finalBailiffs.vacant + ' vacant' : ''),
    )
    const finalRebelCount = countRebelPolities(state)
    if (finalRebelCount > 0) {
      console.log('Rebel polities ever formed: ' + finalRebelCount)
    }

    // v0.34 War: active / total + status 内訳。total が時間で発散しなければ cleanupWarSystem が機能している。
    const allWars = Object.values(state.wars)
    const warStatusCounts: Record<string, number> = {}
    for (const w of allWars) warStatusCounts[w.status] = (warStatusCounts[w.status] ?? 0) + 1
    const warBreakdown = Object.entries(warStatusCounts)
      .map(([k, v]) => k + '=' + v)
      .join(', ')
    console.log(
      'Wars: ' +
        (warStatusCounts['active'] ?? 0) +
        ' active / ' +
        allWars.length +
        ' total' +
        (warBreakdown ? ' (' + warBreakdown + ')' : ''),
    )

    // v0.37 §19.2: Regiment 集計 (B1 の平時 baseline 収束観察用)。active の avg org/morale が
    //   baseline 近傍 (org≈50 / morale≈30) なら recovery が機能。destroyed が時間で発散しないかも見る。
    const allRegiments = Object.values(state.regiments)
    let regActive = 0
    let regDestroyed = 0
    let regDisbanded = 0
    let sumStr = 0
    let sumOrg = 0
    let sumMor = 0
    let sumBaseOrg = 0
    let sumBaseMor = 0
    for (const r of allRegiments) {
      if (r.status === 'active') {
        regActive++
        sumStr += r.strength
        sumOrg += r.organization
        sumMor += r.morale
        sumBaseOrg += r.baselineOrganization
        sumBaseMor += r.baselineMorale
      } else if (r.status === 'destroyed') {
        regDestroyed++
      } else if (r.status === 'disbanded') {
        regDisbanded++
      }
    }
    const avgReg = (sum: number) => (regActive > 0 ? (sum / regActive).toFixed(1) : 'n/a')
    console.log(
      'Regiments: ' +
        regActive +
        ' active / ' +
        allRegiments.length +
        ' total (destroyed=' +
        regDestroyed +
        ', disbanded=' +
        regDisbanded +
        ') | active avg str=' +
        avgReg(sumStr) +
        ' org=' +
        avgReg(sumOrg) +
        ' morale=' +
        avgReg(sumMor) +
        ' (baseline org=' +
        avgReg(sumBaseOrg) +
        ' morale=' +
        avgReg(sumBaseMor) +
        ')',
    )

    console.log('Total events: ' + allEvents.length)
  }
} // end async main()

void main()
