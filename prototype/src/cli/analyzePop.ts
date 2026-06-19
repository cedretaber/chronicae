import { generateWorld } from '@sim/worldgen/generateWorld'
import { tick } from '@sim/tick/tick'
import { defaultConfig } from '@sim/config/defaultConfig'
import type { WorldState } from '@sim/types/world'
import type { PopClass } from '@sim/types/popGroup'
import type { ProvinceId } from '@sim/types/ids'
import {
  getProvincePopulation,
  getProvinceCarryingCapacity,
  getHoldingClassCapacity,
  getHoldingEmployedPopSize,
  getHoldingUnemployedPopSize,
} from '@sim/selectors/popSelectors'
import { clamp } from '@sim/utils/math'
import { createNamePoolService } from '@sim/namegen/namePoolService'
import type { NamePoolData } from '@sim/namegen/namePoolTypes'
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

const POP_CLASSES: PopClass[] = ['peasants', 'townsmen', 'nobles']

function collectPopStats(state: WorldState) {
  let totalPop = 0
  let totalCapacity = 0
  let totalEmployed = 0
  let totalUnemployed = 0
  let totalWealth = 0
  let totalUnrest = 0
  let popCount = 0

  const byClass: Record<
    string,
    {
      pop: number
      capacity: number
      employed: number
      unemployed: number
      wealth: number
      unrest: number
      count: number
    }
  > = {
    peasants: { pop: 0, capacity: 0, employed: 0, unemployed: 0, wealth: 0, unrest: 0, count: 0 },
    townsmen: { pop: 0, capacity: 0, employed: 0, unemployed: 0, wealth: 0, unrest: 0, count: 0 },
    nobles: { pop: 0, capacity: 0, employed: 0, unemployed: 0, wealth: 0, unrest: 0, count: 0 },
  }

  for (const provinceId of Object.keys(state.provinces)) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue

    for (const holdingId of province.holdingIds) {
      for (const popClass of POP_CLASSES) {
        const cap = getHoldingClassCapacity(state, defaultConfig, holdingId, popClass)
        const employed = getHoldingEmployedPopSize(state, holdingId, popClass)
        const unemployed = getHoldingUnemployedPopSize(state, holdingId, popClass)

        const cls = byClass[popClass]
        if (!cls) continue
        cls.capacity += cap
        cls.employed += employed
        cls.unemployed += unemployed
        cls.pop += employed + unemployed

        totalCapacity += cap
        totalEmployed += employed
        totalUnemployed += unemployed
      }
    }
  }

  for (const pop of Object.values(state.popGroups)) {
    if (!pop) continue
    totalPop += pop.size
    totalWealth += pop.wealth * pop.size
    totalUnrest += pop.unrest * pop.size
    popCount++

    const cls = byClass[pop.class]
    if (cls) {
      cls.wealth += pop.wealth * pop.size
      cls.unrest += pop.unrest * pop.size
      cls.count++
    }
  }

  for (const cls of Object.values(byClass)) {
    if (cls.pop > 0) {
      cls.wealth = cls.wealth / cls.pop
      cls.unrest = cls.unrest / cls.pop
    }
  }

  const pressures: number[] = []
  for (const provinceId of Object.keys(state.provinces)) {
    const province = state.provinces[provinceId as ProvinceId]
    if (!province) continue
    const pop = getProvincePopulation(state, provinceId as ProvinceId)
    const cap = getProvinceCarryingCapacity(state, defaultConfig, provinceId as ProvinceId)
    if (cap > 0) pressures.push(clamp(pop / cap, 0, 2))
  }

  const avgPressure =
    pressures.length > 0 ? pressures.reduce((a, b) => a + b, 0) / pressures.length : 0
  const maxPressure = pressures.length > 0 ? Math.max(...pressures) : 0
  const overPressureCount = pressures.filter((p) => p > 1).length

  return {
    totalPop: Math.round(totalPop),
    totalCapacity: Math.round(totalCapacity),
    fillRatio: totalCapacity > 0 ? totalPop / totalCapacity : 0,
    totalEmployed: Math.round(totalEmployed),
    totalUnemployed: Math.round(totalUnemployed),
    employmentRate: totalPop > 0 ? totalEmployed / totalPop : 1,
    avgWealth: totalPop > 0 ? totalWealth / totalPop : 0,
    avgUnrest: totalPop > 0 ? totalUnrest / totalPop : 0,
    avgPressure,
    maxPressure,
    overPressureCount,
    totalProvinces: pressures.length,
    popGroupCount: popCount,
    byClass,
  }
}

function formatRow(year: number, stats: ReturnType<typeof collectPopStats>): string {
  const p = stats.byClass.peasants!
  const t = stats.byClass.townsmen!
  const n = stats.byClass.nobles!
  return [
    String(year).padStart(4),
    String(stats.totalPop).padStart(7),
    String(stats.totalCapacity).padStart(7),
    stats.fillRatio.toFixed(2).padStart(6),
    (stats.employmentRate * 100).toFixed(1).padStart(6) + '%',
    String(stats.totalUnemployed).padStart(7),
    stats.avgWealth.toFixed(1).padStart(7),
    stats.avgUnrest.toFixed(1).padStart(7),
    stats.avgPressure.toFixed(2).padStart(7),
    String(stats.overPressureCount).padStart(5) + '/' + String(stats.totalProvinces),
    // per-class pop
    String(Math.round(p.pop)).padStart(7),
    String(Math.round(t.pop)).padStart(7),
    String(Math.round(n.pop)).padStart(7),
    // per-class unemployed
    String(Math.round(p.unemployed)).padStart(7),
    String(Math.round(t.unemployed)).padStart(7),
    String(Math.round(n.unemployed)).padStart(7),
  ].join(' | ')
}

function printHeader(): void {
  const header = [
    'Year'.padStart(4),
    'TotPop'.padStart(7),
    'TotCap'.padStart(7),
    'Fill'.padStart(6),
    'EmpRt'.padStart(7),
    'Unemp'.padStart(7),
    'Wealth'.padStart(7),
    'Unrest'.padStart(7),
    'AvgPrs'.padStart(7),
    'Over'.padStart(10),
    'Peasnt'.padStart(7),
    'Townsm'.padStart(7),
    'Nobles'.padStart(7),
    'P.Unem'.padStart(7),
    'T.Unem'.padStart(7),
    'N.Unem'.padStart(7),
  ].join(' | ')
  console.log(header)
  console.log('-'.repeat(header.length))
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

  console.log(`=== POP Dynamics Analysis ===`)
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

  const initStats = collectPopStats(state)
  console.log(formatRow(state.currentYear, initStats))

  const totalWeeks = years * 48
  for (let w = 0; w < totalWeeks; w++) {
    const result = tick({
      state,
      rng,
      config: defaultConfig,
    })
    state = result.state
    rng = result.rng

    if (state.currentWeekOfYear === 48) {
      const stats = collectPopStats(state)
      console.log(formatRow(state.currentYear, stats))
    }
  }

  console.log('')
  console.log('=== Final Breakdown by Class ===')
  const final = collectPopStats(state)
  for (const [cls, data] of Object.entries(final.byClass)) {
    const empRate = data.pop > 0 ? ((data.employed / data.pop) * 100).toFixed(1) : '100.0'
    console.log(
      `  ${cls.padEnd(10)}: pop=${Math.round(data.pop).toString().padStart(6)}, ` +
        `cap=${Math.round(data.capacity).toString().padStart(6)}, ` +
        `employed=${Math.round(data.employed).toString().padStart(6)}, ` +
        `unemployed=${Math.round(data.unemployed).toString().padStart(6)}, ` +
        `empRate=${empRate}%, ` +
        `wealth=${data.wealth.toFixed(1)}, unrest=${data.unrest.toFixed(1)}`,
    )
  }
  console.log(
    `  ${'TOTAL'.padEnd(10)}: pop=${final.totalPop.toString().padStart(6)}, ` +
      `cap=${final.totalCapacity.toString().padStart(6)}, ` +
      `employed=${final.totalEmployed.toString().padStart(6)}, ` +
      `unemployed=${final.totalUnemployed.toString().padStart(6)}, ` +
      `empRate=${(final.employmentRate * 100).toFixed(1)}%, ` +
      `fill=${final.fillRatio.toFixed(2)}, pressure=${final.avgPressure.toFixed(2)}`,
  )
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
