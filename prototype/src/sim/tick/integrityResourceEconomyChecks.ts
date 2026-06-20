import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { marketResourcePriceKey } from '../types/resourceEconomy'

// v0.54 §21.2 / §21.3: 資源経済 read-model (marketResourcePrices / monthlyHoldingResourceRevenue) の整合性検査。
//   slice が空 (ResourceEconomySystem 実行前) でも violation にしない (§21.3)。
export function checkResourceEconomy(
  state: WorldState,
  errors: SimError[],
  config: SimulationConfig | undefined,
): void {
  // §21.2 marketResourcePrices
  for (const [key, record] of Object.entries(state.marketResourcePrices)) {
    if (!record) continue
    const expectedKey = marketResourcePriceKey(record.marketKey, record.resource)
    if (key !== expectedKey) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `marketResourcePrices key=${key} does not match marketKey:resource=${expectedKey}`,
      })
    }
    if (!(record.lastPrice >= 0)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `marketResourcePrices ${key}: lastPrice=${record.lastPrice} must be >= 0`,
      })
    }
    if (!(record.smoothedPrice >= 0)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `marketResourcePrices ${key}: smoothedPrice=${record.smoothedPrice} must be >= 0`,
      })
    }
    if (config && record.history.length > config.marketResourcePriceHistoryLimit) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `marketResourcePrices ${key}: history length=${record.history.length} exceeds limit=${config.marketResourcePriceHistoryLimit}`,
      })
    }
    for (const point of record.history) {
      const vals: [string, number][] = [
        ['price', point.price],
        ['supply', point.supply],
        ['effectiveDemand', point.effectiveDemand],
        ['sold', point.sold],
        ['unmetDemand', point.unmetDemand],
      ]
      for (const [name, v] of vals) {
        if (!(v >= 0)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `marketResourcePrices ${key}: history ${name}=${v} must be >= 0`,
          })
        }
      }
    }
  }

  // §21.3 monthlyHoldingResourceRevenue
  for (const [holdingKey, snapshot] of Object.entries(state.monthlyHoldingResourceRevenue)) {
    if (!snapshot) continue
    if (!state.holdings[snapshot.holdingId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `monthlyHoldingResourceRevenue ${holdingKey}: holdingId=${snapshot.holdingId as string} does not exist`,
      })
    }
    if (!(snapshot.totalNetRevenue >= 0)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `monthlyHoldingResourceRevenue ${holdingKey}: totalNetRevenue=${snapshot.totalNetRevenue} must be >= 0`,
      })
    }
    for (const assetResult of snapshot.assetResults) {
      if (!state.realEstateAssets[assetResult.assetId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `monthlyHoldingResourceRevenue ${holdingKey}: assetResult assetId=${assetResult.assetId as string} does not exist`,
        })
      }
      if ((assetResult.holdingId as string) !== (snapshot.holdingId as string)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `monthlyHoldingResourceRevenue ${holdingKey}: assetResult holdingId=${assetResult.holdingId as string} does not match snapshot holdingId=${snapshot.holdingId as string}`,
        })
      }
      for (const v of [assetResult.grossRevenue, assetResult.inputCost, assetResult.netRevenue]) {
        if (!Number.isFinite(v)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `monthlyHoldingResourceRevenue ${holdingKey}: assetResult ${assetResult.assetId as string} has non-finite revenue value=${v}`,
          })
        }
      }
    }
  }
}
