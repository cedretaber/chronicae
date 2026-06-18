import type { RealEstateAssetId, HoldingId, HouseId, PersonId, PolityId } from './ids'

export type RealEstateKind =
  | 'field'
  | 'pasture'
  | 'workshop'
  | 'shop'
  | 'warehouse'
  | 'lord_hall'
  | 'town_hall'

export type AssetOwnerRef =
  | { kind: 'house'; id: HouseId }
  | { kind: 'person'; id: PersonId }
  | { kind: 'polity'; id: PolityId }

export type RealEstateAsset = {
  id: RealEstateAssetId
  holdingId: HoldingId
  realEstateKind: RealEstateKind
  level: number
  usesSlot: boolean
  fixedInstitution: boolean
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
