// v0.42 PoliticalRight の read selector。index 経由の derivation のみ (entity 走査しない)。

import type { WorldState } from '../types/world'
import type { PolityId, RegimentId, HoldingId, PoliticalRightId } from '../types/ids'
import type { OfficeRole } from '../types/office'
import type {
  PoliticalRight,
  PoliticalRightHolderRef,
  PoliticalRightTargetRef,
} from '../types/politicalRight'
import { politicalRightTargetKey, politicalRightHolderKey } from '../types/politicalRight'

// target に対する active right (1 target 1 right — §4.2.2)。
export function getRightForTarget(
  state: WorldState,
  target: PoliticalRightTargetRef,
): PoliticalRight | undefined {
  const ids = state.politicalRightIndex.byTarget[politicalRightTargetKey(target)] ?? []
  const id = ids[0]
  return id !== undefined ? state.politicalRights[id] : undefined
}

// polity office role への appointment right (§9)。
export function getPolityOfficeAppointmentRight(
  state: WorldState,
  polityId: PolityId,
  role: OfficeRole,
): PoliticalRight | undefined {
  return getRightForTarget(state, { kind: 'polity_office_role', polityId, role })
}

// holding bailiff への appointment right (§10)。
export function getHoldingOfficeAppointmentRight(
  state: WorldState,
  holdingId: HoldingId,
): PoliticalRight | undefined {
  return getRightForTarget(state, { kind: 'holding_office_role', holdingId, role: 'bailiff' })
}

// regiment の controller right (§11.2 — Regiment 型にフィールドは持たず index から導出)。
export function getRegimentControllerRight(
  state: WorldState,
  regimentId: RegimentId,
): PoliticalRight | undefined {
  return getRightForTarget(state, { kind: 'regiment', regimentId })
}

export function getRightsByHolder(
  state: WorldState,
  holder: PoliticalRightHolderRef,
): PoliticalRight[] {
  const ids = state.politicalRightIndex.byHolder[politicalRightHolderKey(holder)] ?? []
  return ids.flatMap((id: PoliticalRightId) => {
    const right = state.politicalRights[id]
    return right ? [right] : []
  })
}

export function getRightsByPolity(state: WorldState, polityId: PolityId): PoliticalRight[] {
  const ids = state.politicalRightIndex.byPolity[polityId] ?? []
  return ids.flatMap((id: PoliticalRightId) => {
    const right = state.politicalRights[id]
    return right ? [right] : []
  })
}
