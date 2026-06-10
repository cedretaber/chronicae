import type { TickContext } from './context'
import type { Aim } from '../types/goal'
import type { WorldState } from '../types/world'
import type { Task, TaskKind } from '../types/task'
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
import { addTaskToIndicesMut } from '../mutations/taskMutations'
import type { AimKind } from '../types/goal'

// v0.47 §4.1: person-owned aim から Project を生成できる aim kind の allowlist。
const PERSON_OWNED_PROJECT_ALLOWED_AIM_KINDS = new Set<AimKind>([
  'improve_ability',
  'request_land_grant',
  'establish_cadet_branch',
  'found_republic_house',
])

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
    // v0.44 §6.5 / v0.47 §4.1: person-owned aim の allowlist。improve_ability (→ personal_training) に
    //   加え、v0.47 の petition 系 (request_land_grant / establish_cadet_branch / found_republic_house)
    //   を許可する。全 person aim には開かない (それ以外は従来どおり Project 化しない)。
    if (aim.owner.kind === 'person' && !PERSON_OWNED_PROJECT_ALLOWED_AIM_KINDS.has(aim.kind))
      continue

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

    // v0.27 §15: concurrent limit — same holdingId can have only 1 active develop_holding
    if (projectKind === 'develop_holding') {
      const holdingId = aim.target?.kind === 'holding' ? aim.target.id : undefined
      if (holdingId) {
        const refKey = `holding:${holdingId}`
        const existingPids = ws.projectIndex.byRelatedEntity[refKey] ?? []
        const hasActiveDev = existingPids.some((pid) => {
          const p = ws.projects[pid]
          return p && p.kind === 'develop_holding' && p.status === 'active'
        })
        if (hasActiveDev) continue
      }
    }

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

  addTaskToIndicesMut(ws, task)
  ws.nextTaskId++

  return task
}
