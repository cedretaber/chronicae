import type { TickContext, CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { EventId } from '../types/ids'
import type { WorldState } from '../types/world'
import { changeRealEstateSeizureStatusMut } from '../mutations/realEstateSeizureMutations'
import { changeLandContractDefaultStatusMut } from '../mutations/landContractDefaultMutations'
import { changeRealEstateAssetOwnerMut } from '../mutations/realEstateAssetMutations'
import { normalizeHoldingChainToRoot } from '../mutations/landContractMutations'
import { removeObligationPressuresMut } from '../mutations/pressureMutations'
import { getSeizurePrescriptionRemainingWeeks } from '../selectors/realEstateSeizureSelectors'
import { getPolityNameRefForEmit } from '../selectors/nameRefSelectors'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'

// v0.53 §13: 押領・不履行が 20年争われなかったら既成事実化する (lastContestedWeek 方式)。
//   seizure legalized → asset.owner = undefined (Holding 所属不動産へ戻る)。
//   default legalized → chain を新 root 化 (当該 holding が事実上独立)。
export function runPrescriptionSystem(ctx: TickContext): TickContext {
  const hasActiveSeizure = Object.keys(ctx.state.realEstateSeizureIndex.byAsset).length > 0
  const hasActiveDefault = Object.keys(ctx.state.landContractDefaultIndex.byContract).length > 0
  if (!hasActiveSeizure && !hasActiveDefault) return ctx

  let ws: WorldState = {
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
    realEstateAssets: { ...ctx.state.realEstateAssets },
    realEstateAssetIndex: {
      byHolding: { ...ctx.state.realEstateAssetIndex.byHolding },
      byOwner: { ...ctx.state.realEstateAssetIndex.byOwner },
    },
    pressures: { ...ctx.state.pressures },
    pressureIndex: {
      byTarget: { ...ctx.state.pressureIndex.byTarget },
      bySource: { ...ctx.state.pressureIndex.bySource },
      byDiplomaticPlay: { ...ctx.state.pressureIndex.byDiplomaticPlay },
      byProject: { ...ctx.state.pressureIndex.byProject },
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
    const remaining = getSeizurePrescriptionRemainingWeeks(ws, ctx.config, seizure)
    if (remaining > 0) continue

    // 時効到達: legalize
    changeRealEstateSeizureStatusMut(ws, seizure.id, 'legalized')
    changeRealEstateAssetOwnerMut(ws, seizure.assetId, undefined)
    removeObligationPressuresMut(ws, { kind: 'real_estate_seizure', id: seizure.id })

    const holding = ws.holdings[seizure.holdingId]
    const ownerHouse =
      seizure.rightfulOwner.kind === 'house' ? ws.houses[seizure.rightfulOwner.id] : undefined
    const houseNameKey = ownerHouse?.nameKey ?? ''
    const provinceNameKey = holding ? (ws.provinces[holding.provinceId]?.nameKey ?? '') : ''
    emitEvent({
      type: 'REAL_ESTATE_SEIZURE_LEGALIZED',
      importance: 'minor',
      messageKey: 'real_estate_seizure.legalized',
      messageParams: {
        house: nameParam('house', houseNameKey),
        province: nameParam('province', provinceNameKey),
      },
      entityRefs: [
        ...(seizure.rightfulOwner.kind === 'house'
          ? [entityRef('house', seizure.rightfulOwner.id, 'owner', houseNameKey)]
          : []),
        entityRef('holding', seizure.holdingId, 'holding'),
      ],
    })
  }

  for (const [, d] of Object.entries(ws.landContractDefaults)) {
    if (!d || d.status !== 'active') continue
    const baseWeek = d.lastContestedWeek ?? d.startedWeek
    const elapsed = ws.absoluteWeek - baseWeek
    if (elapsed < ctx.config.landContractDefaultPrescriptionYears * WEEKS_PER_YEAR) continue

    // 時効到達: legalize → chain 正規化 (新 root 化、§13.4)。
    changeLandContractDefaultStatusMut(ws, d.id, 'legalized')
    removeObligationPressuresMut(ws, { kind: 'land_contract_default', id: d.id })
    // normalizeHoldingChainToRoot は immutable helper。全 slice 込みの新 state を返すため
    //   ws を丸ごと差し替える ([[project_mutable_draft_writeback_slices]])。
    ws = normalizeHoldingChainToRoot(ws, d.holdingId, d.targetLandContractId)

    const claimantRef = getPolityNameRefForEmit(ws, d.claimantPolityId)
    const occupierRef = getPolityNameRefForEmit(ws, d.occupiedByPolityId)
    const holding = ws.holdings[d.holdingId]
    const provinceNameKey = holding ? (ws.provinces[holding.provinceId]?.nameKey ?? '') : ''
    emitEvent({
      type: 'LAND_CONTRACT_DEFAULT_LEGALIZED',
      importance: 'minor',
      messageKey: 'land_contract_default.legalized',
      messageParams: {
        occupier: nameParam(occupierRef.category, occupierRef.nameKey),
        claimant: nameParam(claimantRef.category, claimantRef.nameKey),
        province: nameParam('province', provinceNameKey),
      },
      entityRefs: [
        entityRef('polity', d.occupiedByPolityId, 'occupier', occupierRef.nameKey),
        entityRef('polity', d.claimantPolityId, 'claimant', claimantRef.nameKey),
        entityRef('holding', d.holdingId, 'holding'),
      ],
    })
  }

  return { ...ctx, state: ws, events: [...ctx.events, ...newEvents], nextEventIndex }
}
