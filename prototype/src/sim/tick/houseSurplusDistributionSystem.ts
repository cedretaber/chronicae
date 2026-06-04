import type { TickContext } from './context'
import type { HouseId } from '../types/ids'
import { getHouseShares } from '../selectors/shareSelectors'
import { addHouseWealth } from '../mutations/houseMutations'
import { addPersonWealth } from '../mutations/personMutations'

// v0.17 §10: HouseSurplusDistributionSystem (毎月)
// House の余剰 wealth (= wealth - reserveTarget) の monthlyRate を、
// 当該 House の Person holder Share 比で normal Person に配当する。
// PolitySurplusDistributionSystem の直後に走る。
export function runHouseSurplusDistributionSystem(ctx: TickContext): TickContext {
  let state = ctx.state
  const config = ctx.config

  for (const houseId of (Object.keys(state.houses) as HouseId[]).sort()) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue

    const surplus = Math.max(0, house.wealth - config.houseWealthReserveTarget)
    const distributable = Math.floor(surplus * config.houseSurplusDistributionMonthlyRate)
    if (distributable <= 0) continue

    // House の Person holder Share (alive + normal のみ)
    const shares = getHouseShares(state, houseId).filter((s) => {
      const p = state.persons[s.holderPersonId]
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
      const result = addPersonWealth(state, share.holderPersonId, portion)
      if (result.ok) state = result.value
      distributed += portion
    }
    // 端数を最大 holder に集約
    const remainder = distributable - distributed
    if (maxShare && remainder > 0) {
      const result = addPersonWealth(state, maxShare.holderPersonId, remainder)
      if (result.ok) state = result.value
      distributed += remainder
    }

    if (distributed > 0) {
      const result = addHouseWealth(state, houseId, -distributed)
      if (result.ok) state = result.value
    }
  }

  return { ...ctx, state }
}
