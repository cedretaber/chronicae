import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import { changeRealEstateSeizureStatusMut } from '../mutations/realEstateSeizureMutations'
import { changeLandContractDefaultStatusMut } from '../mutations/landContractDefaultMutations'
import { removeObligationPressuresMut } from '../mutations/pressureMutations'

// v0.53 §13.5 (A2): active な義務 entity の参照先を検査し、前提崩壊・dangling を cancelled にする。
//   prescription / accrual より前に走らせ、dangling を accrue / legalize する前に解消する。
//   既存 organizationConsistencySystem / rightConsistencySystem と同系統。
export function runObligationConsistencySystem(ctx: TickContext): TickContext {
  const hasActiveSeizure = Object.keys(ctx.state.realEstateSeizureIndex.byAsset).length > 0
  const hasActiveDefault = Object.keys(ctx.state.landContractDefaultIndex.byContract).length > 0
  if (!hasActiveSeizure && !hasActiveDefault) return ctx

  const ws: WorldState = {
    ...ctx.state,
    realEstateSeizures: { ...ctx.state.realEstateSeizures },
    realEstateSeizureIndex: {
      byHolding: { ...ctx.state.realEstateSeizureIndex.byHolding },
      byAsset: { ...ctx.state.realEstateSeizureIndex.byAsset },
      byRightfulOwnerHouse: { ...ctx.state.realEstateSeizureIndex.byRightfulOwnerHouse },
    },
    landContractDefaults: { ...ctx.state.landContractDefaults },
    landContractDefaultIndex: {
      byHolding: { ...ctx.state.landContractDefaultIndex.byHolding },
      byContract: { ...ctx.state.landContractDefaultIndex.byContract },
      byClaimantPolity: { ...ctx.state.landContractDefaultIndex.byClaimantPolity },
      byOccupierPolity: { ...ctx.state.landContractDefaultIndex.byOccupierPolity },
    },
    pressures: { ...ctx.state.pressures },
    pressureIndex: {
      byTarget: { ...ctx.state.pressureIndex.byTarget },
      bySource: { ...ctx.state.pressureIndex.bySource },
      byDiplomaticPlay: { ...ctx.state.pressureIndex.byDiplomaticPlay },
      byProject: { ...ctx.state.pressureIndex.byProject },
    },
  }

  for (const [, seizure] of Object.entries(ws.realEstateSeizures)) {
    if (!seizure || seizure.status !== 'active') continue

    let dangling = false
    const asset = ws.realEstateAssets[seizure.assetId]
    if (!asset) {
      dangling = true // asset 消滅
    } else if (!asset.owner) {
      dangling = true // owner が既に undefined (絶家 purge 等)
    } else if (
      seizure.rightfulOwner.kind === 'house' &&
      (asset.owner.kind !== 'house' ||
        (asset.owner.id as string) !== (seizure.rightfulOwner.id as string))
    ) {
      dangling = true // owner が rightfulOwner と一致しなくなった
    }

    if (!dangling && seizure.rightfulOwner.kind === 'house') {
      const ownerHouse = ws.houses[seizure.rightfulOwner.id]
      if (!ownerHouse || !ownerHouse.active) dangling = true // 絶家 / 非 active
    }

    if (!dangling) {
      const seizerPolity = ws.polities[seizure.seizerPolityId]
      if (!seizerPolity || !seizerPolity.active) dangling = true // seizerPolity 非 active
    }

    if (dangling) {
      changeRealEstateSeizureStatusMut(ws, seizure.id, 'cancelled')
      removeObligationPressuresMut(ws, { kind: 'real_estate_seizure', id: seizure.id })
    }
  }

  for (const [, d] of Object.entries(ws.landContractDefaults)) {
    if (!d || d.status !== 'active') continue

    let dangling = false
    if (!ws.landContracts[d.targetLandContractId])
      dangling = true // 契約消滅
    else if (!ws.holdings[d.holdingId])
      dangling = true // holding 消滅
    else if (!ws.polities[d.occupiedByPolityId]?.active)
      dangling = true // occupier 非 active
    else if (!ws.polities[d.claimantPolityId]?.active) dangling = true // claimant 非 active

    if (dangling) {
      changeLandContractDefaultStatusMut(ws, d.id, 'cancelled')
      removeObligationPressuresMut(ws, { kind: 'land_contract_default', id: d.id })
    }
  }

  return { ...ctx, state: ws }
}
