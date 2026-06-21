import { generateWorld } from '@sim/worldgen/generateWorld'
import { tick } from '@sim/tick/tick'
import { defaultConfig } from '@sim/config/defaultConfig'
import type { WorldState } from '@sim/types/world'
import type { PopStratum, PopType } from '@sim/types/popGroup'
import { POP_STRATA, POP_TYPES, getPopStratum } from '@sim/types/popGroup'
import { getHoldingClassCapacity } from '@sim/selectors/popSelectors'
import { classifyMobilityKind } from '@sim/config/popMobilityDefinitions'
import { createNamePoolService } from '@sim/namegen/namePoolService'
import type { NamePoolData } from '@sim/namegen/namePoolTypes'
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

// v0.56: v0.55 PopStratum/PopType + 転職・移住 snapshot に対応した POP 観測ツール。
//   旧版は byClass を peasants/townsmen/nobles で集計しており全 0 を出していた (v0.55 で stratum 値が
//   lower/middle/upper に移行済み)。

function weightedQuantile(items: { value: number; weight: number }[], q: number): number {
  const sorted = [...items].sort((a, b) => a.value - b.value)
  let total = 0
  for (const it of sorted) total += it.weight
  const first = sorted[0]
  if (total <= 0) return first ? first.value : 0
  const threshold = q * total
  let cum = 0
  for (const it of sorted) {
    cum += it.weight
    if (cum >= threshold) return it.value
  }
  const last = sorted[sorted.length - 1]
  return last ? last.value : 0
}

function collectPopStats(state: WorldState) {
  const byStratum: Record<
    PopStratum,
    { pop: number; capacity: number; employed: number; unemployed: number; wealthSum: number }
  > = {
    lower: { pop: 0, capacity: 0, employed: 0, unemployed: 0, wealthSum: 0 },
    middle: { pop: 0, capacity: 0, employed: 0, unemployed: 0, wealthSum: 0 },
    upper: { pop: 0, capacity: 0, employed: 0, unemployed: 0, wealthSum: 0 },
  }
  const wealthByStratum: Record<PopStratum, { value: number; weight: number }[]> = {
    lower: [],
    middle: [],
    upper: [],
  }
  const empByType = new Map<PopType, number>()
  const unempByType = new Map<PopType, number>()

  let totalPop = 0
  let totalWealth = 0
  let totalUnrest = 0

  for (const province of Object.values(state.provinces)) {
    if (!province) continue
    for (const holdingId of province.holdingIds) {
      for (const stratum of POP_STRATA) {
        byStratum[stratum].capacity += getHoldingClassCapacity(
          state,
          defaultConfig,
          holdingId,
          stratum,
        )
      }
    }
  }

  for (const pop of Object.values(state.popGroups)) {
    if (!pop) continue
    const s = byStratum[pop.class]
    s.pop += pop.size
    s.wealthSum += pop.wealth * pop.size
    if (pop.employed) {
      s.employed += pop.size
      empByType.set(pop.popType, (empByType.get(pop.popType) ?? 0) + pop.size)
    } else {
      s.unemployed += pop.size
      unempByType.set(pop.popType, (unempByType.get(pop.popType) ?? 0) + pop.size)
    }
    wealthByStratum[pop.class].push({ value: pop.wealth, weight: pop.size })
    totalPop += pop.size
    totalWealth += pop.wealth * pop.size
    totalUnrest += pop.unrest * pop.size
  }

  const totalCapacity = POP_STRATA.reduce((acc, s) => acc + byStratum[s].capacity, 0)
  const totalEmployed = POP_STRATA.reduce((acc, s) => acc + byStratum[s].employed, 0)
  const totalUnemployed = POP_STRATA.reduce((acc, s) => acc + byStratum[s].unemployed, 0)

  return {
    totalPop,
    totalCapacity,
    totalEmployed,
    totalUnemployed,
    avgWealth: totalPop > 0 ? totalWealth / totalPop : 0,
    avgUnrest: totalPop > 0 ? totalUnrest / totalPop : 0,
    byStratum,
    wealthByStratum,
    empByType,
    unempByType,
  }
}

function formatRow(
  year: number,
  stats: ReturnType<typeof collectPopStats>,
  state: WorldState,
): string {
  const mob = state.monthlyPopMobility
  return [
    String(year).padStart(4),
    Math.round(stats.totalPop).toString().padStart(7),
    Math.round(stats.totalCapacity).toString().padStart(7),
    (stats.totalCapacity > 0 ? stats.totalPop / stats.totalCapacity : 0).toFixed(2).padStart(5),
    (stats.totalPop > 0 ? (stats.totalEmployed / stats.totalPop) * 100 : 0).toFixed(0).padStart(4) +
      '%',
    stats.avgWealth.toFixed(1).padStart(6),
    stats.avgUnrest.toFixed(1).padStart(6),
    Math.round(stats.byStratum.lower.pop).toString().padStart(7),
    Math.round(stats.byStratum.middle.pop).toString().padStart(7),
    Math.round(stats.byStratum.upper.pop).toString().padStart(6),
    (mob ? mob.jobChangedTotal : 0).toFixed(2).padStart(7),
    (mob ? mob.migratedTotal : 0).toFixed(2).padStart(6),
  ].join(' | ')
}

function printHeader(): void {
  const header = [
    'Year'.padStart(4),
    'TotPop'.padStart(7),
    'TotCap'.padStart(7),
    'Fill'.padStart(5),
    'EmpRt'.padStart(5),
    'Wealth'.padStart(6),
    'Unrest'.padStart(6),
    'Lower'.padStart(7),
    'Middle'.padStart(7),
    'Upper'.padStart(6),
    'JobChg'.padStart(7),
    'Migr'.padStart(6),
  ].join(' | ')
  console.log(header)
  console.log('-'.repeat(header.length))
}

function printFinalBreakdown(state: WorldState): void {
  const stats = collectPopStats(state)

  console.log('')
  console.log('=== Final Breakdown by Stratum ===')
  for (const stratum of POP_STRATA) {
    const d = stats.byStratum[stratum]
    const empRate = d.pop > 0 ? ((d.employed / d.pop) * 100).toFixed(1) : '0.0'
    const avgWealth = d.pop > 0 ? d.wealthSum / d.pop : 0
    console.log(
      `  ${stratum.padEnd(7)}: pop=${Math.round(d.pop).toString().padStart(7)}, ` +
        `cap=${Math.round(d.capacity).toString().padStart(7)}, ` +
        `emp=${Math.round(d.employed).toString().padStart(7)}, ` +
        `unemp=${Math.round(d.unemployed).toString().padStart(7)}, ` +
        `empRate=${empRate}%, avgWealth=${avgWealth.toFixed(1)}`,
    )
  }

  console.log('')
  console.log('=== Wealth distribution by Stratum (size-weighted) ===')
  for (const stratum of POP_STRATA) {
    const arr = stats.wealthByStratum[stratum]
    if (arr.length === 0) {
      console.log(`  ${stratum.padEnd(7)}: (no pops)`)
      continue
    }
    const ge60 = arr.filter((x) => x.value >= 60).reduce((a, b) => a + b.weight, 0)
    const total = arr.reduce((a, b) => a + b.weight, 0)
    console.log(
      `  ${stratum.padEnd(7)}: p25=${weightedQuantile(arr, 0.25).toFixed(0).padStart(3)}, ` +
        `median=${weightedQuantile(arr, 0.5).toFixed(0).padStart(3)}, ` +
        `p75=${weightedQuantile(arr, 0.75).toFixed(0).padStart(3)}, ` +
        `wealth>=60: ${((100 * ge60) / total).toFixed(1)}% of pop`,
    )
  }

  console.log('')
  console.log('=== Employed / Unemployed by PopType ===')
  for (const popType of POP_TYPES) {
    const emp = stats.empByType.get(popType) ?? 0
    const unemp = stats.unempByType.get(popType) ?? 0
    if (emp + unemp < 0.5) continue
    console.log(
      `  ${popType.padEnd(13)}(${getPopStratum(popType).padEnd(6)}): ` +
        `emp=${Math.round(emp).toString().padStart(7)}, unemp=${Math.round(unemp).toString().padStart(7)}`,
    )
  }

  // mobility kind distribution from the last snapshot's topMovements (sample, not exhaustive).
  const mob = state.monthlyPopMobility
  console.log('')
  console.log('=== Last-month mobility (snapshot) ===')
  if (!mob) {
    console.log('  (no snapshot)')
    return
  }
  const kinds = { lateral: 0, promotion: 0, demotion: 0, migration: 0 }
  for (const m of mob.topMovements) {
    if (m.kind === 'migration') kinds.migration++
    else kinds[classifyMobilityKind(m.fromPopType, m.toPopType)]++
  }
  console.log(
    `  jobChangedTotal=${mob.jobChangedTotal.toFixed(3)}, migratedTotal=${mob.migratedTotal.toFixed(3)}`,
  )
  console.log(
    `  topMovements kinds: lateral=${kinds.lateral} promotion=${kinds.promotion} ` +
      `demotion=${kinds.demotion} migration=${kinds.migration} (top ${mob.topMovements.length})`,
  )
}

function main() {
  const args = process.argv.slice(2)
  let seed = '1'
  let years = 20
  let preset = 'small'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed' && args[i + 1]) {
      i++
      seed = args[i]!
    } else if (args[i] === '--years' && args[i + 1]) {
      i++
      years = parseInt(args[i]!, 10)
    } else if (args[i] === '--preset' && args[i + 1]) {
      i++
      preset = args[i]!
    }
  }

  const namePoolPath = path.resolve(process.cwd(), 'src/sim/namegen/namePools.yaml')
  const poolData = YAML.parse(fs.readFileSync(namePoolPath, 'utf8')) as NamePoolData
  const nameService = createNamePoolService(poolData)

  console.log(`=== POP Dynamics Analysis (v0.56) ===`)
  console.log(`Seed: ${seed} | Years: ${years} | Preset: ${preset}`)
  console.log('')

  const worldResult = generateWorld(
    seed,
    preset as 'tiny' | 'small' | 'standard' | 'perfLarge',
    nameService,
  )
  let state = worldResult.world
  let rng = worldResult.rng

  printHeader()
  console.log(formatRow(state.currentYear, collectPopStats(state), state))

  const totalWeeks = years * 48
  for (let w = 0; w < totalWeeks; w++) {
    const result = tick({ state, rng, config: defaultConfig })
    state = result.state
    rng = result.rng
    if (state.currentWeekOfYear === 48) {
      console.log(formatRow(state.currentYear, collectPopStats(state), state))
    }
  }

  printFinalBreakdown(state)
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
