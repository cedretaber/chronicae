import type { WorldState } from '../types/world'
import type {
  MerchantCompanyId,
  HouseId,
  PersonId,
  StateRegionId,
  HoldingId,
  ProductionRecipeId,
} from '../types/ids'
import type { MerchantCompany, TradeRoute, MerchantCompanyEstablishment } from '../types/merchant'
import type { ResourceKind } from '../types/resource'
import { isLivingPerson } from '../types/person'
import { getHouseDecisionMaker, getActiveOfficeHolders } from './officeSelectors'
import { PRODUCTION_RECIPE_DEFINITIONS } from '../config/productionRecipeDefinitions'

// v0.61 商会 query selector。隣接 StateRegion 導出・会長選出・排他 guard を集約する。

export function getMerchantCompany(
  state: WorldState,
  companyId: MerchantCompanyId,
): MerchantCompany | undefined {
  return state.merchantCompanies[companyId]
}

export function isMerchantCompanyActive(state: WorldState, companyId: MerchantCompanyId): boolean {
  return state.merchantCompanies[companyId]?.status === 'active'
}

// 商会の share holder のうち rawPower 最大の alive normal Person。
//   tie-break は holderPersonId 昇順。share holder 不在なら ownerHouse の decision maker。
export function getMerchantCompanyDecisionMaker(
  state: WorldState,
  companyId: MerchantCompanyId,
): PersonId | undefined {
  const company = state.merchantCompanies[companyId]
  if (!company) return undefined

  const shareIds = state.merchantCompanyShareIndex.byCompany[companyId as string] ?? []
  const shares = shareIds
    .flatMap((id) => {
      const s = state.merchantCompanyShares[id]
      return s && isLivingPerson(state.persons[s.holderPersonId]) ? [s] : []
    })
    .sort((a, b) => (a.holderPersonId as string).localeCompare(b.holderPersonId))

  let best: { id: PersonId; power: number } | undefined
  for (const share of shares) {
    if (!best || share.rawPower > best.power) {
      best = { id: share.holderPersonId, power: share.rawPower }
    }
  }
  if (best) return best.id

  return getHouseDecisionMaker(state, company.ownerHouseId)
}

// 商会の establishment / route を引く小 selector。
export function getCompanyEstablishments(
  state: WorldState,
  companyId: MerchantCompanyId,
): MerchantCompanyEstablishment[] {
  const ids = state.merchantCompanyEstablishmentIndex.byCompany[companyId as string] ?? []
  return ids.flatMap((id) => {
    const e = state.merchantCompanyEstablishments[id]
    return e ? [e] : []
  })
}

export function getCompanyHeadquarters(
  state: WorldState,
  companyId: MerchantCompanyId,
): MerchantCompanyEstablishment | undefined {
  const company = state.merchantCompanies[companyId]
  if (!company) return undefined
  return state.merchantCompanyEstablishments[company.headquartersEstablishmentId]
}

export function getCompanyRoutes(state: WorldState, companyId: MerchantCompanyId): TradeRoute[] {
  const ids = state.tradeRouteIndex.byCompany[companyId as string] ?? []
  return ids.flatMap((id) => {
    const r = state.tradeRoutes[id]
    return r ? [r] : []
  })
}

export function getActiveRouteCount(state: WorldState, companyId: MerchantCompanyId): number {
  return getCompanyRoutes(state, companyId).filter((r) => r.status === 'active').length
}

// 商会 Project の候補人物 (§7.3)。会長 → 番頭 → share holder → ownerHouse member の順、
//   いずれも alive normal Person。重複は除き、決定的順序を保つ。
export function getMerchantCompanyCandidatePersonIds(
  state: WorldState,
  companyId: MerchantCompanyId,
): PersonId[] {
  const company = state.merchantCompanies[companyId]
  if (!company) return []
  const seen = new Set<string>()
  const out: PersonId[] = []
  const add = (id: PersonId | undefined): void => {
    if (!id) return
    if (seen.has(id)) return
    if (!isLivingPerson(state.persons[id])) return
    seen.add(id)
    out.push(id)
  }

  add(getMerchantCompanyDecisionMaker(state, companyId))
  for (const holder of getActiveOfficeHolders(
    state,
    { kind: 'merchant_company', id: companyId },
    'administrator',
  )) {
    add(holder)
  }
  const shareIds = [...(state.merchantCompanyShareIndex.byCompany[companyId as string] ?? [])].sort(
    (a, b) => (a as string).localeCompare(b),
  )
  for (const sid of shareIds) {
    const s = state.merchantCompanyShares[sid]
    if (s) add(s.holderPersonId)
  }
  const ownerHouse = state.houses[company.ownerHouseId]
  if (ownerHouse && ownerHouse.active) {
    for (const memberId of [...ownerHouse.memberIds].sort((a, b) =>
      (a as string).localeCompare(b),
    )) {
      add(memberId)
    }
  }
  return out
}

// StateRegion 隣接: state A と B に属する province が越境隣接していれば隣接とみなす (§19.5)。
export function getAdjacentStateRegionIds(
  state: WorldState,
  stateId: StateRegionId,
): StateRegionId[] {
  const region = state.states[stateId]
  if (!region) return []
  const adjacent = new Set<string>()
  for (const provinceId of region.provinceIds) {
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const neighborId of province.neighbors) {
      const neighbor = state.provinces[neighborId]
      if (!neighbor) continue
      const neighborStateId = neighbor.stateId
      if (neighborStateId && (neighborStateId as string) !== (stateId as string)) {
        adjacent.add(neighborStateId)
      }
    }
  }
  return [...adjacent].sort().map((s) => s as StateRegionId)
}

// state 内の代表 city Holding（最小 id）。本店設置先（§19.1）。
export function getStateCityHoldingId(
  state: WorldState,
  stateId: StateRegionId,
): HoldingId | undefined {
  const region = state.states[stateId]
  if (!region) return undefined
  const cityIds: HoldingId[] = []
  for (const provinceId of region.provinceIds) {
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const hid of province.holdingIds) {
      const holding = state.holdings[hid]
      if (holding && holding.kind === 'city') cityIds.push(hid)
    }
  }
  cityIds.sort((a, b) => (a as string).localeCompare(b))
  return cityIds[0]
}

// state の資源生産ポテンシャル推定（§19.4）。確定済み RealEstateAsset の recipe 出力 × level を
//   resource ごとに集計する。worldgen 時点（価格履歴なし）の初期 route heuristic に使う。
export function estimateStateProductionPotential(
  state: WorldState,
  stateId: StateRegionId,
): Partial<Record<ResourceKind, number>> {
  const out: Partial<Record<ResourceKind, number>> = {}
  const region = state.states[stateId]
  if (!region) return out
  for (const provinceId of region.provinceIds) {
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const hid of province.holdingIds) {
      const assetIds = state.realEstateAssetIndex.byHolding[hid as string] ?? []
      for (const aid of assetIds) {
        const asset = state.realEstateAssets[aid]
        if (!asset) continue
        for (const recipeId of Object.keys(asset.recipeSlots) as ProductionRecipeId[]) {
          const weight = asset.recipeSlots[recipeId] ?? 0
          if (weight <= 0) continue
          const recipe = PRODUCTION_RECIPE_DEFINITIONS[recipeId]
          if (!recipe) continue
          for (const o of recipe.outputs) {
            out[o.resource] = (out[o.resource] ?? 0) + o.amount * asset.level * weight
          }
        }
      }
    }
  }
  return out
}

// 商家/貴族排他 guard (§10.3)。creation-time で候補列挙側に差す。
export function canHouseOwnMerchantCompany(state: WorldState, houseId: HouseId): boolean {
  const ids = state.polityIndex.byOwnerHouse[houseId] ?? []
  return ids.every((id) => !state.polities[id]?.active)
}

export function canHouseOwnPolity(state: WorldState, houseId: HouseId): boolean {
  const ids = state.merchantCompanyIndex.byOwnerHouse[houseId as string] ?? []
  return ids.every((id) => state.merchantCompanies[id]?.status !== 'active')
}
