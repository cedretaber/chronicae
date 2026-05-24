import type { TickContext } from './context'
import type { Aim } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { WorldState } from '../types/world'
import type { Task, TaskKind } from '../types/task'
import { targetRefKey } from '../types/task'
import type { TaskId, PersonId } from '../types/ids'
import { createTaskId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import { selectProjectCreator } from '../selectors/projectSelectors'
import {
  getTaskActionCost,
  getTaskEffortRequired,
  getTaskDefaultDifficulty,
  PROJECT_KIND_ABILITY_MAP,
} from '../selectors/taskSelectors'
import { aimKindToProjectKind } from '../mutations/projectMutations'

export function runProjectPreparationSystem(ctx: TickContext): TickContext {
  const absoluteWeek = ctx.state.absoluteWeek
  const config = ctx.config

  const ws: WorldState = {
    ...ctx.state,
    aims: { ...ctx.state.aims },
    tasks: { ...ctx.state.tasks },
    taskIndex: {
      byAssignee: { ...ctx.state.taskIndex.byAssignee },
      byOwner: { ...ctx.state.taskIndex.byOwner },
      byTarget: { ...ctx.state.taskIndex.byTarget },
    },
  }

  for (const [, aim] of Object.entries(ws.aims)) {
    if (!aim || aim.status !== 'active') continue
    if (aim.origin !== 'goal_driven') continue
    if (aim.owner.kind === 'person') continue

    const projectKind = aimKindToProjectKind(aim.kind)
    if (!projectKind) continue

    const aimProjectIds = ws.projectIndex.byAim[aim.id as string] ?? []
    let hasActiveProject = false
    for (const pid of aimProjectIds) {
      const p = ctx.state.projects[pid]
      if (p && p.status === 'active') {
        hasActiveProject = true
        break
      }
    }
    if (hasActiveProject) continue

    if (aim.activeTaskId) continue
    if (aim.activeDiplomaticPlayId) continue

    if (aim.nextProjectAllowedWeek && absoluteWeek < aim.nextProjectAllowedWeek) continue

    const creatorId = selectProjectCreator(ws, config, aim)
    if (!creatorId) continue

    const task = createPrepareProjectTaskMut(ws, config, aim, creatorId, absoluteWeek)
    if (!task) continue

    ws.aims[aim.id] = {
      ...aim,
      activeTaskId: task.id,
      lastProjectPreparedWeek: absoluteWeek,
      nextProjectAllowedWeek: absoluteWeek + config.projectCooldownWeeks,
    }
  }

  return {
    ...ctx,
    state: ws,
  }
}

function createPrepareProjectTaskMut(
  ws: WorldState,
  config: SimulationConfig,
  aim: Aim,
  creatorId: PersonId,
  absoluteWeek: number,
): Task | undefined {
  const taskKind: TaskKind = 'prepare_project'
  const taskId: TaskId = createTaskId(ws.nextTaskId)
  const projectKind = aimKindToProjectKind(aim.kind)
  const task: Task = {
    id: taskId,
    owner: aim.owner,
    assigneePersonId: creatorId,
    kind: taskKind,
    targetRef: { kind: 'aim', id: aim.id },
    priority: aim.priority,
    actionCost: getTaskActionCost(config, taskKind),
    effortRequired: getTaskEffortRequired(config, taskKind),
    effortDone: 0,
    createdWeek: absoluteWeek,
    status: 'active',
    reasonIds: [],
    difficulty: getTaskDefaultDifficulty(taskKind),
    relevantAbility: projectKind ? PROJECT_KIND_ABILITY_MAP[projectKind] : 'insight',
  }

  const ownerKey = decisionSubjectKey(aim.owner)
  const tKey = targetRefKey({ kind: 'aim', id: aim.id })
  const assigneeKey = creatorId as string

  ws.tasks[taskId] = task
  ws.taskIndex.byAssignee[assigneeKey] = [...(ws.taskIndex.byAssignee[assigneeKey] ?? []), taskId]
  ws.taskIndex.byOwner[ownerKey] = [...(ws.taskIndex.byOwner[ownerKey] ?? []), taskId]
  ws.taskIndex.byTarget[tKey] = [...(ws.taskIndex.byTarget[tKey] ?? []), taskId]
  ws.nextTaskId++

  return task
}
