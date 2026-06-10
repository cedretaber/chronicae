import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { Task, PersonActivityLog } from '../types/task'
import type { HoldingOfficeAssignmentId, PersonId } from '../types/ids'
import { createTaskId, createPersonActivityLogId } from '../types/ids'
import { targetRefKey } from '../types/task'
import { isPlaceholderPerson } from '../selectors/landContractSelectors'
import type { SimulationConfig } from '../config/defaultConfig'
import { getTaskDefaultDifficulty, getTaskDefaultRelevantAbility } from '../selectors/taskSelectors'
import { addTaskToIndicesMut, removeTaskFromIndicesMut } from '../mutations/taskMutations'
import { createLogger } from '../debug/logger'

const BAILIFF_REVENUE_EFFORT_MULTIPLIER = 1.5

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

  const personKey = personId as string
  // perf (v0.47): 当人バケットだけ copy-on-write (PAL 2 層構造)。
  ws.personActivityLogs[personKey] = { ...(ws.personActivityLogs[personKey] ?? {}), [logId]: log }
  ws.personActivityLogIndex.byPerson[personKey] = [
    ...(ws.personActivityLogIndex.byPerson[personKey] ?? []),
    logId,
  ]
}

function createRevenueTaskMut(
  ws: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
  personId: PersonId,
): void {
  const taskId = createTaskId(ws.nextTaskId)
  ws.nextTaskId++

  const taskKind = 'collect_holding_revenue' as const
  const task: Task = {
    id: taskId,
    owner: { kind: 'person', id: personId },
    assigneePersonId: personId,
    kind: taskKind,
    targetRef: { kind: 'holding_office_assignment', id: assignmentId },
    priority: 1,
    actionCost: config.taskActionCostLight,
    effortRequired: Math.ceil(config.taskEffortRequiredLight * BAILIFF_REVENUE_EFFORT_MULTIPLIER),
    effortDone: 0,
    createdWeek: ws.absoluteWeek,
    deadlineWeek: ws.absoluteWeek + 4,
    status: 'active',
    reasonIds: [],
    difficulty: getTaskDefaultDifficulty(taskKind),
    relevantAbility: getTaskDefaultRelevantAbility(taskKind),
  }

  addTaskToIndicesMut(ws, task)
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
        removeTaskFromIndicesMut(ws, task.id)
        expired++
      }
    }

    createRevenueTaskMut(ws, ctx.config, assignmentId, personId)
    generated++
  }

  if (ctx.config.debug) {
    log.log('BAILIFF_TASK', { generated, expired, week: ws.absoluteWeek })
  }

  return { ...ctx, state: ws }
}
