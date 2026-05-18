import type { TickContext } from './context'
import { makeEventId } from './context'
import type { PolityId, ProvinceId, HouseId } from '../types/ids'
import type { SimEvent } from '../types/event'
import { randomFloat, randomInt } from '../rng/rng'
import { defaultLandContractConfig } from '../config/landContractConfig'
import {
  getPolityTerminalProvinceIds,
  getProvinceTerminalPolityId,
  getProvinceTerminalContract,
  getLandContractGrantor,
} from '../selectors/landContractSelectors'
import { purchaseLandContract } from '../mutations/landContractMutations'

// v0.16 §18: 隣接 Polity 間で金銭による LandContract 譲渡。
//
// 動作 (年次、1 月のみ):
//   1. 各 active Polity を「買い手候補」として走査
//   2. treasury > buyerThreshold なら購入提案を試行 (確率 purchaseAttemptChance)
//   3. 隣接する Province を持つ同 rank の Polity を「売り手候補」とする
//   4. 売り手の treasury < sellerThreshold なら成立
//   5. 売り手から terminal Province を 1 つ譲渡、treasury を移動、event 発火
//
// 同 rank 制約は §16.1 case A と同じ理由 (rank 不変条件 §7 #8 を保つ)。
// 隣接判定は Province の neighbors を見る。
export function runLandContractPurchaseSystem(ctx: TickContext): TickContext {
  // 年次 (1 月のみ実行)
  if (ctx.state.currentMonth !== 1) return ctx

  const config = defaultLandContractConfig
  let currentCtx = ctx

  const polityIds = Object.keys(currentCtx.state.polities).sort() as PolityId[]

  for (const buyerPolityId of polityIds) {
    const buyer = currentCtx.state.polities[buyerPolityId]
    if (!buyer || !buyer.active) continue
    // §18 commonwealth Polity は v0.16 では購入主体にしない
    if (buyer.ownerHouseId === undefined) continue
    if (buyer.treasury < config.purchaseBuyerTreasuryThreshold) continue

    // 確率試行
    const { value: roll, rng: nextRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: nextRng }
    if (roll >= config.purchaseAttemptChance) continue

    // 買い手 Polity が terminal な Province の隣接 Province を集める
    const buyerTerminalProvinces = getPolityTerminalProvinceIds(currentCtx.state, buyerPolityId)
    if (buyerTerminalProvinces.length === 0) continue

    // §18「同じ直接 grantor の下にいる」制約のため、buyer 側の grantor 集合を構築
    const buyerGrantorKeys = new Set<string>()
    for (const pid of buyerTerminalProvinces) {
      const c = getProvinceTerminalContract(currentCtx.state, pid)
      if (!c) continue
      const g = getLandContractGrantor(currentCtx.state, c.id)
      if (g) buyerGrantorKeys.add(`${g.kind}:${g.id}`)
    }
    if (buyerGrantorKeys.size === 0) continue

    const adjacentProvinces = new Set<ProvinceId>()
    for (const pid of buyerTerminalProvinces) {
      const province = currentCtx.state.provinces[pid]
      if (!province) continue
      for (const neighborId of province.neighbors) {
        if (!buyerTerminalProvinces.includes(neighborId)) {
          adjacentProvinces.add(neighborId)
        }
      }
    }
    if (adjacentProvinces.size === 0) continue

    // 隣接 Province の中で「同 rank かつ同じ直接 grantor 下の売り手 Polity が treasury 不足」を探す
    const candidates: { provinceId: ProvinceId; sellerId: PolityId; price: number }[] = []
    for (const provinceId of adjacentProvinces) {
      const province = currentCtx.state.provinces[provinceId]
      if (!province) continue

      const sellerPolityId = getProvinceTerminalPolityId(currentCtx.state, provinceId)
      if (!sellerPolityId || sellerPolityId === buyerPolityId) continue

      const seller = currentCtx.state.polities[sellerPolityId]
      if (!seller || !seller.active) continue
      // §18 commonwealth Polity は売却主体にもしない
      if (seller.ownerHouseId === undefined) continue
      if (seller.rank !== buyer.rank) continue // 同 rank 制約
      if (seller.treasury >= config.purchaseSellerTreasuryThreshold) continue

      // §18「同じ直接 grantor」制約: 売り手 Province の grantor が買い手の grantor 集合に含まれること
      const sellerContract = getProvinceTerminalContract(currentCtx.state, provinceId)
      if (!sellerContract) continue
      const sellerGrantor = getLandContractGrantor(currentCtx.state, sellerContract.id)
      if (!sellerGrantor) continue
      if (!buyerGrantorKeys.has(`${sellerGrantor.kind}:${sellerGrantor.id}`)) continue

      // development は -100..100 の範囲なので price が負になり得る。base 価格を下回らないようガード。
      const price = Math.max(
        config.purchasePriceBase,
        config.purchasePriceBase + province.development * config.purchasePriceDevelopmentFactor,
      )
      if (buyer.treasury < price) continue

      candidates.push({ provinceId, sellerId: sellerPolityId, price })
    }
    if (candidates.length === 0) continue

    // 候補から 1 つランダムに選ぶ
    const { value: idx, rng: pickRng } = randomInt(currentCtx.rng, 0, candidates.length - 1)
    currentCtx = { ...currentCtx, rng: pickRng }
    const choice = candidates[idx]!

    const sellerPolity = currentCtx.state.polities[choice.sellerId]
    const buyerName = buyer.name
    const sellerName = sellerPolity?.name ?? choice.sellerId
    const provinceName = currentCtx.state.provinces[choice.provinceId]?.name ?? choice.provinceId

    const newState = purchaseLandContract(currentCtx.state, {
      provinceId: choice.provinceId,
      buyerPolityId,
      sellerPolityId: choice.sellerId,
      price: choice.price,
    })
    if (newState === currentCtx.state) continue
    currentCtx = { ...currentCtx, state: newState }

    // Event 発火
    const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
    const ownerHouseIds: HouseId[] = []
    if (buyer.ownerHouseId !== undefined) ownerHouseIds.push(buyer.ownerHouseId)
    if (sellerPolity?.ownerHouseId !== undefined) ownerHouseIds.push(sellerPolity.ownerHouseId)
    const event: SimEvent = {
      id: eventId,
      year: currentCtx.state.currentYear,
      month: currentCtx.state.currentMonth,
      type: 'LAND_CONTRACT_PURCHASED',
      importance: 'major',
      actorIds: [],
      houseIds: ownerHouseIds,
      polityIds: [buyerPolityId, choice.sellerId],
      provinceIds: [choice.provinceId],
      summary: `${buyerName} purchased ${provinceName} from ${sellerName} for ${Math.round(choice.price)} gold.`,
      reasons: [],
      effects: [],
    }
    currentCtx = { ...eventCtx, events: [...eventCtx.events, event] }
  }

  return currentCtx
}
