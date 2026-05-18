import type { WorldState } from '../types/world'
import type { ProvinceId } from '../types/ids'
import type { Person } from '../types/person'
import type { ProvinceOfficeAssignment } from '../types/landContract'
import { isPlaceholderPerson } from './landContractSelectors'

export function getProvinceBailiff(
  state: WorldState,
  provinceId: ProvinceId,
): ProvinceOfficeAssignment | undefined {
  const id = state.provinceOfficeIndex.byProvince[provinceId]
  if (!id) return undefined
  return state.provinceOfficeAssignments[id]
}

export function getBailiffPerson(state: WorldState, provinceId: ProvinceId): Person | undefined {
  const bailiff = getProvinceBailiff(state, provinceId)
  if (!bailiff) return undefined
  return state.persons[bailiff.holderPersonId]
}

export function isOfficeVacantOrPlaceholder(
  state: WorldState,
  assignment: ProvinceOfficeAssignment,
): boolean {
  if (!assignment.active) return true
  return isPlaceholderPerson(state, assignment.holderPersonId)
}
