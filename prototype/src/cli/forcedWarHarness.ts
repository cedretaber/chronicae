// v0.37 §19.3 forced-war harness。tick() 経由で warManeuverSystem を駆動し、internal BattleSimulation
//   の配線 (snapshot / warScoreDelta / createBattle / destroy / §18 integrity) を実戦で検証する。
//   自然 100 年では戦争が希少なので強制開戦し、多様な power 比 (even / 攻側優勢 / 防側優勢 / 0連隊) を回す。
//   integrity は tick() 内部の year-end check (flush 後) に委ね、Battle entity の §18 invariant と
//   warScoreDelta 符号整合は collect 時にインライン検証する (transient battle も全数)。
// 使い方: node src/cli/runForcedWarHarness.mjs [--seeds 1,42,123,999] [--max-weeks 300]

import { generateWorld } from '@sim/worldgen/generateWorld'
import { tick } from '@sim/tick/tick'
import { defaultConfig } from '@sim/config/defaultConfig'
import { createWar } from '@sim/mutations/warMutations'
import { disbandRegimentMut } from '@sim/mutations/regimentMutations'
import { getHoldingTerminalPolityId } from '@sim/selectors/landContractSelectors'
import { politicalActorKey } from '@sim/selectors/actorSelectors'
import type { WorldState } from '@sim/types/world'
import type { PolityId, HoldingId, WarId } from '@sim/types/ids'

type Scenario = 'even' | 'attacker_strong' | 'defender_strong' | 'defender_empty'

function pick(
  world: WorldState,
): { holdingId: HoldingId; owner: PolityId; other: PolityId } | null {
  const active = Object.values(world.polities)
    .filter((p) => p && p.active)
    .map((p) => p.id)
  for (const hid of Object.keys(world.holdings) as HoldingId[]) {
    const owner = getHoldingTerminalPolityId(world, hid)
    if (!owner || !world.polities[owner]?.active) continue
    const other = active.find((id) => (id as string) !== (owner as string))
    if (!other) continue
    return { holdingId: hid, owner, other }
  }
  return null
}

// 指定 polity が owner の active Regiment の一部を disband する (keepRatio=連隊数を実効的に減らし非対称化)。
//   battle は残存 org 合計で決まり reserve の無傷 org が支配的なので、連隊「数」を削る方が power 比が効く。
//   keepRatio=0 は全 disband (0連隊 auto-resolve)。
function perturbSide(world: WorldState, polity: PolityId, keepRatio: number): void {
  const ids = [
    ...(world.regimentIndex.byOwner[politicalActorKey({ kind: 'polity', id: polity })] ?? []),
  ]
  const active = ids.filter((rid) => world.regiments[rid]?.status === 'active')
  const keep = Math.floor(active.length * keepRatio)
  for (let i = keep; i < active.length; i++) {
    disbandRegimentMut(world, active[i]!)
  }
}

type BattleRow = {
  result: string
  outcomeQuality: string | undefined
  warScoreDelta: number
  ticksElapsed: number | undefined
}

// §18 Battle summary invariants をインライン検査 (battle は war 終結で cleanup されるため全数を直検証)。
//   tick() 内部の year-end integrity は flush 後に走るので transient battle を見逃すことがある。
function validateBattleSummary(b: {
  frontage?: number
  maxTicks?: number
  ticksElapsed?: number
  attackerRegimentIds: readonly string[]
  defenderRegimentIds: readonly string[]
  attackerInitialFrontlineIds?: readonly string[]
  defenderInitialFrontlineIds?: readonly string[]
  attackerRoutedRegimentIds?: readonly string[]
  defenderRoutedRegimentIds?: readonly string[]
  regimentResults: readonly { regimentId: string }[]
}): number {
  let v = 0
  if (b.frontage !== undefined && b.frontage <= 0) v++
  if (b.ticksElapsed !== undefined && b.maxTicks !== undefined && b.ticksElapsed > b.maxTicks) v++
  const atk = new Set<string>(b.attackerRegimentIds)
  const def = new Set<string>(b.defenderRegimentIds)
  const union = new Set<string>([...b.attackerRegimentIds, ...b.defenderRegimentIds])
  const subset = (ids: readonly string[] | undefined, allowed: Set<string>) =>
    (ids ?? []).every((id) => allowed.has(id))
  if (!subset(b.attackerInitialFrontlineIds, atk)) v++
  if (!subset(b.defenderInitialFrontlineIds, def)) v++
  if (!subset(b.attackerRoutedRegimentIds, atk)) v++
  if (!subset(b.defenderRoutedRegimentIds, def)) v++
  if (!b.regimentResults.every((rr) => union.has(rr.regimentId))) v++
  return v
}

function runScenario(
  seed: string,
  scenario: Scenario,
  maxWeeks: number,
): {
  battles: BattleRow[]
  warWeeks: number
  termination: string
  signViolations: number
  integrityViolations: number
  destroyedDelta: number
} {
  const gen = generateWorld(seed)
  let state = gen.world
  let rng = gen.rng
  const config = defaultConfig

  const picked = pick(state)
  if (!picked) throw new Error(`no polities for seed ${seed}`)
  const { holdingId, owner, other } = picked

  // attacker = other, defender = owner。連隊数を削って power 比を作る。
  if (scenario === 'attacker_strong')
    perturbSide(state, owner, 0.3) // defender を 30% に減勢 → attacker 優勢
  else if (scenario === 'defender_strong')
    perturbSide(state, other, 0.3) // attacker を 30% に減勢 → defender 優勢
  else if (scenario === 'defender_empty') perturbSide(state, owner, 0)

  const war = createWar(state, {
    attacker: { kind: 'polity', id: other },
    defender: { kind: 'polity', id: owner },
    warGoals: [
      {
        kind: 'transfer_land_contract',
        holdingId,
        fromPolityId: owner,
        toPolityId: other,
        requiredWarScore: 40,
      },
    ],
    targetWarScore: 50,
    startedWeek: state.absoluteWeek,
  })
  const warId: WarId = war.id

  const countDestroyed = (s: WorldState) =>
    Object.values(s.regiments).filter((r) => r.status === 'destroyed').length
  const destroyedBefore = countDestroyed(state)

  const seen = new Set<string>()
  const battles: BattleRow[] = []
  let signViolations = 0
  let integrityViolations = 0
  let warWeeks = 0
  let termination = 'unresolved'

  for (let w = 0; w < maxWeeks; w++) {
    // tick() 内部で year-end (flush 後) integrity が走り、違反時は throw する (正規ゲート)。
    const res = tick({ state, rng, config })
    state = res.state
    rng = res.rng

    // この war の新規 Battle を収集 (cleanup 前に拾う)。
    const bids = state.battleIndex.byWar[warId] ?? []
    for (const bid of bids) {
      if (seen.has(bid)) continue
      seen.add(bid)
      const b = state.battles[bid]
      if (!b) continue
      battles.push({
        result: b.result,
        outcomeQuality: b.outcomeQuality,
        warScoreDelta: b.warScoreDelta,
        ticksElapsed: b.ticksElapsed,
      })
      // §18 Battle summary invariants をインライン検証 (Battle の RegimentId[] は readonly string[] を満たす)。
      integrityViolations += validateBattleSummary(b)
      // 符号整合: result と warScoreDelta の符号一致 (§15.1)。
      const sign = b.result === 'attacker_victory' ? 1 : b.result === 'defender_victory' ? -1 : 0
      const deltaSign = b.warScoreDelta > 0 ? 1 : b.warScoreDelta < 0 ? -1 : 0
      if (sign !== deltaSign) signViolations++
    }

    const wnow = state.wars[warId]
    if (!wnow || wnow.status !== 'active') {
      warWeeks = w + 1
      termination = wnow ? wnow.status : 'cleaned'
      break
    }
    warWeeks = w + 1
  }

  return {
    battles,
    warWeeks,
    termination,
    signViolations,
    integrityViolations,
    destroyedDelta: countDestroyed(state) - destroyedBefore,
  }
}

function tally(rows: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[r] = (out[r] ?? 0) + 1
  return out
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!
}

function main(): void {
  const argv = process.argv.slice(2)
  let seeds = ['1', '42', '123', '999']
  let maxWeeks = 300
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seeds' && argv[i + 1]) seeds = argv[i + 1]!.split(',')
    if (argv[i] === '--max-weeks' && argv[i + 1]) maxWeeks = parseInt(argv[i + 1]!, 10)
  }
  const scenarios: Scenario[] = ['even', 'attacker_strong', 'defender_strong', 'defender_empty']

  console.log('=== forced-war harness (v0.37 §19.3, tick() 経由・integrity ON) ===')
  console.log(`seeds=${seeds.join(',')} maxWeeks=${maxWeeks}`)

  let totalSignViolations = 0
  let totalIntegrityViolations = 0
  for (const scenario of scenarios) {
    const allResults: string[] = []
    const allOutcomes: string[] = []
    const allTicks: number[] = []
    const allDeltas: number[] = []
    const warWeeksList: number[] = []
    const termList: string[] = []
    let battleCount = 0
    let destroyedTotal = 0

    for (const seed of seeds) {
      const r = runScenario(seed, scenario, maxWeeks)
      totalSignViolations += r.signViolations
      totalIntegrityViolations += r.integrityViolations
      battleCount += r.battles.length
      destroyedTotal += r.destroyedDelta
      warWeeksList.push(r.warWeeks)
      termList.push(r.termination)
      for (const b of r.battles) {
        allResults.push(b.result)
        if (b.outcomeQuality) allOutcomes.push(b.outcomeQuality)
        if (b.ticksElapsed !== undefined) allTicks.push(b.ticksElapsed)
        allDeltas.push(b.warScoreDelta)
      }
    }

    const battlesPerWar = (battleCount / seeds.length).toFixed(1)
    console.log(`\n--- scenario: ${scenario} (${seeds.length} seeds) ---`)
    console.log(`  battles total=${battleCount} (avg ${battlesPerWar}/war)`)
    console.log(`  result: ${JSON.stringify(tally(allResults))}`)
    console.log(`  outcomeQuality: ${JSON.stringify(tally(allOutcomes))}`)
    console.log(
      `  ticksElapsed: median=${median(allTicks)} | warScoreDelta: median=${median(allDeltas).toFixed(1)} max=${Math.max(0, ...allDeltas.map(Math.abs)).toFixed(1)}`,
    )
    console.log(
      `  war 決着まで: median=${median(warWeeksList)}週 termination=${JSON.stringify(tally(termList))}`,
    )
    console.log(`  destroyed 増加=${destroyedTotal}`)
  }

  console.log(`\n=== gate ===`)
  console.log(
    `sign-integrity violations (result vs warScoreDelta): ${totalSignViolations} ${totalSignViolations === 0 ? 'OK' : 'FAIL'}`,
  )
  console.log(
    `§18 Battle summary integrity violations: ${totalIntegrityViolations} ${totalIntegrityViolations === 0 ? 'OK' : 'FAIL'}`,
  )
  console.log('(per-tick full integrity は tick() 内部の year-end check に委譲)')
}

main()
