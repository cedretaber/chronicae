import type { WorldState } from '../types/world'
import type {
  RealEstateSeizureId,
  RealEstateAssetId,
  HoldingId,
  PolityId,
  ProjectId,
  DecisionReasonId,
} from '../types/ids'
import type { AssetOwnerRef } from '../types/realEstateAsset'
import type { RealEstateSeizure, RealEstateSeizureStatus } from '../types/realEstateSeizure'
import { createRealEstateSeizureId } from '../types/ids'

// index は active entity のみ保持 (B7)。terminal 化したら全 index から除去する。

function pushIdx(
  slot: RealEstateSeizureId[] | undefined,
  id: RealEstateSeizureId,
): RealEstateSeizureId[] {
  return slot ? [...slot, id] : [id]
}

function removeFromArrayIdx(
  record: Record<string, RealEstateSeizureId[]>,
  key: string,
  id: RealEstateSeizureId,
): void {
  const slot = record[key]
  if (!slot) return
  const filtered = slot.filter((x) => (x as string) !== (id as string))
  if (filtered.length > 0) {
    record[key] = filtered
  } else {
    delete record[key]
  }
}

function ownerHouseKey(owner: AssetOwnerRef): string | undefined {
  return owner.kind === 'house' ? owner.id : undefined
}

function addToIndex(ws: WorldState, seizure: RealEstateSeizure): void {
  const idx = ws.realEstateSeizureIndex
  const holdingKey = seizure.holdingId as string
  idx.byHolding[holdingKey] = pushIdx(idx.byHolding[holdingKey], seizure.id)
  idx.byAsset[seizure.assetId as string] = seizure.id
  const houseKey = ownerHouseKey(seizure.rightfulOwner)
  if (houseKey) {
    idx.byRightfulOwnerHouse[houseKey] = pushIdx(idx.byRightfulOwnerHouse[houseKey], seizure.id)
  }
}

function removeFromIndex(ws: WorldState, seizure: RealEstateSeizure): void {
  const idx = ws.realEstateSeizureIndex
  removeFromArrayIdx(idx.byHolding, seizure.holdingId, seizure.id)
  if (idx.byAsset[seizure.assetId as string] === seizure.id) {
    delete idx.byAsset[seizure.assetId as string]
  }
  const houseKey = ownerHouseKey(seizure.rightfulOwner)
  if (houseKey) {
    removeFromArrayIdx(idx.byRightfulOwnerHouse, houseKey, seizure.id)
  }
}

export function createRealEstateSeizureMut(
  ws: WorldState,
  fields: {
    holdingId: HoldingId
    assetId: RealEstateAssetId
    seizerPolityId: PolityId
    rightfulOwner: AssetOwnerRef
    startedWeek: number
    accumulatedUnpaidAmount?: number
    reasonIds?: DecisionReasonId[]
  },
): RealEstateSeizure {
  const id = createRealEstateSeizureId(ws.nextRealEstateSeizureId++)
  const seizure: RealEstateSeizure = {
    id,
    status: 'active',
    holdingId: fields.holdingId,
    assetId: fields.assetId,
    seizerPolityId: fields.seizerPolityId,
    rightfulOwner: fields.rightfulOwner,
    startedWeek: fields.startedWeek,
    accumulatedUnpaidAmount: fields.accumulatedUnpaidAmount ?? 0,
    reasonIds: fields.reasonIds ?? [],
  }
  ws.realEstateSeizures[id] = seizure
  addToIndex(ws, seizure)
  return seizure
}

// status を terminal (resolved/legalized/cancelled) にして index から除去する。
// terminalWeek を記録し cleanupTerminalObligations の retention 起点にする。
export function changeRealEstateSeizureStatusMut(
  ws: WorldState,
  seizureId: RealEstateSeizureId,
  status: RealEstateSeizureStatus,
): void {
  const seizure = ws.realEstateSeizures[seizureId]
  if (!seizure) return
  const wasActive = seizure.status === 'active'
  const updated: RealEstateSeizure = { ...seizure, status }
  if (status !== 'active') updated.terminalWeek = ws.absoluteWeek
  ws.realEstateSeizures[seizureId] = updated
  if (wasActive && status !== 'active') {
    removeFromIndex(ws, seizure)
  }
}

export function setRealEstateSeizureAccrualMut(
  ws: WorldState,
  seizureId: RealEstateSeizureId,
  accumulatedUnpaidAmount: number,
): void {
  const seizure = ws.realEstateSeizures[seizureId]
  if (!seizure) return
  ws.realEstateSeizures[seizureId] = { ...seizure, accumulatedUnpaidAmount }
}

// enforce Project の active 化 / cooldown 更新。
export function setRealEstateSeizureEnforceMut(
  ws: WorldState,
  seizureId: RealEstateSeizureId,
  patch: { activeEnforceProjectId?: ProjectId | null; nextEnforceAllowedWeek?: number },
): void {
  const seizure = ws.realEstateSeizures[seizureId]
  if (!seizure) return
  const updated: RealEstateSeizure = { ...seizure }
  if (patch.activeEnforceProjectId === null) {
    delete updated.activeEnforceProjectId
  } else if (patch.activeEnforceProjectId !== undefined) {
    updated.activeEnforceProjectId = patch.activeEnforceProjectId
  }
  if (patch.nextEnforceAllowedWeek !== undefined) {
    updated.nextEnforceAllowedWeek = patch.nextEnforceAllowedWeek
  }
  ws.realEstateSeizures[seizureId] = updated
}

// retention 経過後に Record から完全削除する (cleanup 用)。
export function removeRealEstateSeizureMut(ws: WorldState, seizureId: RealEstateSeizureId): void {
  const seizure = ws.realEstateSeizures[seizureId]
  if (!seizure) return
  if (seizure.status === 'active') removeFromIndex(ws, seizure)
  delete ws.realEstateSeizures[seizureId]
}
