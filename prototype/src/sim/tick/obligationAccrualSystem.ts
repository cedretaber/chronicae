import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import {
  estimateMonthlyOwnerIncome,
  getHoldingMonthlyResourceRevenue,
} from '../selectors/resourceRevenueSelectors'
import { setRealEstateSeizureAccrualMut } from '../mutations/realEstateSeizureMutations'
import { setLandContractDefaultAccrualMut } from '../mutations/landContractDefaultMutations'

// v0.53 §12: active 義務 entity の accumulatedUnpaidAmount を概算加算する (係争規模指標, UI 用)。
//   厳密会計値ではなく、LandRevenue が実際に逸らした額との一致は要求しない (§12.1)。
//   v0.54 §18: resource snapshot は月額なので月次 system では × 1 で加算する (旧 weekly × 4 を撤廃)。

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
    const monthlyIncome = estimateMonthlyOwnerIncome(ws, ctx.config, asset)
    if (monthlyIncome <= 0) continue
    setRealEstateSeizureAccrualMut(ws, seizure.id, seizure.accumulatedUnpaidAmount + monthlyIncome)
  }

  for (const [, d] of Object.entries(ws.landContractDefaults)) {
    if (!d || d.status !== 'active') continue
    // §12.3: 本来 claimant が受け取るはずだった上納額を概算 (holding 月次 revenue × 旧税率)。
    const production = getHoldingMonthlyResourceRevenue(ws, ctx.config, d.holdingId)
    const estimatedContractTax = production * d.originalTaxRateToGrantor
    if (estimatedContractTax <= 0) continue
    setLandContractDefaultAccrualMut(ws, d.id, d.accumulatedUnpaidAmount + estimatedContractTax)
  }

  return { ...ctx, state: ws }
}
