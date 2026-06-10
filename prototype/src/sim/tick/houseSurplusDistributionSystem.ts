import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { HouseId } from '../types/ids'
import { getHouseShares } from '../selectors/shareSelectors'

// v0.17 §10: HouseSurplusDistributionSystem (毎月)
// House の余剰 wealth (= wealth - reserveTarget) の monthlyRate を、
// 当該 House の Person holder Share 比で normal Person に配当する。
// PolitySurplusDistributionSystem の直後に走る。
//
// perf (v0.47): mutable-draft パターン (taskSystem v0.23.1 と同型)。
//   かつては per-share の addPersonWealth / addHouseWealth が呼び出しごとに persons / houses
//   マップ全体 (年100で 1,215 keys、死者含む) を spread しており (~487 回/run)、全体の ~10% を
//   占めていた。draft は最初の配当発生時に各マップを 1 回だけ浅コピーし、以降は既存キーの
//   オブジェクト置換 (挿入順不変・クランプ位置同一) で per-call 版と bit-identical を保つ。
export function runHouseSurplusDistributionSystem(ctx: TickContext): TickContext {
  const state = ctx.state
  const config = ctx.config

  // lazy draft: 配当が 1 件も発生しない run では state を一切コピーしない。
  let draft: WorldState | undefined
  const ensureDraft = (): WorldState => {
    if (!draft) {
      draft = {
        ...state,
        persons: { ...state.persons },
        houses: { ...state.houses },
      }
    }
    return draft
  }

  for (const houseId of (Object.keys(state.houses) as HouseId[]).sort()) {
    const cur = draft ?? state
    const house = cur.houses[houseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue

    const surplus = Math.max(0, house.wealth - config.houseWealthReserveTarget)
    const distributable = Math.floor(surplus * config.houseSurplusDistributionMonthlyRate)
    if (distributable <= 0) continue

    // House の Person holder Share (alive + normal のみ)
    const shares = getHouseShares(cur, houseId).filter((s) => {
      const p = cur.persons[s.holderPersonId]
      if (!p || !p.alive) return false
      if (p.kind === 'placeholder') return false
      return true
    })
    if (shares.length === 0) continue

    const totalRawPower = shares.reduce((sum, s) => sum + s.rawPower, 0)
    if (totalRawPower <= 0) continue

    let distributed = 0
    let maxShare = shares[0]
    for (const s of shares) {
      if (s.rawPower > (maxShare?.rawPower ?? -Infinity)) maxShare = s
    }
    for (const share of shares) {
      if (share === maxShare) continue
      const portion = Math.floor((share.rawPower / totalRawPower) * distributable)
      if (portion <= 0) continue
      const d = ensureDraft()
      const p = d.persons[share.holderPersonId]
      // 旧 addPersonWealth と同一: person 不在時は state 変更なし、distributed 加算はされる
      if (p) d.persons[share.holderPersonId] = { ...p, wealth: Math.max(0, p.wealth + portion) }
      distributed += portion
    }
    // 端数を最大 holder に集約
    const remainder = distributable - distributed
    if (maxShare && remainder > 0) {
      const d = ensureDraft()
      const p = d.persons[maxShare.holderPersonId]
      if (p)
        d.persons[maxShare.holderPersonId] = { ...p, wealth: Math.max(0, p.wealth + remainder) }
      distributed += remainder
    }

    if (distributed > 0) {
      const d = ensureDraft()
      const h = d.houses[houseId]
      if (h) d.houses[houseId] = { ...h, wealth: Math.max(0, h.wealth - distributed) }
    }
  }

  return draft ? { ...ctx, state: draft } : ctx
}
