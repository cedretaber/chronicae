import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { Task, TaskKind } from '../types/task'
import { targetRefKey } from '../types/task'
import { decisionSubjectKey } from '../types/goal'
import type { TaskId } from '../types/ids'
import { createTaskId } from '../types/ids'
import { getTaskActionCost, getTaskEffortRequired } from '../selectors/taskSelectors'

export function runProjectTaskGenerationSystem(ctx: TickContext): TickContext {
  const absoluteWeek = ctx.state.absoluteWeek
  const config = ctx.config

  const ws: WorldState = {
    ...ctx.state,
    tasks: { ...ctx.state.tasks },
    taskIndex: {
      byAssignee: { ...ctx.state.taskIndex.byAssignee },
      byOwner: { ...ctx.state.taskIndex.byOwner },
      byTarget: { ...ctx.state.taskIndex.byTarget },
    },
  }

  for (const [, project] of Object.entries(ws.projects)) {
    if (!project || project.status !== 'active') continue

    const supervisor = ws.persons[project.supervisorPersonId]
    if (!supervisor || !supervisor.alive || supervisor.kind === 'placeholder') continue

    const tKey = targetRefKey({ kind: 'project', id: project.id })
    const taskIds = ws.taskIndex.byTarget[tKey] ?? []
    let hasActiveAdvanceTask = false
    for (const tid of taskIds) {
      const t = ws.tasks[tid]
      if (t && t.status === 'active' && t.kind === 'advance_project') {
        hasActiveAdvanceTask = true
        break
      }
    }
    if (hasActiveAdvanceTask) continue

    const taskKind: TaskKind = 'advance_project'
    const taskId: TaskId = createTaskId(ws.nextTaskId)
    const task: Task = {
      id: taskId,
      owner: project.owner,
      assigneePersonId: project.supervisorPersonId,
      kind: taskKind,
      targetRef: { kind: 'project', id: project.id },
      priority: 1,
      actionCost: getTaskActionCost(config, taskKind),
      effortRequired: getTaskEffortRequired(config, taskKind),
      effortDone: 0,
      createdWeek: absoluteWeek,
      status: 'active',
      reasonIds: [],
    }

    const ownerKey = decisionSubjectKey(project.owner)
    const assigneeKey = project.supervisorPersonId as string

    ws.tasks[taskId] = task
    ws.taskIndex.byAssignee[assigneeKey] = [...(ws.taskIndex.byAssignee[assigneeKey] ?? []), taskId]
    ws.taskIndex.byOwner[ownerKey] = [...(ws.taskIndex.byOwner[ownerKey] ?? []), taskId]
    ws.taskIndex.byTarget[tKey] = [...(ws.taskIndex.byTarget[tKey] ?? []), taskId]
    ws.nextTaskId++
  }

  return {
    ...ctx,
    state: ws,
  }
}
