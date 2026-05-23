import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { Task, PersonActivityLog } from '../types/task'
import type { HoldingOfficeAssignmentId, PersonId } from '../types/ids'
import { createTaskId, createPersonActivityLogId } from '../types/ids'
import { targetRefKey } from '../types/task'
import { decisionSubjectKey } from '../types/goal'
import { isPlaceholderPerson } from '../selectors/landContractSelectors'
import { createLogger } from '../debug/logger'

function removeTaskFromIndicesMut(ws: WorldState, task: Task): void {
  const ownerKey = decisionSubjectKey(task.owner)
  const tKey = targetRefKey(task.targetRef)
  const assigneeKey = task.assigneePersonId as string

  delete ws.tasks[task.id]

  const byAssignee = ws.taskIndex.byAssignee[assigneeKey]
  if (byAssignee) {
    const filtered = byAssignee.filter((id) => (id as string) !== (task.id as string))
    if (filtered.length > 0) ws.taskIndex.byAssignee[assigneeKey] = filtered
    else delete ws.taskIndex.byAssignee[assigneeKey]
  }
  const byOwner = ws.taskIndex.byOwner[ownerKey]
  if (byOwner) {
    const filtered = byOwner.filter((id) => (id as string) !== (task.id as string))
    if (filtered.length > 0) ws.taskIndex.byOwner[ownerKey] = filtered
    else delete ws.taskIndex.byOwner[ownerKey]
  }
  const byTarget = ws.taskIndex.byTarget[tKey]
  if (byTarget) {
    const filtered = byTarget.filter((id) => (id as string) !== (task.id as string))
    if (filtered.length > 0) ws.taskIndex.byTarget[tKey] = filtered
    else delete ws.taskIndex.byTarget[tKey]
  }
}

function createExpiredActivityLogMut(ws: WorldState, personId: PersonId, task: Task): void {
  const logId = createPersonActivityLogId(ws.nextPersonActivityLogId)
  ws.nextPersonActivityLogId++

  const log: PersonActivityLog = {
    id: logId,
    personId,
    week: ws.absoluteWeek,
    kind: 'task_expired',
    outcome: 'failure',
    taskKind: task.kind,
    sourceRef: task.targetRef,
    relatedRefs: [],
    summaryKey: `activity.${task.kind}`,
    importance: 10,
  }

  ws.personActivityLogs[logId] = log
  const personKey = personId as string
  ws.personActivityLogIndex.byPerson[personKey] = [
    ...(ws.personActivityLogIndex.byPerson[personKey] ?? []),
    logId,
  ]
}

function createRevenueTaskMut(
  ws: WorldState,
  assignmentId: HoldingOfficeAssignmentId,
  personId: PersonId,
): void {
  const taskId = createTaskId(ws.nextTaskId)
  ws.nextTaskId++

  const task: Task = {
    id: taskId,
    owner: { kind: 'person', id: personId },
    assigneePersonId: personId,
    kind: 'collect_holding_revenue',
    targetRef: { kind: 'holding_office_assignment', id: assignmentId },
    priority: 1,
    actionCost: 1,
    effortRequired: 1,
    effortDone: 0,
    createdWeek: ws.absoluteWeek,
    deadlineWeek: ws.absoluteWeek + 4,
    status: 'active',
    reasonIds: [],
  }

  ws.tasks[taskId] = task

  const assigneeKey = personId as string
  const ownerKey = decisionSubjectKey(task.owner)
  const tKey = targetRefKey(task.targetRef)

  ws.taskIndex.byAssignee[assigneeKey] = [...(ws.taskIndex.byAssignee[assigneeKey] ?? []), taskId]
  ws.taskIndex.byOwner[ownerKey] = [...(ws.taskIndex.byOwner[ownerKey] ?? []), taskId]
  ws.taskIndex.byTarget[tKey] = [...(ws.taskIndex.byTarget[tKey] ?? []), taskId]
}

export function runBailiffRevenueTaskSystem(ctx: TickContext): TickContext {
  const log = createLogger(ctx.config.debug)

  const ws: WorldState = {
    ...ctx.state,
    tasks: { ...ctx.state.tasks },
    taskIndex: {
      byAssignee: { ...ctx.state.taskIndex.byAssignee },
      byOwner: { ...ctx.state.taskIndex.byOwner },
      byTarget: { ...ctx.state.taskIndex.byTarget },
    },
    personActivityLogs: { ...ctx.state.personActivityLogs },
    personActivityLogIndex: {
      byPerson: { ...ctx.state.personActivityLogIndex.byPerson },
    },
  }

  let generated = 0
  let expired = 0

  for (const assignmentId of Object.keys(
    ws.holdingOfficeAssignments,
  ).sort() as HoldingOfficeAssignmentId[]) {
    const assignment = ws.holdingOfficeAssignments[assignmentId]
    if (!assignment || !assignment.active) continue

    const personId = assignment.holderPersonId
    if (isPlaceholderPerson(ws, personId)) continue

    const person = ws.persons[personId]
    if (!person || !person.alive) continue

    const tKey = targetRefKey({ kind: 'holding_office_assignment', id: assignmentId })
    const existingTaskIds = ws.taskIndex.byTarget[tKey]
    if (existingTaskIds) {
      for (const taskId of [...existingTaskIds]) {
        const task = ws.tasks[taskId]
        if (!task || task.status !== 'active') continue
        if (task.kind !== 'collect_holding_revenue') continue
        createExpiredActivityLogMut(ws, personId, task)
        removeTaskFromIndicesMut(ws, task)
        expired++
      }
    }

    createRevenueTaskMut(ws, assignmentId, personId)
    generated++
  }

  if (ctx.config.debug) {
    log.log('BAILIFF_TASK', { generated, expired, week: ws.absoluteWeek })
  }

  return { ...ctx, state: ws }
}
