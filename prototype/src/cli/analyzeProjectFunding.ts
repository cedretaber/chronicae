import { generateWorld } from '@sim/worldgen/generateWorld'
import type { WorldPresetName } from '@sim/worldgen/worldPresets'
import { tick } from '@sim/tick/tick'
import { defaultConfig } from '@sim/config/defaultConfig'
import { createNamePoolService } from '@sim/namegen/namePoolService'
import type { NamePoolData } from '@sim/namegen/namePoolTypes'
import type { WorldState } from '@sim/types/world'
import type { ProjectKind, ProjectTerminalReason } from '@sim/types/project'
import * as fs from 'node:fs'
import * as path from 'node:path'
import YAML from 'yaml'

// v0.60 観察用ハーネス: Project ライフサイクル (種別別の成功率・所要週・資金ラウンド数・失敗理由) と、
//   holding の不動産/施設の建設・維持を時系列で集計する。balance 判断材料 (config は触らない)。

const FUNDING_KINDS: ProjectKind[] = [
  'develop_holding',
  'develop_real_estate',
  'acquire_real_estate',
  'upgrade_owned_real_estate',
  'handle_crisis',
]

type Outcome = {
  kind: ProjectKind
  status: 'completed' | 'failed' | 'cancelled'
  terminalReason: ProjectTerminalReason | undefined
  durationWeeks: number
  fundingRounds: number
}

function parseArgs(argv: string[]): {
  seed: string
  years: number
  preset: WorldPresetName | undefined
  snapYears: number
  configOverrides: Record<string, unknown>
} {
  let seed = '1'
  let years = 150
  let preset: WorldPresetName | undefined = undefined
  let snapYears = 25
  let configOverrides: Record<string, unknown> = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--seed') seed = argv[++i] ?? seed
    else if (a === '--years') years = parseInt(argv[++i] ?? '150', 10)
    else if (a === '--preset') preset = argv[++i] as WorldPresetName
    else if (a === '--snap') snapYears = parseInt(argv[++i] ?? '25', 10)
    else if (a === '--config') {
      const val = argv[++i]
      if (val) {
        const parsed: unknown = JSON.parse(val)
        if (parsed && typeof parsed === 'object')
          configOverrides = parsed as Record<string, unknown>
      }
    }
  }
  return { seed, years, preset, snapYears, configOverrides }
}

function snapshotAssets(state: WorldState): {
  assets: number
  ownedAssets: number
  byKind: Record<string, number>
  avgLevel: number
  improvements: number
  avgCondition: number
  disrepairImprovements: number
  crisesDisrepair: number
  crisesTotal: number
} {
  let assets = 0
  let ownedAssets = 0
  let levelSum = 0
  const byKind: Record<string, number> = {}
  for (const a of Object.values(state.realEstateAssets)) {
    if (!a) continue
    assets++
    levelSum += a.level
    byKind[a.realEstateKind] = (byKind[a.realEstateKind] ?? 0) + 1
    if (a.owner) ownedAssets++
  }
  let improvements = 0
  let condSum = 0
  let disrepair = 0
  for (const imp of Object.values(state.holdingImprovements)) {
    if (!imp) continue
    improvements++
    condSum += imp.condition
    if (imp.condition < 50) disrepair++
  }
  let crisesDisrepair = 0
  let crisesTotal = 0
  for (const c of Object.values(state.crises)) {
    if (!c) continue
    crisesTotal++
    if (c.kind === 'disrepair') crisesDisrepair++
  }
  return {
    assets,
    ownedAssets,
    byKind,
    avgLevel: assets > 0 ? levelSum / assets : 0,
    improvements,
    avgCondition: improvements > 0 ? condSum / improvements : 0,
    disrepairImprovements: disrepair,
    crisesDisrepair,
    crisesTotal,
  }
}

function main(): void {
  const { seed, years, preset, snapYears, configOverrides } = parseArgs(process.argv)
  const totalTicks = years * 48

  const namePoolsPath = path.resolve(import.meta.dirname, '../sim/namegen/namePools.yaml')
  const namePoolData = YAML.parse(fs.readFileSync(namePoolsPath, 'utf-8')) as NamePoolData
  const namePoolService = createNamePoolService(namePoolData)

  const validKeys = new Set(Object.keys(defaultConfig))
  for (const k of Object.keys(configOverrides)) {
    if (!validKeys.has(k)) console.error(`Warning: unknown config key "${k}" (ignored)`)
  }
  const config = { ...defaultConfig, ...configOverrides }
  const { world, rng: initialRng } = generateWorld(seed, preset, namePoolService, config)

  let state: WorldState = world
  let rng = initialRng

  const recorded = new Set<string>()
  const outcomes: Outcome[] = []
  // tracked: active な 5種 Project の createdWeek/直近 fundingRounds。完了 Project は同 tick で flush され
  //   state から消えるため、events と vanish 検出を併用して完了を正確に捕捉する。
  const tracked = new Map<string, { kind: ProjectKind; createdWeek: number; rounds: number }>()
  // events ベースの権威カウント (種別→{completed,failed,cancelled})。
  const evtCount = new Map<string, { c: number; f: number; x: number }>()
  for (const k of FUNDING_KINDS) evtCount.set(k, { c: 0, f: 0, x: 0 })
  let evtFunded = 0
  let evtBuilt = 0
  let evtFundingFailed = 0
  // 失敗/中止の messageKey 内訳 (kind / messageKey → count)。terminalReason は messageKey に対応。
  const failKeyByKind = new Map<string, number>()
  // 完了 Project の所要週・ラウンド数 (kind→list)。同 tick の完了件数で vanished から上位を完了とみなす。
  const doneDur = new Map<string, { wk: number; rounds: number }[]>()
  for (const k of FUNDING_KINDS) doneDur.set(k, [])

  const header = `seed=${seed} years=${years} preset=${preset ?? 'tiny'}`
  console.log(`=== v0.60 Project funding 観察: ${header} ===`)
  if (Object.keys(configOverrides).length > 0) {
    console.log(`config overrides: ${JSON.stringify(configOverrides)}`)
  }
  console.log('')
  console.log(
    'year | assets(owned) | byKind | avgLvl | improv | avgCond | disrep | crises(disrepair)',
  )

  for (let t = 0; t < totalTicks; t++) {
    const result = tick({ state, rng, config, namePoolService })
    state = result.state
    rng = result.rng

    // events ベースの権威カウント。
    const compThisTick = new Map<string, number>()
    for (const e of result.events) {
      const kind = (e.messageParams as { kind?: unknown }).kind
      if (e.type === 'PROJECT_FUNDED') evtFunded++
      else if (e.type === 'PROJECT_BUILT') evtBuilt++
      if (e.messageKey === 'project.failed.funding') evtFundingFailed++
      if (typeof kind !== 'string') continue
      const slot = evtCount.get(kind)
      if (!slot) continue
      if (e.type === 'PROJECT_COMPLETED') {
        slot.c++
        compThisTick.set(kind, (compThisTick.get(kind) ?? 0) + 1)
      } else if (e.type === 'PROJECT_FAILED' || e.type === 'PROJECT_CANCELLED') {
        if (e.type === 'PROJECT_FAILED') slot.f++
        else slot.x++
        const fk = `${kind} / ${e.messageKey}`
        failKeyByKind.set(fk, (failKeyByKind.get(fk) ?? 0) + 1)
      }
    }

    // terminal Project を flush 前に捕捉する (失敗/中止は数週 lingering するため state で見える)。
    const currentIds = new Set<string>()
    for (const p of Object.values(state.projects)) {
      if (!p) continue
      const id = p.id as string
      currentIds.add(id)
      if (!FUNDING_KINDS.includes(p.kind)) continue
      if (p.status === 'active') {
        tracked.set(id, {
          kind: p.kind,
          createdWeek: p.createdWeek,
          rounds: p.fundingRoundCount ?? 0,
        })
        continue
      }
      // terminal だが state にまだ居る (lingering failed/cancelled)。
      if (recorded.has(id)) continue
      recorded.add(id)
      outcomes.push({
        kind: p.kind,
        status: p.status,
        terminalReason: p.terminalReason,
        durationWeeks: state.absoluteWeek - p.createdWeek,
        fundingRounds: p.fundingRoundCount ?? 0,
      })
    }
    // tracked から消えた Project を kind ごとに集め、同 tick の完了件数 (compThisTick) ぶんだけ
    //   所要週の長い順に「完了」とみなして doneDur に記録する (完了は複数ラウンドを経るため長い)。
    const vanishedByKind = new Map<string, { wk: number; rounds: number }[]>()
    for (const [id, info] of tracked) {
      if (currentIds.has(id)) continue
      tracked.delete(id)
      const arr = vanishedByKind.get(info.kind) ?? []
      arr.push({ wk: state.absoluteWeek - info.createdWeek, rounds: info.rounds })
      vanishedByKind.set(info.kind, arr)
    }
    for (const [kind, arr] of vanishedByKind) {
      const nComp = compThisTick.get(kind) ?? 0
      if (nComp <= 0) continue
      arr.sort((a, b) => b.wk - a.wk)
      const dst = doneDur.get(kind)
      if (!dst) continue
      for (let j = 0; j < Math.min(nComp, arr.length); j++) dst.push(arr[j]!)
    }

    if (state.currentWeekOfYear === 1 && state.currentYear % snapYears === 0) {
      const s = snapshotAssets(state)
      const kindStr = Object.entries(s.byKind)
        .map(([k, v]) => `${k[0]}${v}`)
        .join(',')
      console.log(
        `${String(state.currentYear).padStart(4)} | ${String(s.assets).padStart(3)}(${String(s.ownedAssets).padStart(3)}) | ${kindStr.padEnd(18)} | ${s.avgLevel.toFixed(1)} | ${String(s.improvements).padStart(4)} | ${s.avgCondition.toFixed(0).padStart(3)} | ${String(s.disrepairImprovements).padStart(4)} | ${s.crisesTotal}(${s.crisesDisrepair})`,
      )
    }
  }

  // 権威集計 (events ベース)。
  console.log(`\n=== Project outcomes (events ベース, 5 budget kinds, ${years}年) ===`)
  console.log(
    'kind                      | total | done | fail | canc | success% | avgWk(done) | avgRounds',
  )
  for (const kind of FUNDING_KINDS) {
    const s = evtCount.get(kind)!
    const total = s.c + s.f + s.x
    const rate = total > 0 ? ((s.c / total) * 100).toFixed(0) : '-'
    const dd = doneDur.get(kind) ?? []
    const avgWk = dd.length > 0 ? dd.reduce((a, d) => a + d.wk, 0) / dd.length : 0
    const avgR = dd.length > 0 ? dd.reduce((a, d) => a + d.rounds, 0) / dd.length : 0
    console.log(
      `${kind.padEnd(25)} | ${String(total).padStart(5)} | ${String(s.c).padStart(4)} | ${String(s.f).padStart(4)} | ${String(s.x).padStart(4)} | ${rate.padStart(7)}% | ${avgWk.toFixed(0).padStart(11)} | ${avgR.toFixed(2)}`,
    )
  }
  console.log(
    `\n  PROJECT_FUNDED イベント (raise_funds 成功ラウンド): ${evtFunded}  / PROJECT_BUILT: ${evtBuilt}  / funding_failed: ${evtFundingFailed}`,
  )

  // 失敗/中止理由内訳 (events ベース・authoritative)。
  console.log(`\n=== 失敗/中止理由内訳 (events messageKey ベース) ===`)
  for (const [k, v] of [...failKeyByKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`)
  }

  // 完了 Project の所要週 (lingering 検出は失敗を混入するため、完了のみ別途 vanish で概算)。
  //   注: vanish は同 tick flush の失敗も拾うため概算。authoritative な成否は上表を参照。
  void outcomes
}

void main()
