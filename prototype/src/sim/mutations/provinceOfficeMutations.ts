import type { WorldState } from '../types/world'
import type { ProvinceId, PolityId, PersonId, ProvinceOfficeAssignmentId } from '../types/ids'
import type { ProvinceOfficeAssignment } from '../types/landContract'
import type { Person } from '../types/person'
import { ANONYMOUS_HOUSE_ID } from '../types/landContract'
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

// v0.16 §19.2: 新規 placeholder Person を AnonymousHouse 配下に作り、当該 Province の bailiff に任命する。
// 既存 bailiff があれば事前に vacate する。
// placeholder Person ID は世代カウンタを使うと runtime nextPersonIndex と干渉するので、
// state.nextProvinceOfficeAssignmentId を流用した安定 ID `pe-anon-rt-<N>` を採用する。
export function installPlaceholderBailiff(
  state: WorldState,
  params: { provinceId: ProvinceId; appointingPolityId: PolityId; year: number; month: number },
): WorldState {
  let working = vacateBailiff(state, params.provinceId)

  const placeholderId = ('pe-anon-rt-' + working.nextProvinceOfficeAssignmentId) as PersonId
  const placeholder: Person = {
    id: placeholderId,
    name: 'Anonymous',
    sex: 'male',
    age: 30,
    alive: true,
    kind: 'placeholder',
    houseId: ANONYMOUS_HOUSE_ID,
    childIds: [],
    birthStatus: 'unknown',
    abilities: { valor: 0, command: 0, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
    aptitudes: { valor: 0, command: 0, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
    traits: { ambition: 0, caution: 0 },
    legacyPrestige: 0,
    wealth: 0,
    attitudes: {},
  }

  const anonHouse = working.houses[ANONYMOUS_HOUSE_ID]
  const updatedAnonHouse = anonHouse
    ? { ...anonHouse, memberIds: [...anonHouse.memberIds, placeholderId] }
    : anonHouse

  working = {
    ...working,
    persons: { ...working.persons, [placeholderId]: placeholder },
    ...(updatedAnonHouse
      ? { houses: { ...working.houses, [ANONYMOUS_HOUSE_ID]: updatedAnonHouse } }
      : {}),
  }

  const { state: afterAppoint } = appointBailiff(working, {
    provinceId: params.provinceId,
    holderPersonId: placeholderId,
    appointingPolityId: params.appointingPolityId,
    year: params.year,
    month: params.month,
  })
  return afterAppoint
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
