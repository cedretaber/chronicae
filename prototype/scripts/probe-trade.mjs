#!/usr/bin/env node
// v0.61 trade route probe: --dump-world JSON を引数に取り stored フィールドを集計する。
// Usage: node scripts/probe-trade.mjs /tmp/dump42.json
import fs from 'fs'
const path = process.argv[2]
if (!path) {
  console.error('Usage: node probe-trade.mjs <dump-world.json>')
  process.exit(1)
}
const dump = JSON.parse(fs.readFileSync(path, 'utf8'))
const state = dump.state,
  cfg = dump.config

const pct = (a, p) => {
  const s = a.slice().sort((x, y) => x - y)
  return s[Math.floor(s.length * p)]
}
const fmt = (n) => (n === undefined ? '-' : typeof n === 'number' ? n.toFixed(2) : n)

// --- Companies ---
const companies = Object.values(state.merchantCompanies ?? {})
const byStatus = {}
for (const c of companies) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
const active = companies.filter((c) => c.status === 'active')
console.log('=== Merchant Companies ===')
console.log('total:', companies.length, 'byStatus:', JSON.stringify(byStatus))
console.log(
  'active treasury:',
  active
    .map((c) => Math.round(c.treasury))
    .sort((a, b) => a - b)
    .join(', '),
)
console.log(
  'active smoothedProfit:',
  active
    .map((c) => +c.smoothedProfit.toFixed(2))
    .sort((a, b) => a - b)
    .join(', '),
)

// --- Routes ---
const routes = Object.values(state.tradeRoutes ?? {})
const rByStatus = {}
for (const r of routes) rByStatus[r.status] = (rByStatus[r.status] ?? 0) + 1
const ar = routes.filter((r) => r.status === 'active')
const carrying = ar.filter((r) => r.plannedQuantity > 0)
const profitable = ar.filter((r) => r.smoothedProfit > 0)
console.log('\n=== Trade Routes ===')
console.log('total:', routes.length, 'byStatus:', JSON.stringify(rByStatus))
console.log(
  'active:',
  ar.length,
  '| carrying (planned>0):',
  carrying.length,
  '| profitable (smProfit>0):',
  profitable.length,
)

if (ar.length) {
  const pq = ar.map((r) => r.plannedQuantity)
  const thr = ar.map((r) => {
    const t = cfg.tradeRouteThroughputByLevel[r.level] ?? 1
    return r.plannedQuantity / t
  })
  console.log(
    `plannedQuantity: p50=${fmt(pct(pq, 0.5))} p90=${fmt(pct(pq, 0.9))} max=${fmt(Math.max(...pq))}`,
  )
  console.log(
    `utilization (planned/throughput): p50=${fmt(pct(thr, 0.5))} p90=${fmt(pct(thr, 0.9))} max=${fmt(Math.max(...thr))}`,
  )

  // binding term
  let bind = { throughput: 0, source: 0, other: 0 }
  for (const r of ar) {
    if (r.plannedQuantity <= 0) {
      bind.other++
      continue
    }
    const t = cfg.tradeRouteThroughputByLevel[r.level] ?? 1
    const mrp = state.marketResourcePrices ?? {}
    const mk = `${r.sourceStateId}:${r.resource}`
    const ps = mrp[mk]
    const last = ps?.history?.[ps.history.length - 1]
    const srcExp = last ? Math.max(0, last.sellOrders - last.buyOrders) : 0
    if (
      Math.abs(r.plannedQuantity - t * (r.plannedQuantity / Math.min(t, srcExp || Infinity))) <
        0.01 &&
      srcExp < t
    )
      bind.source++
    else if (r.plannedQuantity >= t * 0.99) bind.throughput++
    else bind.other++
  }
  console.log('binding term:', JSON.stringify(bind))

  const sp = ar.map((r) => r.smoothedProfit)
  const lp = ar.map((r) => r.lastProfit)
  console.log(
    `smoothedProfit: p50=${fmt(pct(sp, 0.5))} p90=${fmt(pct(sp, 0.9))} max=${fmt(Math.max(...sp))}`,
  )
  console.log(
    `lastProfit: p50=${fmt(pct(lp, 0.5))} p90=${fmt(pct(lp, 0.9))} max=${fmt(Math.max(...lp))}`,
  )

  // level distribution
  const lvl = {}
  for (const r of ar) lvl[r.level] = (lvl[r.level] ?? 0) + 1
  console.log(
    'level distribution:',
    JSON.stringify(lvl),
    '| level>1:',
    ar.filter((r) => r.level > 1).length,
  )

  // resource distribution
  const resDist = {}
  for (const r of ar) resDist[r.resource] = (resDist[r.resource] ?? 0) + 1
  const profRes = {}
  for (const r of profitable) profRes[r.resource] = (profRes[r.resource] ?? 0) + 1
  console.log('resource (active):', JSON.stringify(resDist))
  console.log('resource (profitable):', JSON.stringify(profRes))
}

// sample routes
console.log('\n=== Sample routes (top 5 by smoothedProfit) ===')
for (const r of ar.sort((a, b) => b.smoothedProfit - a.smoothedProfit).slice(0, 5)) {
  const thr = cfg.tradeRouteThroughputByLevel[r.level] ?? 1
  console.log(
    `${r.id} ${r.resource} L${r.level} ${r.sourceStateId}->${r.targetStateId} planned=${fmt(r.plannedQuantity)} util=${fmt(r.plannedQuantity / thr)} planBuy=${fmt(r.plannedBuyPrice)} planSell=${fmt(r.plannedSellPrice)} unitMargin=${fmt(r.plannedExpectedUnitMargin)} lastProfit=${fmt(r.lastProfit)} smProfit=${fmt(r.smoothedProfit)}`,
  )
}

// --- Money supply (論点E) ---
let totalPopMoney = 0,
  totalHouseWealth = 0,
  totalTreasury = 0
for (const p of Object.values(state.popGroups ?? {})) if (p) totalPopMoney += p.money
for (const h of Object.values(state.houses ?? {})) if (h) totalHouseWealth += h.wealth
for (const c of active) totalTreasury += c.treasury
// price index: average smoothedPrice across all markets
const mrp = state.marketResourcePrices ?? {}
const prices = Object.values(mrp)
  .map((ps) => ps.smoothedPrice)
  .filter((p) => p > 0)
const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
console.log('\n=== Money & Price (論点E) ===')
console.log(
  `totalPopMoney: ${Math.round(totalPopMoney)} | totalHouseWealth: ${Math.round(totalHouseWealth)} | totalMerchantTreasury: ${Math.round(totalTreasury)}`,
)
console.log(
  `total money-like: ${Math.round(totalPopMoney + totalHouseWealth + totalTreasury)} | avg smoothedPrice: ${avgPrice.toFixed(3)}`,
)

// --- Route age & churn (振動検出) ---
const week = state.absoluteWeek
const closedR = routes.filter((r) => r.status === 'closed')
const ages = ar.map((r) => week - r.createdWeek)
const closedAges = closedR.map((r) => (r.closedWeek ?? week) - r.createdWeek)
console.log('\n=== Route churn ===')
console.log(
  `active route ages: p50=${fmt(pct(ages, 0.5))} min=${fmt(Math.min(...ages))} max=${fmt(Math.max(...ages))}`,
)
if (closedR.length) {
  console.log(
    `closed routes: ${closedR.length} | lifespan p50=${fmt(pct(closedAges, 0.5))} min=${fmt(Math.min(...closedAges))} max=${fmt(Math.max(...closedAges))}`,
  )
} else {
  console.log('closed routes: 0')
}

// --- Old targetImportDemand comparison (方針7) ---
console.log('\n=== Old targetImportDemand comparison ===')
let wouldBeZero = 0
for (const r of ar) {
  const mk = `${r.targetStateId}:${r.resource}`
  const ps = mrp[mk]
  const last = ps?.history?.[ps.history.length - 1]
  const tid = last ? Math.max(0, last.buyOrders - last.sellOrders) : 0
  if (tid <= 0) wouldBeZero++
}
console.log(
  `of ${ar.length} active routes, ${wouldBeZero} would have targetImportDemand=0 under old formula`,
)
