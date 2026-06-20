import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import { estimateWeeklyOwnerIncome } from '../selectors/realEstateSelectors'
import { getHoldingProduction } from '../selectors/popEconomySelectors'
import { setRealEstateSeizureAccrualMut } from '../mutations/realEstateSeizureMutations'
import { setLandContractDefaultAccrualMut } from '../mutations/landContractDefaultMutations'

// v0.53 §12: active 義務 entity の accumulatedUnpaidAmount を概算加算する (係争規模指標, UI 用)。
//   厳密会計値ではなく、LandRevenue が実際に逸らした額との一致は要求しない (§12.1)。
//   interval 4 で走るため weekly 概算 × 4 を加算する。
const ACCRUAL_INTERVAL_WEEKS = 4

export function runObligationAccrualSystem(ctx: TickContext): TickContext {
  const hasActiveSeizure = Object.keys(ctx.state.realEstateSeizureIndex.byAsset).length > 0
  const hasActiveDefault = Object.keys(ctx.state.landContractDefaultIndex.byContract).length > 0
  if (!hasActiveSeizure && !hasActiveDefault) return ctx

  const ws: WorldState = {
    ...ctx.state,
    realEstateSeizures: { ...ctx.state.realEstateSeizures },
    landContractDefaults: { ...ctx.state.landContractDefaults },
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

  for (const [, d] of Object.entries(ws.landContractDefaults)) {
    if (!d || d.status !== 'active') continue
    // §12.3: 本来 claimant が受け取るはずだった上納額を概算 (holding 生産 × 旧税率)。
    const production = getHoldingProduction(ws, ctx.config, d.holdingId)
    const estimatedContractTax = production * d.originalTaxRateToGrantor
    if (estimatedContractTax <= 0) continue
    setLandContractDefaultAccrualMut(
      ws,
      d.id,
      d.accumulatedUnpaidAmount + estimatedContractTax * ACCRUAL_INTERVAL_WEEKS,
    )
  }

  return { ...ctx, state: ws }
}
