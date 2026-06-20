import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import { estimateWeeklyOwnerIncome } from '../selectors/realEstateSelectors'
import { setRealEstateSeizureAccrualMut } from '../mutations/realEstateSeizureMutations'

// v0.53 §12: active 義務 entity の accumulatedUnpaidAmount を概算加算する (係争規模指標, UI 用)。
//   厳密会計値ではなく、LandRevenue が実際に逸らした額との一致は要求しない (§12.1)。
//   interval 4 で走るため weekly owner income × 4 を加算する。
const ACCRUAL_INTERVAL_WEEKS = 4

export function runObligationAccrualSystem(ctx: TickContext): TickContext {
  const hasActiveSeizure = Object.keys(ctx.state.realEstateSeizureIndex.byAsset).length > 0
  if (!hasActiveSeizure) return ctx

  const ws: WorldState = {
    ...ctx.state,
    realEstateSeizures: { ...ctx.state.realEstateSeizures },
  }

  for (const [, seizure] of Object.entries(ws.realEstateSeizures)) {
    if (!seizure || seizure.status !== 'active') continue
    const asset = ws.realEstateAssets[seizure.assetId]
    if (!asset) continue
    const weeklyIncome = estimateWeeklyOwnerIncome(ws, ctx.config, asset)
    if (weeklyIncome <= 0) continue
    setRealEstateSeizureAccrualMut(
      ws,
      seizure.id,
      seizure.accumulatedUnpaidAmount + weeklyIncome * ACCRUAL_INTERVAL_WEEKS,
    )
  }

  return { ...ctx, state: ws }
}
