import { generateWorld } from '@sim/worldgen/generateWorld'
import { tick } from '@sim/tick/tick'
import { defaultConfig } from '@sim/config/defaultConfig'
import { createTickContext } from '@sim/tick/context'
import { runIntegritySystem } from '@sim/tick/integritySystem'
import { createLogger } from '@sim/debug/logger'
import type { WorldState } from '@sim/types/world'
import type { SimEvent } from '@sim/types/event'

function printUsage(): void {
  console.log(`Usage: npm run cli [options]

Options:
  --seed <text>         Seed for world generation (default: "chronicae-default")
  --years <n>           Number of years to simulate (default: 10)
  --json                Output each tick as NDJSON
  --integrity-check     Run integrity check after every tick
  --debug               Enable debug mode (entity IDs in events, structured debug log on stderr)
  --dump-world          Dump full WorldState as JSON to stderr after simulation ends
  --digest              Output WorldDigest summary as JSON to stdout after simulation
  --help                Show this help message`)
}

function parseArgs(argv: string[]): {
  seed: string
  years: number
  json: boolean
  integrityCheck: boolean
  debug: boolean
  dumpWorld: boolean
  digest: boolean
  showHelp: boolean
} {
  let seed = 'chronicae-default'
  let years = 10
  let json = false
  let integrityCheck = false
  let debug = false
  let dumpWorld = false
  let digest = false
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
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--integrity-check') {
      integrityCheck = true
    } else if (arg === '--debug') {
      debug = true
    } else if (arg === '--dump-world') {
      dumpWorld = true
    } else if (arg === '--digest') {
      digest = true
    } else if (arg === '--help') {
      showHelp = true
    }
    i++
  }

  return { seed, years, json, integrityCheck, debug, dumpWorld, digest, showHelp }
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
    const polityId = province.polityId
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
    const province = state.provinces[id as keyof typeof state.provinces]
    if (!province) continue
    total += province.polityControl
    count++
  }
  if (count === 0) return 0
  return Math.round((total / count) * 10) / 10
}

function computeAvgHouseControl(state: WorldState): number {
  let total = 0
  let count = 0
  for (const id of Object.keys(state.provinces)) {
    const province = state.provinces[id as keyof typeof state.provinces]
    if (!province) continue
    total += province.houseControl
    count++
  }
  if (count === 0) return 0
  return Math.round((total / count) * 10) / 10
}

function countLivingPersons(state: WorldState): number {
  let count = 0
  for (const p of Object.values(state.persons)) {
    if (p?.alive) count++
  }
  return count
}

function countEventsByType(events: SimEvent[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const event of events) {
    result[event.type] = (result[event.type] ?? 0) + 1
  }
  return result
}

function formatTreasury(treasury: number): string {
  return String(Math.round(treasury))
}

const args = parseArgs(process.argv)

if (args.showHelp) {
  printUsage()
  process.exit(0)
}

const { world, rng: initialRng } = generateWorld(args.seed)

const initialPolityCount = countActivePolities(world)
const initialHouseCount = countActiveHouses(world)

const polityAnnexedInfo: Record<string, { name: string; year: number }> = {}
for (const id of Object.keys(world.polities)) {
  const polity = world.polities[id as keyof typeof world.polities]
  if (!polity) continue
  polityAnnexedInfo[id] = { name: polity.name, year: 0 }
}

let state: WorldState = world
let currentRng = initialRng
const allEvents: SimEvent[] = []
const totalTicks = args.years * 12
const config = args.debug ? { ...defaultConfig, debug: true } : defaultConfig

if (!args.json && !args.digest) {
  console.log('Starting simulation with seed:', args.seed)
  console.log('Simulating', args.years, 'years,', totalTicks, 'ticks')
  console.log('')
}

for (let tickIndex = 0; tickIndex < totalTicks; tickIndex++) {
  const result = tick({ state, rng: currentRng, config })

  if (args.integrityCheck) {
    const ctx = createTickContext({ state: result.state, rng: result.rng, config })
    runIntegritySystem(ctx)
  }

  const year = result.state.currentYear
  const month = result.state.currentMonth
  const events = result.events
  const activePolities = countActivePolities(result.state)
  const activeHouses = countActiveHouses(result.state)

  for (const event of events) {
    if (event.type === 'POLITY_ANNEXED') {
      for (const polityId of event.polityIds) {
        const info = polityAnnexedInfo[polityId]
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
        month,
        events: events.map((e) => ({ type: e.type, summary: e.summary })),
        activePolities,
        activeHouses,
      }
      console.log(JSON.stringify(output))
    } else {
      console.log('Year ' + year + ', Month ' + month)
      for (const event of events) {
        if (args.debug) {
          const ids = [
            ...(event.actorIds as string[]),
            ...(event.houseIds as string[]),
            ...(event.polityIds as string[]),
            ...(event.provinceIds as string[]),
          ]
          const idStr = ids.length > 0 ? ' [' + ids.join(', ') + ']' : ''
          console.log('  ' + event.type + ': ' + event.summary + idStr)
        } else {
          console.log('  ' + event.type + ': ' + event.summary)
        }
      }
      console.log('')
    }
  }

  if (month === 12) {
    if (args.debug) {
      const debugLog = createLogger(true)
      let livingPersons = 0
      for (const p of Object.values(result.state.persons)) {
        if (p?.alive) livingPersons++
      }
      debugLog.log('YEAR', {
        year,
        persons: livingPersons,
        houses: activeHouses,
        polities: activePolities,
      })
    }

    if (args.json) {
      const output = {
        year,
        month,
        events: events.map((e) => ({ type: e.type, summary: e.summary })),
        activePolities,
        activeHouses,
      }
      console.log(JSON.stringify(output))
    } else if (!args.digest) {
      console.log('')
      console.log('--- Year ' + year + ' Summary ---')
      console.log('  Polities: ' + activePolities + ' active | Houses: ' + activeHouses + ' active')
      const avgPolityControl = computeAvgPolityControl(result.state)
      const avgHouseControl = computeAvgHouseControl(result.state)
      console.log(
        '  Provinces: avg polityControl=' +
          avgPolityControl.toFixed(1) +
          ', avg houseControl=' +
          avgHouseControl.toFixed(1),
      )
      const eventCounts = countEventsByType(events)
      let totalYearEvents = 0
      for (const count of Object.values(eventCounts)) {
        totalYearEvents += count
      }
      console.log('  Major events this year: ' + totalYearEvents)
      console.log('')
    }
  }

  state = result.state
  currentRng = result.rng
  for (const event of events) {
    allEvents.push(event)
  }
}

if (args.dumpWorld) {
  process.stderr.write(JSON.stringify(state, null, 2) + '\n')
}

if (args.digest) {
  const digest = {
    seed: args.seed,
    years: args.years,
    finalYear: state.currentYear,
    finalMonth: state.currentMonth,
    activePolities: countActivePolities(state),
    activeHouses: countActiveHouses(state),
    livingPersons: countLivingPersons(state),
    totalProvinces: Object.keys(state.provinces).length,
    avgPolityControl: computeAvgPolityControl(state),
    avgHouseControl: computeAvgHouseControl(state),
    eventCounts: countEventsByType(allEvents),
    totalEvents: allEvents.length,
  }
  console.log(JSON.stringify(digest, null, 2))
}

if (args.json) {
  const finalOutput = {
    year: state.currentYear,
    month: state.currentMonth,
    events: allEvents.map((e) => ({ type: e.type, summary: e.summary })),
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
    const name = info.name
    if (polity.active) {
      const provCount = provinceCounts[id] || 0
      console.log(
        '  ' + name + ': ' + provCount + ' provinces, treasury=' + formatTreasury(polity.treasury),
      )
    } else {
      console.log('  [ANNEXED] ' + name + ' -> annexed (year ' + info.year + ')')
    }
  }

  console.log('Houses: ' + finalActiveHouses + ' active / ' + initialHouseCount + ' initial')

  console.log('Total events: ' + allEvents.length)
}
