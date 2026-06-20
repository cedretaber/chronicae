import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { RealEstateAsset } from '../types/realEstateAsset'
import { estimateMonthlyOwnerIncome } from './resourceRevenueSelectors'
import { MONTHS_PER_YEAR } from '../utils/timeUtils'

// v0.54: 売却価格 = 月次 owner income × 12ヶ月 × salePriceYears (年額 owner income の salePriceYears 倍)。
//   旧 weekly owner income × WEEKS_PER_YEAR から月額ベースへ移行 (§18 単位統一)。
export function estimateRealEstateSalePrice(
  state: WorldState,
  config: SimulationConfig,
  asset: RealEstateAsset,
): number {
  return (
    estimateMonthlyOwnerIncome(state, config, asset) *
    MONTHS_PER_YEAR *
    config.realEstateSalePriceYears
  )
}
