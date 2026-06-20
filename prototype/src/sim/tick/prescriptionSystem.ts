import type { TickContext, CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { EventId } from '../types/ids'
import type { WorldState } from '../types/world'
import { changeRealEstateSeizureStatusMut } from '../mutations/realEstateSeizureMutations'
import { changeRealEstateAssetOwnerMut } from '../mutations/realEstateAssetMutations'
import { removeObligationPressuresMut } from '../mutations/pressureMutations'
import { getSeizurePrescriptionRemainingWeeks } from '../selectors/realEstateSeizureSelectors'

// v0.53 §13: 押領・不履行が 20年争われなかったら既成事実化する (lastContestedWeek 方式)。
//   seizure legalized → asset.owner = undefined (Holding 所属不動産へ戻る)。
export function runPrescriptionSystem(ctx: TickContext): TickContext {
  const hasActiveSeizure = Object.keys(ctx.state.realEstateSeizureIndex.byAsset).length > 0
  if (!hasActiveSeizure) return ctx

  const ws: WorldState = {
    ...ctx.state,
    realEstateSeizures: { ...ctx.state.realEstateSeizures },
    realEstateSeizureIndex: {
      byHolding: { ...ctx.state.realEstateSeizureIndex.byHolding },
      byAsset: { ...ctx.state.realEstateSeizureIndex.byAsset },
      byRightfulOwnerHouse: { ...ctx.state.realEstateSeizureIndex.byRightfulOwnerHouse },
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

  return { ...ctx, state: ws, events: [...ctx.events, ...newEvents], nextEventIndex }
}
