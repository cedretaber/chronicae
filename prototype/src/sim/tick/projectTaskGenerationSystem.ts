import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { Task, TaskKind } from '../types/task'
import { targetRefKey } from '../types/task'
import { decisionSubjectKey } from '../types/goal'
import type { ProjectKind, ProjectStageKey } from '../types/project'
import type { TaskId } from '../types/ids'
import { createTaskId } from '../types/ids'
import {
  getTaskActionCost,
  getTaskEffortRequired,
  getTaskDefaultDifficulty,
  PROJECT_KIND_ABILITY_MAP,
} from '../selectors/taskSelectors'
import { getProjectStageType } from '../config/projectStageSequences'

const PREPARATORY_TASK_KIND_MAP: Record<string, TaskKind> = {
  'acquire_land:prepare_claim': 'gather_claim_evidence',
  'sell_land:prepare_offer': 'prepare_argument',
  'improve_contract_terms:prepare_argument': 'prepare_argument',
  'demand_tax_increase:prepare_argument': 'prepare_argument',
  'respond_to_pressure:prepare_response': 'prepare_argument',
}

function getPreparatoryTaskKind(
  kind: ProjectKind,
  stageKey: ProjectStageKey,
): TaskKind | undefined {
  return PREPARATORY_TASK_KIND_MAP[`${kind}:${stageKey}`]
}

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

    const stageType = getProjectStageType(project.kind, project.currentStageKey)
    if (stageType === 'immediate' || !stageType) continue

    if (project.deadlineWeek != null && absoluteWeek > project.deadlineWeek) continue

    const supervisor = ws.persons[project.supervisorPersonId]
    if (!supervisor || !supervisor.alive || supervisor.kind === 'placeholder') continue

    const tKey = targetRefKey({ kind: 'project', id: project.id })
    const taskIds = ws.taskIndex.byTarget[tKey] ?? []

    let taskKind: TaskKind
    if (stageType === 'preparatory') {
      const prepKind = getPreparatoryTaskKind(project.kind, project.currentStageKey)
      if (!prepKind) continue
      taskKind = prepKind

      let hasActivePrepTask = false
      for (const tid of taskIds) {
        const t = ws.tasks[tid]
        if (t && t.status === 'active' && t.kind === taskKind) {
          hasActivePrepTask = true
          break
        }
      }
      if (hasActivePrepTask) continue
    } else {
      taskKind = 'advance_project'

      let hasActiveAdvanceTask = false
      for (const tid of taskIds) {
        const t = ws.tasks[tid]
        if (t && t.status === 'active' && t.kind === 'advance_project') {
          hasActiveAdvanceTask = true
          break
        }
      }
      if (hasActiveAdvanceTask) continue
    }

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
      difficulty: getTaskDefaultDifficulty(taskKind),
      relevantAbility: PROJECT_KIND_ABILITY_MAP[project.kind],
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
