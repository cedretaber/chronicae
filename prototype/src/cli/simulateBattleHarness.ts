// v0.37 §19.3 連成 harness。simulateBattle pure helper を直接駆動し、damage/recovery を co-tune する。
//   B2a の最優先タスク: 1 戦の期待 organization damage ≈ baseline の 1/3〜1/2 / 数戦に1回再戦可能な回復比。
// 使い方:
//   node src/cli/runSimulateBattleHarness.mjs [--regiments N] [--frontage F] [--rounds R]
//       [--recovery-weeks W] [--seed S] [--base-org-damage X] [--recovery-per-week Y]
//   config は defaultConfig をベースに上記フラグで一部上書きする (defaultConfig は変更しない)。

import { defaultConfig } from '@sim/config/defaultConfig'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import { simulateBattle } from '@sim/helpers/simulateBattle'
import type { BattleSimInput, BattleSimRegimentInput } from '@sim/helpers/simulateBattle'
import { createRng } from '@sim/rng/rng'
import type { RngState } from '@sim/rng/rng'
import { clamp } from '@sim/utils/math'
import type { RegimentId, BattleId, WarId } from '@sim/types/ids'
import type { WarSideKey } from '@sim/types/war'

type HarnessRegiment = {
  id: string
  side: WarSideKey
  troopKind: 'infantry' | 'cavalry'
  strength: number
  organization: number
  morale: number
  baselineOrganization: number
  maxOrganization: number
  baselineMorale: number
  maxMorale: number
  basePower: number
}

function effectivePower(r: HarnessRegiment): number {
  const strengthFactor = clamp(r.strength / 100, 0, 1)
  const orgFactor = 0.5 + 0.5 * clamp(r.organization / 100, 0, 1)
  return r.basePower * strengthFactor * orgFactor
}

function toSimInput(r: HarnessRegiment): BattleSimRegimentInput {
  return {
    regimentId: r.id as RegimentId,
    side: r.side,
    troopKind: r.troopKind,
    strength: r.strength,
    organization: r.organization,
    morale: r.morale,
    baselineOrganization: r.baselineOrganization,
    maxOrganization: r.maxOrganization,
    baselineMorale: r.baselineMorale,
    maxMorale: r.maxMorale,
    basePower: r.basePower,
    effectivePower: effectivePower(r),
  }
}

// B1 recovery 式を 1 週間ぶん適用 (regimentRecoverySystem と同一)。
function recoverWeek(r: HarnessRegiment, cfg: SimulationConfig): void {
  const m0 = r.morale
  if (r.organization < r.baselineOrganization) {
    r.organization = Math.min(
      r.baselineOrganization,
      r.organization + cfg.regimentOrganizationRecoveryPerWeek * (0.5 + m0 / 100),
    )
  } else if (r.organization > r.baselineOrganization) {
    r.organization = Math.max(
      r.baselineOrganization,
      r.organization - cfg.regimentOrganizationDecayAboveBaselinePerWeek,
    )
  }
  r.organization = clamp(r.organization, 0, r.maxOrganization)
  if (r.morale < r.baselineMorale) {
    r.morale = Math.min(r.baselineMorale, r.morale + cfg.regimentMoraleRecoveryPerWeek)
  } else if (r.morale > r.baselineMorale) {
    r.morale = Math.max(r.baselineMorale, r.morale - cfg.regimentMoraleDecayAboveBaselinePerWeek)
  }
  r.morale = clamp(r.morale, 0, r.maxMorale)
}

function makeSide(side: WarSideKey, n: number, cfg: SimulationConfig): HarnessRegiment[] {
  const out: HarnessRegiment[] = []
  for (let i = 0; i < n; i++) {
    // 4 連隊に 1 つを cavalry にして混成 (deployment 規則を踏ませる)。
    const troopKind: 'infantry' | 'cavalry' = i % 4 === 3 ? 'cavalry' : 'infantry'
    out.push({
      id: `${side[0]}${i}`,
      side,
      troopKind,
      strength: 100,
      organization: cfg.regimentBaselineOrganizationDefault,
      morale: cfg.regimentBaselineMoraleDefault,
      baselineOrganization: cfg.regimentBaselineOrganizationDefault,
      maxOrganization: cfg.regimentMaxOrganizationDefault,
      baselineMorale: cfg.regimentBaselineMoraleDefault,
      maxMorale: cfg.regimentMaxMoraleDefault,
      basePower: 100,
    })
  }
  return out
}

function buildInput(
  attacker: HarnessRegiment[],
  defender: HarnessRegiment[],
  frontage: number,
  cfg: SimulationConfig,
  rng: RngState,
): BattleSimInput {
  return {
    battleId: 'bt-h' as BattleId,
    warId: 'w-h' as WarId,
    battlefieldKind: 'open_field',
    frontage,
    tickUnit: 'day',
    maxTicks: cfg.battleMaxTicks,
    attacker: attacker.map(toSimInput),
    defender: defender.map(toSimInput),
    attackerCommanders: [],
    defenderCommanders: [],
    config: cfg,
    rng,
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

function parseArgs(argv: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a && a.startsWith('--')) {
      const key = a.slice(2)
      const val = argv[i + 1]
      if (val !== undefined && !val.startsWith('--')) {
        out[key] = parseFloat(val)
        i++
      }
    }
  }
  return out
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const regiments = args['regiments'] ?? 8
  const frontage = args['frontage'] ?? defaultConfig.battlefieldFrontageByKind.open_field
  const rounds = args['rounds'] ?? 30
  const recoveryWeeks = args['recovery-weeks'] ?? 4
  const seed = String(args['seed'] ?? 1)

  const cfg: SimulationConfig = { ...defaultConfig }
  if (args['base-org-damage'] !== undefined)
    cfg.battleBaseOrganizationDamage = args['base-org-damage']
  if (args['recovery-per-week'] !== undefined)
    cfg.regimentOrganizationRecoveryPerWeek = args['recovery-per-week']

  console.log('=== simulateBattle harness (v0.37 §19.3) ===')
  console.log(
    `regiments/side=${regiments} frontage=${frontage} rounds=${rounds} recoveryWeeks=${recoveryWeeks} seed=${seed}`,
  )
  console.log(
    `baseOrgDamage=${cfg.battleBaseOrganizationDamage} maxTicks=${cfg.battleMaxTicks} recoveryPerWeek=${cfg.regimentOrganizationRecoveryPerWeek} baseline org=${cfg.regimentBaselineOrganizationDefault}/morale=${cfg.regimentBaselineMoraleDefault}`,
  )

  // --- (1) 単発 battle: baseline からの 1 戦で initial frontline が受ける org damage ---
  {
    let rng = createRng(seed + ':single')
    const orgDamages: number[] = []
    const ticksList: number[] = []
    const outcomeCounts: Record<string, number> = {}
    const resultCounts: Record<string, number> = {}
    const SAMPLES = 200
    for (let s = 0; s < SAMPLES; s++) {
      const atk = makeSide('attacker', regiments, cfg)
      const def = makeSide('defender', regiments, cfg)
      const input = buildInput(atk, def, frontage, cfg, rng)
      const res = simulateBattle(input)
      rng = res.rng
      ticksList.push(res.ticksElapsed)
      outcomeCounts[res.outcomeQuality] = (outcomeCounts[res.outcomeQuality] ?? 0) + 1
      resultCounts[res.result] = (resultCounts[res.result] ?? 0) + 1
      for (const rr of res.regimentResults) {
        if (rr.wasInitialFrontline) orgDamages.push(rr.organizationDamage)
      }
    }
    const baseline = cfg.regimentBaselineOrganizationDefault
    console.log('\n[1] 単発 battle (baseline 起点, 200 サンプル)')
    console.log(
      `  initial-frontline org damage: mean=${mean(orgDamages).toFixed(1)} median=${median(orgDamages).toFixed(1)} (baseline=${baseline}, 目標 1/3〜1/2 = ${(baseline / 3).toFixed(1)}〜${(baseline / 2).toFixed(1)})`,
    )
    console.log(`  ticksElapsed: mean=${mean(ticksList).toFixed(2)} median=${median(ticksList)}`)
    console.log(`  result: ${JSON.stringify(resultCounts)}`)
    console.log(`  outcomeQuality: ${JSON.stringify(outcomeCounts)}`)
  }

  // --- (2) 連戦 campaign: battle → 損耗適用 → recovery(W週) を rounds 回。steady-state org/morale ---
  {
    let rng = createRng(seed + ':campaign')
    const atk = makeSide('attacker', regiments, cfg)
    const def = makeSide('defender', regiments, cfg)
    const all = [...atk, ...def]
    const byId = new Map(all.map((r) => [r.id, r]))

    let minOrgEver = Infinity
    const preBattleOrgs: number[] = [] // 各 round の戦闘直前 avg org (再戦可能性の指標)
    for (let round = 0; round < rounds; round++) {
      preBattleOrgs.push(mean(all.map((r) => r.organization)))
      const input = buildInput(atk, def, frontage, cfg, rng)
      const res = simulateBattle(input)
      rng = res.rng
      for (const rr of res.regimentResults) {
        const r = byId.get(rr.regimentId)
        if (!r) continue
        r.organization = rr.organizationAfter
        r.morale = rr.moraleAfter
        r.strength = rr.strengthAfter
        minOrgEver = Math.min(minOrgEver, r.organization)
      }
      for (let w = 0; w < recoveryWeeks; w++) {
        for (const r of all) recoverWeek(r, cfg)
      }
    }
    console.log(`\n[2] 連戦 campaign (${rounds} rounds, recovery ${recoveryWeeks}週/round)`)
    console.log(
      `  最終 avg org=${mean(all.map((r) => r.organization)).toFixed(1)} morale=${mean(all.map((r) => r.morale)).toFixed(1)} strength=${mean(all.map((r) => r.strength)).toFixed(1)}`,
    )
    console.log(
      `  戦闘直前 avg org: 初回=${preBattleOrgs[0]!.toFixed(1)} 最終=${preBattleOrgs[preBattleOrgs.length - 1]!.toFixed(1)} (baseline 近傍なら再戦可能)`,
    )
    console.log(
      `  campaign 中の最小 org (戦闘直後)=${minOrgEver.toFixed(1)} (route 8 近傍に張り付かないか)`,
    )
  }

  // --- (3) 非対称 battle: 決着が出るか (実戦は両軍の連隊数/power が異なる) ---
  {
    let rng = createRng(seed + ':asym')
    const resultCounts: Record<string, number> = {}
    const outcomeCounts: Record<string, number> = {}
    const ticksList: number[] = []
    const SAMPLES = 200
    const defN = Math.max(1, Math.floor(regiments / 2))
    for (let s = 0; s < SAMPLES; s++) {
      const atk = makeSide('attacker', regiments, cfg)
      const def = makeSide('defender', defN, cfg)
      const res = simulateBattle(buildInput(atk, def, frontage, cfg, rng))
      rng = res.rng
      resultCounts[res.result] = (resultCounts[res.result] ?? 0) + 1
      outcomeCounts[res.outcomeQuality] = (outcomeCounts[res.outcomeQuality] ?? 0) + 1
      ticksList.push(res.ticksElapsed)
    }
    console.log(`\n[3] 非対称 battle (attacker ${regiments} vs defender ${defN}, 200 サンプル)`)
    console.log(`  result: ${JSON.stringify(resultCounts)}`)
    console.log(`  outcomeQuality: ${JSON.stringify(outcomeCounts)}`)
    console.log(`  ticksElapsed: mean=${mean(ticksList).toFixed(2)} median=${median(ticksList)}`)
  }
}

main()
