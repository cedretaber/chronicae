import type { WorldState } from '../types/world'
import type { RealEstateAssetId, HoldingId } from '../types/ids'
import type { RealEstateKind, AssetOwnerRef, RealEstateAsset } from '../types/realEstateAsset'
import { assetOwnerKey } from '../types/realEstateAsset'
import { createRealEstateAssetId } from '../types/ids'
import type { ProductionRecipeId } from '../types/ids'
import { getDefaultRecipeSlotsForRealEstateKind } from '../config/productionRecipeDefinitions'

export function createRealEstateAssetMut(
  ws: WorldState,
  fields: {
    holdingId: HoldingId
    realEstateKind: RealEstateKind
    level: number
    owner?: AssetOwnerRef
    createdWeek: number
    // v0.54: 未指定なら realEstateKind の既定 recipeSlots を割り当てる (§8.3)。
    recipeSlots?: Partial<Record<ProductionRecipeId, number>>
  },
): RealEstateAsset {
  const id = createRealEstateAssetId(ws.nextRealEstateAssetId++)
  const { recipeSlots, ...rest } = fields
  const asset: RealEstateAsset = {
    id,
    ...rest,
    recipeSlots: recipeSlots ?? getDefaultRecipeSlotsForRealEstateKind(fields.realEstateKind),
  }

  ws.realEstateAssets[id] = asset

  const holdingKey = fields.holdingId as string
  const holdingSlot = ws.realEstateAssetIndex.byHolding[holdingKey]
  ws.realEstateAssetIndex.byHolding[holdingKey] = holdingSlot ? [...holdingSlot, id] : [id]

  if (fields.owner) {
    const ownerK = assetOwnerKey(fields.owner)
    const ownerSlot = ws.realEstateAssetIndex.byOwner[ownerK]
    ws.realEstateAssetIndex.byOwner[ownerK] = ownerSlot ? [...ownerSlot, id] : [id]
  }

  return asset
}

export function upgradeRealEstateAssetLevelMut(
  ws: WorldState,
  assetId: RealEstateAssetId,
  newLevel: number,
): void {
  const asset = ws.realEstateAssets[assetId]
  if (!asset) return
  ws.realEstateAssets[assetId] = { ...asset, level: newLevel }
}

export function changeRealEstateAssetOwnerMut(
  ws: WorldState,
  assetId: RealEstateAssetId,
  newOwner?: AssetOwnerRef,
): void {
  const asset = ws.realEstateAssets[assetId]
  if (!asset) return

  if (asset.owner) {
    const oldKey = assetOwnerKey(asset.owner)
    const oldSlot = ws.realEstateAssetIndex.byOwner[oldKey]
    if (oldSlot) {
      const filtered = oldSlot.filter((id) => (id as string) !== (assetId as string))
      if (filtered.length > 0) {
        ws.realEstateAssetIndex.byOwner[oldKey] = filtered
      } else {
        delete ws.realEstateAssetIndex.byOwner[oldKey]
      }
    }
  }

  if (newOwner) {
    const newKey = assetOwnerKey(newOwner)
    const newSlot = ws.realEstateAssetIndex.byOwner[newKey]
    ws.realEstateAssetIndex.byOwner[newKey] = newSlot ? [...newSlot, assetId] : [assetId]
    ws.realEstateAssets[assetId] = { ...asset, owner: newOwner }
  } else {
    const updated = { ...asset }
    delete updated.owner
    ws.realEstateAssets[assetId] = updated
  }
}
