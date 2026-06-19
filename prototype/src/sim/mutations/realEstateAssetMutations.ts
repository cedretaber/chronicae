import type { WorldState } from '../types/world'
import type { RealEstateAssetId, HoldingId } from '../types/ids'
import type { RealEstateKind, AssetOwnerRef, RealEstateAsset } from '../types/realEstateAsset'
import { assetOwnerKey } from '../types/realEstateAsset'
import { createRealEstateAssetId } from '../types/ids'

export function createRealEstateAssetMut(
  ws: WorldState,
  fields: {
    holdingId: HoldingId
    realEstateKind: RealEstateKind
    level: number
    owner?: AssetOwnerRef
    createdWeek: number
  },
): RealEstateAsset {
  const id = createRealEstateAssetId(ws.nextRealEstateAssetId++)
  const asset: RealEstateAsset = { id, ...fields }

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

export function removeRealEstateAssetMut(ws: WorldState, assetId: RealEstateAssetId): void {
  const asset = ws.realEstateAssets[assetId]
  if (!asset) return

  const holdingKey = asset.holdingId as string
  const holdingSlot = ws.realEstateAssetIndex.byHolding[holdingKey]
  if (holdingSlot) {
    const filtered = holdingSlot.filter((id) => (id as string) !== (assetId as string))
    if (filtered.length > 0) {
      ws.realEstateAssetIndex.byHolding[holdingKey] = filtered
    } else {
      delete ws.realEstateAssetIndex.byHolding[holdingKey]
    }
  }

  if (asset.owner) {
    const ownerK = assetOwnerKey(asset.owner)
    const ownerSlot = ws.realEstateAssetIndex.byOwner[ownerK]
    if (ownerSlot) {
      const filtered = ownerSlot.filter((id) => (id as string) !== (assetId as string))
      if (filtered.length > 0) {
        ws.realEstateAssetIndex.byOwner[ownerK] = filtered
      } else {
        delete ws.realEstateAssetIndex.byOwner[ownerK]
      }
    }
  }

  delete ws.realEstateAssets[assetId]
}
