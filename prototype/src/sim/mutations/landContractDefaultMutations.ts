import type { WorldState } from '../types/world'
import type {
  LandContractDefaultId,
  LandContractId,
  HoldingId,
  PolityId,
  ProjectId,
  DecisionReasonId,
} from '../types/ids'
import type {
  LandContractDefault,
  LandContractDefaultStatus,
  LandContractDefaultOrigin,
} from '../types/landContractDefault'
import { createLandContractDefaultId } from '../types/ids'
import { removeObligationPressuresMut } from './pressureMutations'

// index は active entity のみ保持 (B7)。terminal 化したら全 index から除去する。

function pushIdx(
  slot: LandContractDefaultId[] | undefined,
  id: LandContractDefaultId,
): LandContractDefaultId[] {
  return slot ? [...slot, id] : [id]
}

function removeFromArrayIdx(
  record: Record<string, LandContractDefaultId[]>,
  key: string,
  id: LandContractDefaultId,
): void {
  const slot = record[key]
  if (!slot) return
  const filtered = slot.filter((x) => x !== id)
  if (filtered.length > 0) {
    record[key] = filtered
  } else {
    delete record[key]
  }
}

function addToIndex(ws: WorldState, d: LandContractDefault): void {
  const idx = ws.landContractDefaultIndex
  idx.byHolding[d.holdingId as string] = pushIdx(idx.byHolding[d.holdingId as string], d.id)
  idx.byContract[d.targetLandContractId as string] = d.id
  idx.byClaimantPolity[d.claimantPolityId as string] = pushIdx(
    idx.byClaimantPolity[d.claimantPolityId as string],
    d.id,
  )
  idx.byOccupierPolity[d.occupiedByPolityId as string] = pushIdx(
    idx.byOccupierPolity[d.occupiedByPolityId as string],
    d.id,
  )
}

function removeFromIndex(ws: WorldState, d: LandContractDefault): void {
  const idx = ws.landContractDefaultIndex
  removeFromArrayIdx(idx.byHolding, d.holdingId, d.id)
  if (idx.byContract[d.targetLandContractId as string] === d.id) {
    delete idx.byContract[d.targetLandContractId as string]
  }
  removeFromArrayIdx(idx.byClaimantPolity, d.claimantPolityId, d.id)
  removeFromArrayIdx(idx.byOccupierPolity, d.occupiedByPolityId, d.id)
}

export function createLandContractDefaultMut(
  ws: WorldState,
  fields: {
    origin: LandContractDefaultOrigin
    holdingId: HoldingId
    occupiedByPolityId: PolityId
    claimantPolityId: PolityId
    targetLandContractId: LandContractId
    originalGrantorPolityId?: PolityId
    originalGranteePolityId: PolityId
    originalTaxRateToGrantor: number
    startedWeek: number
    accumulatedUnpaidAmount?: number
    reasonIds?: DecisionReasonId[]
  },
): LandContractDefault {
  const id = createLandContractDefaultId(ws.nextLandContractDefaultId++)
  const d: LandContractDefault = {
    id,
    status: 'active',
    origin: fields.origin,
    holdingId: fields.holdingId,
    occupiedByPolityId: fields.occupiedByPolityId,
    claimantPolityId: fields.claimantPolityId,
    targetLandContractId: fields.targetLandContractId,
    ...(fields.originalGrantorPolityId !== undefined && {
      originalGrantorPolityId: fields.originalGrantorPolityId,
    }),
    originalGranteePolityId: fields.originalGranteePolityId,
    originalTaxRateToGrantor: fields.originalTaxRateToGrantor,
    startedWeek: fields.startedWeek,
    accumulatedUnpaidAmount: fields.accumulatedUnpaidAmount ?? 0,
    reasonIds: fields.reasonIds ?? [],
  }
  ws.landContractDefaults[id] = d
  addToIndex(ws, d)
  return d
}

export function changeLandContractDefaultStatusMut(
  ws: WorldState,
  defaultId: LandContractDefaultId,
  status: LandContractDefaultStatus,
): void {
  const d = ws.landContractDefaults[defaultId]
  if (!d) return
  const wasActive = d.status === 'active'
  const updated: LandContractDefault = { ...d, status }
  if (status !== 'active') updated.terminalWeek = ws.absoluteWeek
  ws.landContractDefaults[defaultId] = updated
  if (wasActive && status !== 'active') {
    removeFromIndex(ws, d)
  }
}

export function setLandContractDefaultAccrualMut(
  ws: WorldState,
  defaultId: LandContractDefaultId,
  accumulatedUnpaidAmount: number,
): void {
  const d = ws.landContractDefaults[defaultId]
  if (!d) return
  ws.landContractDefaults[defaultId] = { ...d, accumulatedUnpaidAmount }
}

export function setLandContractDefaultEnforceMut(
  ws: WorldState,
  defaultId: LandContractDefaultId,
  patch: { activeEnforceProjectId?: ProjectId | null; nextEnforceAllowedWeek?: number },
): void {
  const d = ws.landContractDefaults[defaultId]
  if (!d) return
  const updated: LandContractDefault = { ...d }
  if (patch.activeEnforceProjectId === null) {
    delete updated.activeEnforceProjectId
  } else if (patch.activeEnforceProjectId !== undefined) {
    updated.activeEnforceProjectId = patch.activeEnforceProjectId
  }
  if (patch.nextEnforceAllowedWeek !== undefined) {
    updated.nextEnforceAllowedWeek = patch.nextEnforceAllowedWeek
  }
  ws.landContractDefaults[defaultId] = updated
}

export function removeLandContractDefaultMut(
  ws: WorldState,
  defaultId: LandContractDefaultId,
): void {
  const d = ws.landContractDefaults[defaultId]
  if (!d) return
  if (d.status === 'active') removeFromIndex(ws, d)
  delete ws.landContractDefaults[defaultId]
}

// v0.53 Phase 4: 義務強制 (peaceful settle / war 勝利) の共通後処理。対象 default を resolved にし
//   関連 Pressure を削除した新 state を返す (immutable helper、ctx ベースの caller から呼ぶ)。
export function resolveLandContractDefaultState(
  state: WorldState,
  defaultId: LandContractDefaultId | undefined,
): WorldState {
  if (!defaultId) return state
  const d = state.landContractDefaults[defaultId]
  if (!d || d.status !== 'active') return state
  const ws: WorldState = {
    ...state,
    landContractDefaults: { ...state.landContractDefaults },
    landContractDefaultIndex: {
      byHolding: { ...state.landContractDefaultIndex.byHolding },
      byContract: { ...state.landContractDefaultIndex.byContract },
      byClaimantPolity: { ...state.landContractDefaultIndex.byClaimantPolity },
      byOccupierPolity: { ...state.landContractDefaultIndex.byOccupierPolity },
    },
    pressures: { ...state.pressures },
    pressureIndex: {
      byTarget: { ...state.pressureIndex.byTarget },
      bySource: { ...state.pressureIndex.bySource },
      byDiplomaticPlay: { ...state.pressureIndex.byDiplomaticPlay },
      byProject: { ...state.pressureIndex.byProject },
    },
  }
  changeLandContractDefaultStatusMut(ws, defaultId, 'resolved')
  removeObligationPressuresMut(ws, { kind: 'land_contract_default', id: defaultId })
  return ws
}
