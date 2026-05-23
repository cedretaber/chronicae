import { describe, it, expect } from 'vitest'
import { runBailiffRevenueTaskSystem } from './bailiffRevenueTaskSystem'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext } from './context'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { ProvinceId, PolityId, HouseId, PersonId, HoldingId } from '../types/ids'
import type { Task } from '../types/task'
import { targetRefKey } from '../types/task'
import { decisionSubjectKey } from '../types/goal'
import { createTaskId } from '../types/ids'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  withPerson,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { appointHoldingBailiff, vacateHoldingBailiff } from '../mutations/provinceOfficeMutations'

function makeCtx(state: WorldState): TickContext {
  return createTickContext({ state, config: defaultConfig, rng: createRng('test') })
}

function setupBaseWorld(): {
  state: WorldState
  polityId: PolityId
  houseId: HouseId
  provinceId: ProvinceId
  holdingId: HoldingId
} {
  const polityId = 'dp-0' as PolityId
  const houseId = 'dh-0' as HouseId
  const provinceId = 'pr-0' as ProvinceId

  let state = makeEmptyV016State()
  state = withHouse(state, houseId, { seatProvinceId: provinceId })
  state = withProvince(state, provinceId, {})
  state = withPolity(state, polityId, {
    treasury: 0,
    capitalProvinceId: provinceId,
    ownerHouseId: houseId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  const holdingId = state.provinces[provinceId]!.holdingIds[0]!
  return { state, polityId, houseId, provinceId, holdingId }
}

function setupWithNormalBailiff(): ReturnType<typeof setupBaseWorld> & {
  bailiffPersonId: PersonId
} {
  const base = setupBaseWorld()
  let state = vacateHoldingBailiff(base.state, base.holdingId)
  const bailiffPersonId = 'pe-bailiff' as PersonId
  state = withPerson(state, bailiffPersonId, {
    houseId: base.houseId,
    age: 25,
    wealth: 0,
    kind: 'normal',
  })
  state = appointHoldingBailiff(state, {
    holdingId: base.holdingId,
    holderPersonId: bailiffPersonId,
    appointingPolityId: base.polityId,
    week: state.absoluteWeek,
  }).state
  return { ...base, state, bailiffPersonId }
}

function getTasksByKind(state: WorldState, kind: string): Task[] {
  return Object.values(state.tasks).filter((t): t is Task => t !== undefined && t.kind === kind)
}

describe('runBailiffRevenueTaskSystem', () => {
  it('normal bailiff generates collect_holding_revenue Task', () => {
    const { state } = setupWithNormalBailiff()
    const result = runBailiffRevenueTaskSystem(makeCtx(state))
    const tasks = getTasksByKind(result.state, 'collect_holding_revenue')
    expect(tasks.length).toBe(1)
    const task = tasks[0]!
    expect(task.kind).toBe('collect_holding_revenue')
    expect(task.status).toBe('active')
  })

  it('placeholder bailiff does NOT generate Task', () => {
    const { state } = setupBaseWorld()
    const result = runBailiffRevenueTaskSystem(makeCtx(state))
    const tasks = getTasksByKind(result.state, 'collect_holding_revenue')
    expect(tasks.length).toBe(0)
  })

  it('Task has correct parameters', () => {
    const { state, holdingId, bailiffPersonId } = setupWithNormalBailiff()
    const result = runBailiffRevenueTaskSystem(makeCtx(state))
    const tasks = getTasksByKind(result.state, 'collect_holding_revenue')
    expect(tasks.length).toBe(1)
    const task = tasks[0]!

    expect(task.actionCost).toBe(1)
    expect(task.effortRequired).toBe(1)
    expect(task.priority).toBe(1)
    expect(task.deadlineWeek).toBe(state.absoluteWeek + 4)
    expect(task.assigneePersonId).toBe(bailiffPersonId)
    expect(task.owner).toEqual({ kind: 'person', id: bailiffPersonId })
    expect(task.targetRef.kind).toBe('holding_office_assignment')

    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    expect(task.targetRef.id).toBe(assignmentId)
  })

  it('Task is registered in all three indices', () => {
    const { state, holdingId, bailiffPersonId } = setupWithNormalBailiff()
    const result = runBailiffRevenueTaskSystem(makeCtx(state))
    const tasks = getTasksByKind(result.state, 'collect_holding_revenue')
    const task = tasks[0]!

    const assigneeKey = bailiffPersonId as string
    expect(result.state.taskIndex.byAssignee[assigneeKey]).toContain(task.id)

    const ownerKey = decisionSubjectKey({ kind: 'person', id: bailiffPersonId })
    expect(result.state.taskIndex.byOwner[ownerKey]).toContain(task.id)

    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const tKey = targetRefKey({ kind: 'holding_office_assignment', id: assignmentId })
    expect(result.state.taskIndex.byTarget[tKey]).toContain(task.id)
  })

  it('previous active Task is expired when new one is created', () => {
    const { state, holdingId, bailiffPersonId } = setupWithNormalBailiff()
    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!

    const existingTaskId = createTaskId(state.nextTaskId)
    const existingTask: Task = {
      id: existingTaskId,
      owner: { kind: 'person', id: bailiffPersonId },
      assigneePersonId: bailiffPersonId,
      kind: 'collect_holding_revenue',
      targetRef: { kind: 'holding_office_assignment', id: assignmentId },
      priority: 1,
      actionCost: 1,
      effortRequired: 1,
      effortDone: 0,
      createdWeek: state.absoluteWeek - 4,
      deadlineWeek: state.absoluteWeek,
      status: 'active',
      reasonIds: [],
    }

    const ownerKey = decisionSubjectKey({ kind: 'person', id: bailiffPersonId })
    const tKey = targetRefKey({ kind: 'holding_office_assignment', id: assignmentId })
    const assigneeKey = bailiffPersonId as string

    const stateWithTask: WorldState = {
      ...state,
      tasks: { ...state.tasks, [existingTaskId]: existingTask },
      taskIndex: {
        ...state.taskIndex,
        byAssignee: {
          ...state.taskIndex.byAssignee,
          [assigneeKey]: [...(state.taskIndex.byAssignee[assigneeKey] ?? []), existingTaskId],
        },
        byOwner: {
          ...state.taskIndex.byOwner,
          [ownerKey]: [...(state.taskIndex.byOwner[ownerKey] ?? []), existingTaskId],
        },
        byTarget: {
          ...state.taskIndex.byTarget,
          [tKey]: [...(state.taskIndex.byTarget[tKey] ?? []), existingTaskId],
        },
      },
      nextTaskId: state.nextTaskId + 1,
    }

    const result = runBailiffRevenueTaskSystem(makeCtx(stateWithTask))

    expect(result.state.tasks[existingTaskId]).toBeUndefined()

    const activeTasks = getTasksByKind(result.state, 'collect_holding_revenue').filter(
      (t) => t.status === 'active',
    )
    expect(activeTasks.length).toBe(1)
    expect((activeTasks[0]!.id as string) !== (existingTaskId as string)).toBe(true)

    const logs = Object.values(result.state.personActivityLogs).filter(
      (l) => l && l.kind === 'task_expired' && l.taskKind === 'collect_holding_revenue',
    )
    expect(logs.length).toBe(1)
    expect(logs[0]!.outcome).toBe('failure')
  })

  it('inactive assignment generates no Task', () => {
    const { state, holdingId } = setupWithNormalBailiff()
    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const assignment = state.holdingOfficeAssignments[assignmentId]!
    const deactivated: WorldState = {
      ...state,
      holdingOfficeAssignments: {
        ...state.holdingOfficeAssignments,
        [assignmentId]: { ...assignment, active: false },
      },
    }
    const result = runBailiffRevenueTaskSystem(makeCtx(deactivated))
    const tasks = getTasksByKind(result.state, 'collect_holding_revenue')
    expect(tasks.length).toBe(0)
  })

  it('dead holder generates no Task', () => {
    const { state: base, holdingId, houseId, polityId } = setupBaseWorld()
    let state = vacateHoldingBailiff(base, holdingId)
    const bailiffPersonId = 'pe-bailiff' as PersonId
    state = withPerson(state, bailiffPersonId, {
      houseId,
      age: 25,
      wealth: 0,
      kind: 'normal',
      alive: false,
    })
    state = appointHoldingBailiff(state, {
      holdingId,
      holderPersonId: bailiffPersonId,
      appointingPolityId: polityId,
      week: state.absoluteWeek,
    }).state

    const result = runBailiffRevenueTaskSystem(makeCtx(state))
    const tasks = getTasksByKind(result.state, 'collect_holding_revenue')
    expect(tasks.length).toBe(0)
  })
})
