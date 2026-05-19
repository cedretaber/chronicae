import { describe, it, expect } from 'vitest'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import type { HouseId, PolityId, ProvinceId } from '../types/ids'
import { findLandPurchaseIntentCandidates } from './landPurchaseCandidates'
import { defaultLandContractConfig } from '../config/landContractConfig'

function buildWorld(opts: {
  buyerTreasury: number
  sellerTreasury: number
  sameRank?: boolean
  buyerCommonwealth?: boolean
  sellerCommonwealth?: boolean
}) {
  let s = makeEmptyV016State()
  const provinceBuyerId = 'pr-buyer' as ProvinceId
  const provinceSellerId = 'pr-seller' as ProvinceId
  const buyerPolityId = 'c-buyer' as PolityId
  const sellerPolityId = 'c-seller' as PolityId
  const buyerHouseId = 'h-buyer' as HouseId
  const sellerHouseId = 'h-seller' as HouseId

  s = withProvince(s, provinceBuyerId, { neighbors: [provinceSellerId], popGroupIds: [] })
  s = withProvince(s, provinceSellerId, {
    neighbors: [provinceBuyerId],
    popGroupIds: [],
    development: 0,
  })
  s = withHouse(s, buyerHouseId, { seatProvinceId: provinceBuyerId })
  s = withHouse(s, sellerHouseId, { seatProvinceId: provinceSellerId })
  s = withPolity(s, buyerPolityId, {
    rank: 2,
    treasury: opts.buyerTreasury,
    capitalProvinceId: provinceBuyerId,
  })
  s = withPolity(s, sellerPolityId, {
    rank: opts.sameRank === false ? 3 : 2,
    treasury: opts.sellerTreasury,
    capitalProvinceId: provinceSellerId,
  })
  if (!opts.buyerCommonwealth) {
    s = bindProvinceToHouseViaPolity(s, provinceBuyerId, buyerPolityId, buyerHouseId)
  }
  if (!opts.sellerCommonwealth) {
    s = bindProvinceToHouseViaPolity(s, provinceSellerId, sellerPolityId, sellerHouseId)
  }
  // commonwealth フラグ
  if (opts.buyerCommonwealth) {
    s = {
      ...s,
      polities: {
        ...s.polities,
        [buyerPolityId]: {
          ...s.polities[buyerPolityId]!,
          ownerHouseId: undefined,
          kind: 'commonwealth',
        },
      },
    }
  }
  if (opts.sellerCommonwealth) {
    s = {
      ...s,
      polities: {
        ...s.polities,
        [sellerPolityId]: {
          ...s.polities[sellerPolityId]!,
          ownerHouseId: undefined,
          kind: 'commonwealth',
        },
      },
    }
  }

  return { state: s, buyerPolityId, sellerPolityId, provinceBuyerId, provinceSellerId }
}

describe('findLandPurchaseIntentCandidates', () => {
  it('returns candidate when conditions are met (seller poor + buyer rich + same rank + adjacent + same grantor)', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld({
      buyerTreasury: defaultLandContractConfig.purchaseBuyerTreasuryThreshold + 1000,
      sellerTreasury: defaultLandContractConfig.purchaseSellerTreasuryThreshold - 100,
    })
    const candidates = findLandPurchaseIntentCandidates(state)
    expect(candidates.length).toBe(1)
    expect(candidates[0]?.sellerPolityId).toBe(sellerPolityId)
    expect(candidates[0]?.buyerPolityId).toBe(buyerPolityId)
    expect(candidates[0]?.provinceId).toBe(provinceSellerId)
    expect(candidates[0]?.price).toBeGreaterThanOrEqual(defaultLandContractConfig.purchasePriceBase)
  })

  it('returns empty when seller treasury is high enough (no need to sell)', () => {
    const { state } = buildWorld({
      buyerTreasury: defaultLandContractConfig.purchaseBuyerTreasuryThreshold + 1000,
      sellerTreasury: defaultLandContractConfig.purchaseSellerTreasuryThreshold + 100,
    })
    expect(findLandPurchaseIntentCandidates(state)).toEqual([])
  })

  it('returns empty when buyer is commonwealth', () => {
    const { state } = buildWorld({
      buyerTreasury: defaultLandContractConfig.purchaseBuyerTreasuryThreshold + 1000,
      sellerTreasury: defaultLandContractConfig.purchaseSellerTreasuryThreshold - 100,
      buyerCommonwealth: true,
    })
    expect(findLandPurchaseIntentCandidates(state)).toEqual([])
  })

  it('returns empty when seller is commonwealth', () => {
    const { state } = buildWorld({
      buyerTreasury: defaultLandContractConfig.purchaseBuyerTreasuryThreshold + 1000,
      sellerTreasury: defaultLandContractConfig.purchaseSellerTreasuryThreshold - 100,
      sellerCommonwealth: true,
    })
    expect(findLandPurchaseIntentCandidates(state)).toEqual([])
  })

  it('returns empty when ranks differ', () => {
    const { state } = buildWorld({
      buyerTreasury: defaultLandContractConfig.purchaseBuyerTreasuryThreshold + 1000,
      sellerTreasury: defaultLandContractConfig.purchaseSellerTreasuryThreshold - 100,
      sameRank: false,
    })
    expect(findLandPurchaseIntentCandidates(state)).toEqual([])
  })
})
