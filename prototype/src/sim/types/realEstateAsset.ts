import type { RealEstateAssetId, HoldingId, HouseId, PersonId, PolityId } from './ids'

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
}

export type RealEstateAssetIndex = {
  byHolding: Record<string, RealEstateAssetId[]>
  byOwner: Record<string, RealEstateAssetId[]>
}

export function assetOwnerKey(owner: AssetOwnerRef): string {
  return `${owner.kind}:${owner.id as string}`
}
