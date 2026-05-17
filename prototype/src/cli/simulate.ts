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

function countActiveCountries(state: WorldState): number {
  let count = 0
  for (const id of Object.keys(state.countries)) {
    const country = state.countries[id as keyof typeof state.countries]
    if (country && country.active) {
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

function countProvincesPerCountry(state: WorldState): Record<string, number> {
  const result: Record<string, number> = {}
  for (const id of Object.keys(state.provinces)) {
    const province = state.provinces[id as keyof typeof state.provinces]
    if (!province) continue
    const countryId = province.countryId
    if (!result[countryId]) {
      result[countryId] = 0
    }
    result[countryId]++
  }
  return result
}

function computeAvgCountryControl(state: WorldState): number {
  let total = 0
  let count = 0
  for (const id of Object.keys(state.provinces)) {
    const province = state.provinces[id as keyof typeof state.provinces]
    if (!province) continue
    total += province.countryControl
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

const initialCountryCount = countActiveCountries(world)
const initialHouseCount = countActiveHouses(world)

const countryAnnexedInfo: Record<string, { name: string; year: number }> = {}
for (const id of Object.keys(world.countries)) {
  const country = world.countries[id as keyof typeof world.countries]
  if (!country) continue
  countryAnnexedInfo[id] = { name: country.name, year: 0 }
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
  const activeCountries = countActiveCountries(result.state)
  const activeHouses = countActiveHouses(result.state)

  for (const event of events) {
    if (event.type === 'COUNTRY_ANNEXED') {
      for (const countryId of event.countryIds) {
        const info = countryAnnexedInfo[countryId]
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
        activeCountries,
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
            ...(event.countryIds as string[]),
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
        countries: activeCountries,
      })
    }

    if (args.json) {
      const output = {
        year,
        month,
        events: events.map((e) => ({ type: e.type, summary: e.summary })),
        activeCountries,
        activeHouses,
      }
      console.log(JSON.stringify(output))
    } else if (!args.digest) {
      console.log('')
      console.log('--- Year ' + year + ' Summary ---')
      console.log(
        '  Countries: ' + activeCountries + ' active | Houses: ' + activeHouses + ' active',
      )
      const avgCountryControl = computeAvgCountryControl(result.state)
      const avgHouseControl = computeAvgHouseControl(result.state)
      console.log(
        '  Provinces: avg countryControl=' +
          avgCountryControl.toFixed(1) +
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
    activeCountries: countActiveCountries(state),
    activeHouses: countActiveHouses(state),
    livingPersons: countLivingPersons(state),
    totalProvinces: Object.keys(state.provinces).length,
    avgCountryControl: computeAvgCountryControl(state),
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
    activeCountries: countActiveCountries(state),
    activeHouses: countActiveHouses(state),
  }
  console.log(JSON.stringify(finalOutput))
} else if (!args.digest) {
  console.log('=== FINAL SUMMARY (after ' + args.years + ' years, ' + totalTicks + ' ticks) ===')
  const finalActiveCountries = countActiveCountries(state)
  const finalActiveHouses = countActiveHouses(state)
  console.log(
    'Countries: ' + finalActiveCountries + ' active / ' + initialCountryCount + ' initial',
  )

  const provinceCounts = countProvincesPerCountry(state)
  for (const id of Object.keys(state.countries)) {
    const country = state.countries[id as keyof typeof state.countries]
    if (!country) continue
    const info = countryAnnexedInfo[id]
    if (!info) continue
    const name = info.name
    if (country.active) {
      const provCount = provinceCounts[id] || 0
      console.log(
        '  ' + name + ': ' + provCount + ' provinces, treasury=' + formatTreasury(country.treasury),
      )
    } else {
      console.log('  [ANNEXED] ' + name + ' -> annexed (year ' + info.year + ')')
    }
  }

  console.log('Houses: ' + finalActiveHouses + ' active / ' + initialHouseCount + ' initial')

  console.log('Total events: ' + allEvents.length)
}
