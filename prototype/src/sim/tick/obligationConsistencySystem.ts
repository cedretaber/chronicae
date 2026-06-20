import type { TickContext, CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { EventId } from '../types/ids'
import type { WorldState } from '../types/world'
import { changeRealEstateSeizureStatusMut } from '../mutations/realEstateSeizureMutations'
import { changeLandContractDefaultStatusMut } from '../mutations/landContractDefaultMutations'
import { removeObligationPressuresMut } from '../mutations/pressureMutations'
import { cancelEnforceProjectMut } from '../mutations/projectMutations'
import { getPolityNameRefForEmit } from '../selectors/nameRefSelectors'

// v0.53 §13.5 (A2): active な義務 entity の参照先を検査し、前提崩壊・dangling を cancelled にする。
//   prescription / accrual より前に走らせ、dangling を accrue / legalize する前に解消する。
//   既存 organizationConsistencySystem / rightConsistencySystem と同系統。
//   cancelled 時は *_CANCELLED イベントを emit し (§16.1)、紐づく enforce Project を terminal 化する。
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
    projects: { ...ctx.state.projects },
    projectIndex: {
      byOwner: { ...ctx.state.projectIndex.byOwner },
      byAim: { ...ctx.state.projectIndex.byAim },
      byParentProject: { ...ctx.state.projectIndex.byParentProject },
      byCreatorPerson: { ...ctx.state.projectIndex.byCreatorPerson },
      bySupervisorPerson: { ...ctx.state.projectIndex.bySupervisorPerson },
      byRelatedEntity: { ...ctx.state.projectIndex.byRelatedEntity },
    },
  }

  const newEvents: SimEvent[] = []
  let nextEventIndex = ctx.nextEventIndex
  function emitEvent(input: CreateSimEventInput): void {
    const id = `e-${ws.absoluteWeek}-${nextEventIndex}` as EventId
    nextEventIndex++
    newEvents.push({
      id,
      year: ws.currentYear,
      weekOfYear: ws.currentWeekOfYear,
      type: input.type,
      importance: input.importance,
      messageKey: input.messageKey,
      messageParams: input.messageParams,
      entityRefs: input.entityRefs ?? [],
      reasons: input.reasons ?? [],
      effects: input.effects ?? [],
    })
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
      if (seizure.activeEnforceProjectId) {
        cancelEnforceProjectMut(ws, seizure.activeEnforceProjectId, 'obligation_terminal')
      }
      // FK 免除の terminal entity だが、emit 時点で参照先が残っていれば ref に乗せる
      const holding = ws.holdings[seizure.holdingId]
      const ownerHouse =
        seizure.rightfulOwner.kind === 'house' ? ws.houses[seizure.rightfulOwner.id] : undefined
      const houseNameKey = ownerHouse?.nameKey ?? ''
      const provinceNameKey = holding ? (ws.provinces[holding.provinceId]?.nameKey ?? '') : ''
      const seizerRef = getPolityNameRefForEmit(ws, seizure.seizerPolityId)
      emitEvent({
        type: 'REAL_ESTATE_SEIZURE_CANCELLED',
        importance: 'minor',
        messageKey: 'real_estate_seizure.cancelled',
        messageParams: {
          house: nameParam('house', houseNameKey),
          province: nameParam('province', provinceNameKey),
        },
        entityRefs: [
          ...(ws.polities[seizure.seizerPolityId]
            ? [entityRef('polity', seizure.seizerPolityId, 'polity', seizerRef.nameKey)]
            : []),
          ...(ownerHouse
            ? [entityRef('house', seizure.rightfulOwner.id, 'owner', houseNameKey)]
            : []),
          ...(holding ? [entityRef('holding', seizure.holdingId, 'holding')] : []),
          ...(holding
            ? [entityRef('province', holding.provinceId, 'province', provinceNameKey)]
            : []),
        ],
      })
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
      if (d.activeEnforceProjectId) {
        cancelEnforceProjectMut(ws, d.activeEnforceProjectId, 'obligation_terminal')
      }
      const holding = ws.holdings[d.holdingId]
      const provinceNameKey = holding ? (ws.provinces[holding.provinceId]?.nameKey ?? '') : ''
      const claimantRef = getPolityNameRefForEmit(ws, d.claimantPolityId)
      const occupierRef = getPolityNameRefForEmit(ws, d.occupiedByPolityId)
      emitEvent({
        type: 'LAND_CONTRACT_DEFAULT_CANCELLED',
        importance: 'minor',
        messageKey: 'land_contract_default.cancelled',
        messageParams: {
          claimant: nameParam(claimantRef.category, claimantRef.nameKey),
          occupier: nameParam(occupierRef.category, occupierRef.nameKey),
          province: nameParam('province', provinceNameKey),
        },
        entityRefs: [
          ...(ws.polities[d.occupiedByPolityId]
            ? [entityRef('polity', d.occupiedByPolityId, 'occupier', occupierRef.nameKey)]
            : []),
          ...(ws.polities[d.claimantPolityId]
            ? [entityRef('polity', d.claimantPolityId, 'claimant', claimantRef.nameKey)]
            : []),
          ...(holding ? [entityRef('holding', d.holdingId, 'holding')] : []),
          ...(holding
            ? [entityRef('province', holding.provinceId, 'province', provinceNameKey)]
            : []),
        ],
      })
    }
  }

  if (newEvents.length === 0) return { ...ctx, state: ws }
  return { ...ctx, state: ws, events: [...ctx.events, ...newEvents], nextEventIndex }
}
