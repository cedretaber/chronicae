import type { WorldState } from '../types/world'
import type { ProvinceId, PolityId, PersonId, ProvinceOfficeAssignmentId } from '../types/ids'
import type { ProvinceOfficeAssignment } from '../types/landContract'
import { PLACEHOLDER_PERSON_ID } from '../types/landContract'
import { createProvinceOfficeAssignmentId } from '../types/ids'

type AppointBailiffParams = {
  provinceId: ProvinceId
  holderPersonId: PersonId
  appointingPolityId: PolityId
  year: number
  week: number
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

// v0.17.2 B2: placeholder holder は byHolderPerson に登録しない。
// 「あるPerson がどの Bailiff を持っているか」という索引は normal Person 向けの兼任チェック
// 用途であり、placeholder singleton に対しては意味を持たない (全 Province の空席を 1 人で
// 占有することになり、ノイズになるだけ)。判定は Person.kind === 'placeholder' で行う。
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
    startWeek: params.week,
    unpaidCount: 0,
  }
  const holder = state.persons[params.holderPersonId]
  const isPlaceholder = holder?.kind === 'placeholder'
  return {
    state: {
      ...state,
      provinceOfficeAssignments: {
        ...state.provinceOfficeAssignments,
        [id]: assignment,
      },
      provinceOfficeIndex: {
        byProvince: { ...state.provinceOfficeIndex.byProvince, [params.provinceId]: id },
        byHolderPerson: isPlaceholder
          ? state.provinceOfficeIndex.byHolderPerson
          : pushHolderSlot(state.provinceOfficeIndex, params.holderPersonId, id),
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

// v0.17.2 §19.2: 当該 Province の bailiff を singleton placeholder Person に任命する。
// 既存 bailiff があれば事前に vacate する。
// 旧版は呼び出しごとに新規 placeholder Person を生成していたため AnonymousHouse.memberIds が
// 累積していた (seed 1 で 6266 体)。v0.17.2 以降は PLACEHOLDER_PERSON_ID の Person 1 体を
// 全 Province の空席で共有する。worldgen で生成済みである前提。
export function installPlaceholderBailiff(
  state: WorldState,
  params: { provinceId: ProvinceId; appointingPolityId: PolityId; year: number; week: number },
): WorldState {
  const working = vacateBailiff(state, params.provinceId)
  const { state: afterAppoint } = appointBailiff(working, {
    provinceId: params.provinceId,
    holderPersonId: PLACEHOLDER_PERSON_ID,
    appointingPolityId: params.appointingPolityId,
    year: params.year,
    week: params.week,
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
