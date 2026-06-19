import type { TickContext } from './context'
import type { RealEstateAssetId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { AssetOwnerRef } from '../types/realEstateAsset'
import { changeRealEstateAssetOwnerMut } from '../mutations/realEstateAssetMutations'

export function runRealEstateOwnerSuccessionSystem(ctx: TickContext): TickContext {
  const changes: Array<{ assetId: RealEstateAssetId; newOwner: AssetOwnerRef | undefined }> = []

  for (const [assetIdStr, asset] of Object.entries(ctx.state.realEstateAssets)) {
    if (!asset?.owner) continue
    const assetId = assetIdStr as RealEstateAssetId

    switch (asset.owner.kind) {
      case 'person': {
        const person = ctx.state.persons[asset.owner.id]
        if (!person || !person.alive) {
          if (person?.houseId) {
            const house = ctx.state.houses[person.houseId]
            if (house?.active) {
              changes.push({ assetId, newOwner: { kind: 'house', id: person.houseId } })
              break
            }
          }
          changes.push({ assetId, newOwner: undefined })
        }
        break
      }
      case 'house': {
        const house = ctx.state.houses[asset.owner.id]
        if (!house?.active) {
          changes.push({ assetId, newOwner: undefined })
        }
        break
      }
      case 'polity': {
        const polity = ctx.state.polities[asset.owner.id]
        if (!polity?.active) {
          changes.push({ assetId, newOwner: undefined })
        }
        break
      }
    }
  }

  if (changes.length === 0) return ctx

  const ws: WorldState = {
    ...ctx.state,
    realEstateAssets: { ...ctx.state.realEstateAssets },
    realEstateAssetIndex: {
      byHolding: { ...ctx.state.realEstateAssetIndex.byHolding },
      byOwner: { ...ctx.state.realEstateAssetIndex.byOwner },
    },
  }

  for (const change of changes) {
    changeRealEstateAssetOwnerMut(ws, change.assetId, change.newOwner)
  }

  return { ...ctx, state: ws }
}
