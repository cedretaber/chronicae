import type { WorldState } from '../types/world'
import type { HoldingId } from '../types/ids'
import type { Person } from '../types/person'
import type { HoldingOfficeAssignment } from '../types/landContract'
import { isPlaceholderPerson } from './landContractSelectors'

export function getHoldingBailiff(
  state: WorldState,
  holdingId: HoldingId,
): HoldingOfficeAssignment | undefined {
  const id = state.holdingOfficeIndex.byHolding[holdingId]
  if (!id) return undefined
  return state.holdingOfficeAssignments[id]
}

export function getHoldingBailiffPerson(
  state: WorldState,
  holdingId: HoldingId,
): Person | undefined {
  const bailiff = getHoldingBailiff(state, holdingId)
  if (!bailiff) return undefined
  return state.persons[bailiff.holderPersonId]
}

export function isHoldingOfficeVacantOrPlaceholder(
  state: WorldState,
  assignment: HoldingOfficeAssignment,
): boolean {
  if (!assignment.active) return true
  return isPlaceholderPerson(state, assignment.holderPersonId)
}
