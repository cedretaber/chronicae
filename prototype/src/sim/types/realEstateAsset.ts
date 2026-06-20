import type {
  RealEstateAssetId,
  HoldingId,
  HouseId,
  PersonId,
  PolityId,
  ProductionRecipeId,
} from './ids'

export type RealEstateKind = 'field' | 'pasture' | 'workshop'

export type AssetOwnerRef =
  | { kind: 'house'; id: HouseId }
  | { kind: 'person'; id: PersonId }
  | { kind: 'polity'; id: PolityId }

export type RealEstateAsset = {
  id: RealEstateAssetId
  holdingId: HoldingId
  realEstateKind: RealEstateKind
  level: number
  owner?: AssetOwnerRef
  createdWeek: number
  // v0.54 §8: 生産レシピの slot 配分。20 slot = 100% (config.realEstateRecipeSlotCount)。
  //   slot は「労働配分比率」であり生産量乗数ではない (§12.1)。
  recipeSlots: Partial<Record<ProductionRecipeId, number>>
}

export type RealEstateAssetIndex = {
  byHolding: Record<string, RealEstateAssetId[]>
  byOwner: Record<string, RealEstateAssetId[]>
}

export function assetOwnerKey(owner: AssetOwnerRef): string {
  return `${owner.kind}:${owner.id as string}`
}
