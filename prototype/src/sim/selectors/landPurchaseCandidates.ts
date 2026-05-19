import type { WorldState } from '../types/world'
import type { PolityId, ProvinceId } from '../types/ids'
import { defaultLandContractConfig } from '../config/landContractConfig'
import {
  getPolityTerminalProvinceIds,
  getProvinceTerminalPolityId,
  getProvinceTerminalContract,
  getLandContractGrantor,
} from './landContractSelectors'

// v0.18 Stage C §11.1 / §15
// 旧 landContractPurchaseSystem の候補生成ロジックを純粋関数として抽出した。
// 各 active Polity (buyer) について、treasury 不足の隣接 Polity (seller) を探す。
//
// 判定条件 (旧実装通り):
//   - buyer / seller どちらも active かつ commonwealth ではない (ownerHouseId !== undefined)
//   - 同 rank
//   - 隣接 Province を持つ (buyer terminal Province の neighbor が seller terminal Province)
//   - 同じ直接 grantor (parent contract の grantee polity が同じ)
//   - seller.treasury < purchaseSellerTreasuryThreshold
//   - buyer.treasury >= 提示価格 (= max(base, base + development × factor))
//
// 注: 旧実装は buyer 主導 (treasury 余裕のある polity が買おうとする) だったが、
// Stage C では sell_land Intent を seller actor で生成するため、視点を反転させて
// seller を主役にする。ただし候補ペアの判定条件は同じ。

export type LandPurchaseCandidate = {
  sellerPolityId: PolityId
  buyerPolityId: PolityId
  provinceId: ProvinceId
  price: number
}

export function findLandPurchaseIntentCandidates(state: WorldState): LandPurchaseCandidate[] {
  const config = defaultLandContractConfig
  const results: LandPurchaseCandidate[] = []

  const polityIds = Object.keys(state.polities).sort() as PolityId[]

  for (const sellerPolityId of polityIds) {
    const seller = state.polities[sellerPolityId]
    if (!seller || !seller.active) continue
    if (seller.ownerHouseId === undefined) continue // commonwealth 除外
    if (seller.treasury >= config.purchaseSellerTreasuryThreshold) continue

    // seller の terminal Province を列挙し、各 Province について隣接 buyer 候補を探す
    const sellerTerminalProvinces = getPolityTerminalProvinceIds(state, sellerPolityId)

    for (const sellerProvinceId of sellerTerminalProvinces) {
      const sellerProvince = state.provinces[sellerProvinceId]
      if (!sellerProvince) continue

      // この Province の terminal contract の grantor を取得 (= 同じ grantor 制約用)
      const sellerContract = getProvinceTerminalContract(state, sellerProvinceId)
      if (!sellerContract) continue
      const sellerGrantor = getLandContractGrantor(state, sellerContract.id)
      if (!sellerGrantor) continue
      const sellerGrantorKey = `${sellerGrantor.kind}:${sellerGrantor.id}`

      // 隣接 Province を見て、別の active Polity が terminal を持つかチェック
      for (const neighborId of sellerProvince.neighbors) {
        const buyerPolityId = getProvinceTerminalPolityId(state, neighborId)
        if (!buyerPolityId || buyerPolityId === sellerPolityId) continue
        const buyer = state.polities[buyerPolityId]
        if (!buyer || !buyer.active) continue
        if (buyer.ownerHouseId === undefined) continue // commonwealth 除外
        if (buyer.rank !== seller.rank) continue // 同 rank 制約
        if (buyer.treasury < config.purchaseBuyerTreasuryThreshold) continue

        // 同じ直接 grantor 制約: neighbor Province の terminal contract の grantor が
        // seller Province と同じ grantor を持つこと
        const neighborContract = getProvinceTerminalContract(state, neighborId)
        if (!neighborContract) continue
        const neighborGrantor = getLandContractGrantor(state, neighborContract.id)
        if (!neighborGrantor) continue
        if (`${neighborGrantor.kind}:${neighborGrantor.id}` !== sellerGrantorKey) continue

        // price = max(base, base + development × factor)
        const price = Math.max(
          config.purchasePriceBase,
          config.purchasePriceBase +
            sellerProvince.development * config.purchasePriceDevelopmentFactor,
        )
        if (buyer.treasury < price) continue

        results.push({
          sellerPolityId,
          buyerPolityId,
          provinceId: sellerProvinceId,
          price,
        })
      }
    }
  }

  return results
}
