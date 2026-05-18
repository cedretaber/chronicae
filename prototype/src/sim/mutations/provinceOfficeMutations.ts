import type { WorldState } from '../types/world'
import type { ProvinceId, PolityId, PersonId, ProvinceOfficeAssignmentId } from '../types/ids'
import type { ProvinceOfficeAssignment } from '../types/landContract'
import { createProvinceOfficeAssignmentId } from '../types/ids'

type AppointBailiffParams = {
  provinceId: ProvinceId
  holderPersonId: PersonId
  appointingPolityId: PolityId
  year: number
  month: number
}

type AppointResult = {
  state: WorldState
  assignmentId: ProvinceOfficeAssignmentId
}

function pushHolderSlot(
  index: WorldState['provinceOfficeIndex'],
  personId: PersonId,
  assignmentId: ProvinceOfficeAssignmentId,
): Record<PersonId, ProvinceOfficeAssignmentId[]> {
  const slot = index.byHolderPerson[personId] ?? []
  return { ...index.byHolderPerson, [personId]: [...slot, assignmentId] }
}

function pushPolitySlot(
  index: WorldState['provinceOfficeIndex'],
  polityId: PolityId,
  assignmentId: ProvinceOfficeAssignmentId,
): Record<PolityId, ProvinceOfficeAssignmentId[]> {
  const slot = index.byAppointingPolity[polityId] ?? []
  return { ...index.byAppointingPolity, [polityId]: [...slot, assignmentId] }
}

function removeFromHolderSlot(
  index: WorldState['provinceOfficeIndex'],
  personId: PersonId,
  assignmentId: ProvinceOfficeAssignmentId,
): Record<PersonId, ProvinceOfficeAssignmentId[]> {
  const slot = index.byHolderPerson[personId] ?? []
  const next = slot.filter((id) => id !== assignmentId)
  return { ...index.byHolderPerson, [personId]: next }
}

function removeFromPolitySlot(
  index: WorldState['provinceOfficeIndex'],
  polityId: PolityId,
  assignmentId: ProvinceOfficeAssignmentId,
): Record<PolityId, ProvinceOfficeAssignmentId[]> {
  const slot = index.byAppointingPolity[polityId] ?? []
  const next = slot.filter((id) => id !== assignmentId)
  return { ...index.byAppointingPolity, [polityId]: next }
}

export function appointBailiff(state: WorldState, params: AppointBailiffParams): AppointResult {
  const id = createProvinceOfficeAssignmentId(state.nextProvinceOfficeAssignmentId)
  const assignment: ProvinceOfficeAssignment = {
    id,
    provinceId: params.provinceId,
    role: 'bailiff',
    holderPersonId: params.holderPersonId,
    appointingPolityId: params.appointingPolityId,
    active: true,
    startYear: params.year,
    startMonth: params.month,
    unpaidCount: 0,
  }
  return {
    state: {
      ...state,
      provinceOfficeAssignments: {
        ...state.provinceOfficeAssignments,
        [id]: assignment,
      },
      provinceOfficeIndex: {
        byProvince: { ...state.provinceOfficeIndex.byProvince, [params.provinceId]: id },
        byHolderPerson: pushHolderSlot(state.provinceOfficeIndex, params.holderPersonId, id),
        byAppointingPolity: pushPolitySlot(
          state.provinceOfficeIndex,
          params.appointingPolityId,
          id,
        ),
      },
      nextProvinceOfficeAssignmentId: state.nextProvinceOfficeAssignmentId + 1,
    },
    assignmentId: id,
  }
}

export function vacateBailiff(state: WorldState, provinceId: ProvinceId): WorldState {
  const existingId = state.provinceOfficeIndex.byProvince[provinceId]
  if (!existingId) return state
  const existing = state.provinceOfficeAssignments[existingId]
  if (!existing) return state
  const nextAssignments = { ...state.provinceOfficeAssignments }
  delete nextAssignments[existingId]
  const nextByProvince = { ...state.provinceOfficeIndex.byProvince }
  delete nextByProvince[provinceId]
  return {
    ...state,
    provinceOfficeAssignments: nextAssignments,
    provinceOfficeIndex: {
      byProvince: nextByProvince,
      byHolderPerson: removeFromHolderSlot(
        state.provinceOfficeIndex,
        existing.holderPersonId,
        existingId,
      ),
      byAppointingPolity: removeFromPolitySlot(
        state.provinceOfficeIndex,
        existing.appointingPolityId,
        existingId,
      ),
    },
  }
}
