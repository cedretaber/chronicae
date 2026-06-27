import type { WorldState } from '../types/world'
import type { HoldingId, PolityId, PersonId, HoldingOfficeAssignmentId } from '../types/ids'
import type { HoldingOfficeAssignment } from '../types/landContract'
import { PLACEHOLDER_PERSON_ID } from '../types/person'
import { createHoldingOfficeAssignmentId } from '../types/ids'
import { targetRefKey } from '../types/task'
import { removeTaskFromIndicesMut } from './taskMutations'

type AppointHoldingBailiffParams = {
  holdingId: HoldingId
  holderPersonId: PersonId
  appointingPolityId: PolityId
  week: number
  expectedFeeRate?: number
}

type AppointResult = {
  state: WorldState
  assignmentId: HoldingOfficeAssignmentId
}

function pushHolderSlot(
  index: WorldState['holdingOfficeIndex'],
  personId: PersonId,
  assignmentId: HoldingOfficeAssignmentId,
): Record<PersonId, HoldingOfficeAssignmentId[]> {
  const slot = index.byHolderPerson[personId] ?? []
  return { ...index.byHolderPerson, [personId]: [...slot, assignmentId] }
}

function pushPolitySlot(
  index: WorldState['holdingOfficeIndex'],
  polityId: PolityId,
  assignmentId: HoldingOfficeAssignmentId,
): Record<PolityId, HoldingOfficeAssignmentId[]> {
  const slot = index.byAppointingPolity[polityId] ?? []
  return { ...index.byAppointingPolity, [polityId]: [...slot, assignmentId] }
}

function removeFromHolderSlot(
  index: WorldState['holdingOfficeIndex'],
  personId: PersonId,
  assignmentId: HoldingOfficeAssignmentId,
): Record<PersonId, HoldingOfficeAssignmentId[]> {
  const slot = index.byHolderPerson[personId] ?? []
  const next = slot.filter((id) => id !== assignmentId)
  return { ...index.byHolderPerson, [personId]: next }
}

function removeFromPolitySlot(
  index: WorldState['holdingOfficeIndex'],
  polityId: PolityId,
  assignmentId: HoldingOfficeAssignmentId,
): Record<PolityId, HoldingOfficeAssignmentId[]> {
  const slot = index.byAppointingPolity[polityId] ?? []
  const next = slot.filter((id) => id !== assignmentId)
  return { ...index.byAppointingPolity, [polityId]: next }
}

// v0.17.2 B2: placeholder holder は byHolderPerson に登録しない。
// 「あるPerson がどの Bailiff を持っているか」という索引は normal Person 向けの兼任チェック
// 用途であり、placeholder singleton に対しては意味を持たない (全 Holding の空席を 1 人で
// 占有することになり、ノイズになるだけ)。判定は Person.kind === 'placeholder' で行う。
export function appointHoldingBailiff(
  state: WorldState,
  params: AppointHoldingBailiffParams,
): AppointResult {
  const id = createHoldingOfficeAssignmentId(state.nextHoldingOfficeAssignmentId)
  const assignment: HoldingOfficeAssignment = {
    id,
    holdingId: params.holdingId,
    role: 'bailiff',
    holderPersonId: params.holderPersonId,
    appointingPolityId: params.appointingPolityId,
    active: true,
    startWeek: params.week,
    unpaidCount: 0,
    expectedFeeRate: params.expectedFeeRate ?? 0.03,
  }
  const holder = state.persons[params.holderPersonId]
  const isPlaceholder = holder?.kind === 'placeholder'
  return {
    state: {
      ...state,
      holdingOfficeAssignments: {
        ...state.holdingOfficeAssignments,
        [id]: assignment,
      },
      holdingOfficeIndex: {
        byHolding: { ...state.holdingOfficeIndex.byHolding, [params.holdingId]: id },
        byHolderPerson: isPlaceholder
          ? state.holdingOfficeIndex.byHolderPerson
          : pushHolderSlot(state.holdingOfficeIndex, params.holderPersonId, id),
        byAppointingPolity: pushPolitySlot(state.holdingOfficeIndex, params.appointingPolityId, id),
      },
      nextHoldingOfficeAssignmentId: state.nextHoldingOfficeAssignmentId + 1,
    },
    assignmentId: id,
  }
}

// v0.17.2 §19.2: 当該 Holding の bailiff を singleton placeholder Person に任命する。
// 既存 bailiff があれば事前に vacate する。
// 旧版は呼び出しごとに新規 placeholder Person を生成していたため AnonymousHouse.memberIds が
// 累積していた (seed 1 で 6266 体)。v0.17.2 以降は PLACEHOLDER_PERSON_ID の Person 1 体を
// 全 Holding の空席で共有する。worldgen で生成済みである前提。
export function installHoldingPlaceholderBailiff(
  state: WorldState,
  params: { holdingId: HoldingId; appointingPolityId: PolityId; week: number },
): WorldState {
  const working = vacateHoldingBailiff(state, params.holdingId)
  const { state: afterAppoint } = appointHoldingBailiff(working, {
    holdingId: params.holdingId,
    holderPersonId: PLACEHOLDER_PERSON_ID,
    appointingPolityId: params.appointingPolityId,
    week: params.week,
  })
  return afterAppoint
}

export function vacateHoldingBailiff(state: WorldState, holdingId: HoldingId): WorldState {
  const existingId = state.holdingOfficeIndex.byHolding[holdingId]
  if (!existingId) return state
  const existing = state.holdingOfficeAssignments[existingId]
  if (!existing) return state

  // この assignment を target にする Task (collect_holding_revenue 等) を先に purge する。
  //   bailiffRevenueTaskSystem は active assignment しか走査しないため、assignment を消すだけだと
  //   進行中の collect_holding_revenue タスクが dangling 化し、§17.2 整合性違反になる
  //   (タスク deadline ≤4週ゆえタイミング依存で稀に year-end に残る)。削除点で確実に巻き取る。
  let working = state
  const targetKey = targetRefKey({ kind: 'holding_office_assignment', id: existingId })
  const danglingTaskIds = state.taskIndex.byTarget[targetKey]
  if (danglingTaskIds && danglingTaskIds.length > 0) {
    const draft: WorldState = {
      ...state,
      tasks: { ...state.tasks },
      taskIndex: {
        byAssignee: { ...state.taskIndex.byAssignee },
        byOwner: { ...state.taskIndex.byOwner },
        byTarget: { ...state.taskIndex.byTarget },
      },
    }
    for (const taskId of [...danglingTaskIds]) {
      removeTaskFromIndicesMut(draft, taskId)
    }
    working = draft
  }

  const nextAssignments = { ...working.holdingOfficeAssignments }
  delete nextAssignments[existingId]
  const nextByHolding = { ...working.holdingOfficeIndex.byHolding }
  delete nextByHolding[holdingId]
  return {
    ...working,
    holdingOfficeAssignments: nextAssignments,
    holdingOfficeIndex: {
      byHolding: nextByHolding,
      byHolderPerson: removeFromHolderSlot(
        working.holdingOfficeIndex,
        existing.holderPersonId,
        existingId,
      ),
      byAppointingPolity: removeFromPolitySlot(
        working.holdingOfficeIndex,
        existing.appointingPolityId,
        existingId,
      ),
    },
  }
}
