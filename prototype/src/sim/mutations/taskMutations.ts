import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { Task, TaskKind, TaskTargetRef } from '../types/task'
import { targetRefKey } from '../types/task'
import type { Aim, DecisionSubjectRef, PersonAimKind } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { PersonId, TaskId } from '../types/ids'
import { createTaskId } from '../types/ids'
import type { AbilityKey } from '../types/person'
import {
  getTaskActionCost,
  getTaskEffortRequired,
  getTaskDefaultDifficulty,
  getTaskDefaultRelevantAbility,
  getInitialTaskKind,
  getInitialTaskKindForAbilityTarget,
} from '../selectors/taskSelectors'

// =============================================================================
// task の add/remove + taskIndex (byAssignee/byOwner/byTarget) 同期の唯一の正規 API。
// 旧来は immutable 版が taskSelectors に、mutable 版が 5 つの tick system に散在していた
// (調査 §3.1)。挿入順 (append) は RNG 駆動の決定性に load-bearing なため厳守する。
// =============================================================================

// --- mutable: tick system 用 (draft WorldState を直接破壊更新) ---

/**
 * task を tasks マップと 3 つの index へ追加する (append)。nextTaskId のインクリメントは
 * 呼び出し側の責務 (taskId 採番タイミングが site ごとに異なるため)。
 */
export function addTaskToIndicesMut(ws: WorldState, task: Task): void {
  ws.tasks[task.id] = task
  const assigneeKey = task.assigneePersonId as string
  const ownerKey = decisionSubjectKey(task.owner)
  const targetKey = targetRefKey(task.targetRef)
  ws.taskIndex.byAssignee[assigneeKey] = [...(ws.taskIndex.byAssignee[assigneeKey] ?? []), task.id]
  ws.taskIndex.byOwner[ownerKey] = [...(ws.taskIndex.byOwner[ownerKey] ?? []), task.id]
  ws.taskIndex.byTarget[targetKey] = [...(ws.taskIndex.byTarget[targetKey] ?? []), task.id]
}

/**
 * task を tasks マップと 3 つの index から削除する。filter 後に空配列となった index
 * エントリは delete して state spread コストを抑える (taskIndex 空エントリ purge, §5.5)。
 */
export function removeTaskFromIndicesMut(ws: WorldState, taskId: TaskId): void {
  const task = ws.tasks[taskId]
  if (!task) return

  const ownerKey = decisionSubjectKey(task.owner)
  const targetKey = targetRefKey(task.targetRef)
  const assigneeKey = task.assigneePersonId as string

  delete ws.tasks[taskId]

  const byAssignee = ws.taskIndex.byAssignee[assigneeKey]
  if (byAssignee) {
    const filtered = byAssignee.filter((id) => (id as string) !== (taskId as string))
    if (filtered.length > 0) ws.taskIndex.byAssignee[assigneeKey] = filtered
    else delete ws.taskIndex.byAssignee[assigneeKey]
  }
  const byOwner = ws.taskIndex.byOwner[ownerKey]
  if (byOwner) {
    const filtered = byOwner.filter((id) => (id as string) !== (taskId as string))
    if (filtered.length > 0) ws.taskIndex.byOwner[ownerKey] = filtered
    else delete ws.taskIndex.byOwner[ownerKey]
  }
  const byTarget = ws.taskIndex.byTarget[targetKey]
  if (byTarget) {
    const filtered = byTarget.filter((id) => (id as string) !== (taskId as string))
    if (filtered.length > 0) ws.taskIndex.byTarget[targetKey] = filtered
    else delete ws.taskIndex.byTarget[targetKey]
  }
}

// --- immutable: worldgen / cleanup 用 (taskSelectors から移設, §3.1 レイヤー違反解消) ---

export function createTask(
  state: WorldState,
  config: SimulationConfig,
  input: {
    owner: DecisionSubjectRef
    assigneePersonId: PersonId
    kind: TaskKind
    targetRef: TaskTargetRef
    absoluteWeek: number
    deadlineWeek?: number
    difficulty?: number
    relevantAbility?: AbilityKey
  },
): { task: Task; state: WorldState } {
  const taskId = createTaskId(state.nextTaskId)
  const task: Task = {
    id: taskId,
    owner: input.owner,
    assigneePersonId: input.assigneePersonId,
    kind: input.kind,
    targetRef: input.targetRef,
    priority: 1,
    actionCost: getTaskActionCost(config, input.kind),
    effortRequired: getTaskEffortRequired(config, input.kind),
    effortDone: 0,
    createdWeek: input.absoluteWeek,
    ...(input.deadlineWeek !== undefined ? { deadlineWeek: input.deadlineWeek } : {}),
    status: 'active',
    reasonIds: [],
    difficulty: input.difficulty ?? getTaskDefaultDifficulty(input.kind),
    relevantAbility: input.relevantAbility ?? getTaskDefaultRelevantAbility(input.kind),
  }

  const ownerKey = decisionSubjectKey(input.owner)
  const targetKey = targetRefKey(input.targetRef)
  const assigneeKey = input.assigneePersonId as string

  const newState: WorldState = {
    ...state,
    tasks: { ...state.tasks, [taskId]: task },
    taskIndex: {
      byAssignee: {
        ...state.taskIndex.byAssignee,
        [assigneeKey]: [...(state.taskIndex.byAssignee[assigneeKey] ?? []), taskId],
      },
      byOwner: {
        ...state.taskIndex.byOwner,
        [ownerKey]: [...(state.taskIndex.byOwner[ownerKey] ?? []), taskId],
      },
      byTarget: {
        ...state.taskIndex.byTarget,
        [targetKey]: [...(state.taskIndex.byTarget[targetKey] ?? []), taskId],
      },
    },
    nextTaskId: state.nextTaskId + 1,
  }

  return { task, state: newState }
}

export function removeTask(state: WorldState, taskId: TaskId): WorldState {
  const task = state.tasks[taskId]
  if (!task) return state

  const ownerKey = decisionSubjectKey(task.owner)
  const targetKey = targetRefKey(task.targetRef)
  const assigneeKey = task.assigneePersonId as string

  const newTasks = { ...state.tasks }
  delete newTasks[taskId]

  return {
    ...state,
    tasks: newTasks,
    taskIndex: {
      byAssignee: {
        ...state.taskIndex.byAssignee,
        [assigneeKey]: (state.taskIndex.byAssignee[assigneeKey] ?? []).filter(
          (id) => (id as string) !== (taskId as string),
        ),
      },
      byOwner: {
        ...state.taskIndex.byOwner,
        [ownerKey]: (state.taskIndex.byOwner[ownerKey] ?? []).filter(
          (id) => (id as string) !== (taskId as string),
        ),
      },
      byTarget: {
        ...state.taskIndex.byTarget,
        [targetKey]: (state.taskIndex.byTarget[targetKey] ?? []).filter(
          (id) => (id as string) !== (taskId as string),
        ),
      },
    },
  }
}

export function createInitialTaskForAim(
  state: WorldState,
  config: SimulationConfig,
  aim: Aim,
  absoluteWeek: number,
): { task: Task; state: WorldState } | undefined {
  const personId = aim.owner.kind === 'person' ? aim.owner.id : undefined
  if (!personId) return undefined

  let taskKind = getInitialTaskKind(aim.kind as PersonAimKind)

  // For improve_ability, resolve from aim.target
  if (aim.kind === 'improve_ability' && !taskKind) {
    taskKind = getInitialTaskKindForAbilityTarget(aim.target)
  }

  if (!taskKind) return undefined

  return createTask(state, config, {
    owner: aim.owner,
    assigneePersonId: personId,
    kind: taskKind,
    targetRef: { kind: 'aim', id: aim.id },
    absoluteWeek,
  })
}
