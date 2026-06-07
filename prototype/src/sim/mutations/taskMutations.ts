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

  // v0.44 §6.5: improve_ability の直接 Task 生成は廃止 (personal_training Project 経由)。
  // getInitialTaskKind は improve_ability に undefined を返すため、ここで自然に弾かれる。
  const taskKind = getInitialTaskKind(aim.kind as PersonAimKind)

  if (!taskKind) return undefined

  return createTask(state, config, {
    owner: aim.owner,
    assigneePersonId: personId,
    kind: taskKind,
    targetRef: { kind: 'aim', id: aim.id },
    absoluteWeek,
  })
}

// 死亡した person に assign された active Task の即時 cascade。
// Task の通常回収は taskSystem (毎週) だが、tick 順で taskSystem より後に走る
// system からの死亡 (例: revolt 鎮圧での指導者処刑) が年末 tick で起きると、
// 同 tick の integrity (「Task assignee is dead」) に先に捕まる。
// taskSystem の cancel と同じ整合面を守る: task 削除 (removeTaskFromIndicesMut) +
// DiplomaticPlay の activeTaskIds 参照解除 + owner Aim の activeTaskId 解除。
// TASK_CANCELLED イベントは省略 (taskSystem 経路のみ。死亡サイトでは PERSON_DIED が主)。
export function cancelTasksOfDeadAssignee(state: WorldState, personId: PersonId): WorldState {
  const taskIds = [...(state.taskIndex.byAssignee[personId as string] ?? [])]
  if (taskIds.length === 0) return state

  const ws: WorldState = {
    ...state,
    tasks: { ...state.tasks },
    taskIndex: {
      byAssignee: { ...state.taskIndex.byAssignee },
      byOwner: { ...state.taskIndex.byOwner },
      byTarget: { ...state.taskIndex.byTarget },
    },
    aims: { ...state.aims },
    diplomaticPlays: { ...state.diplomaticPlays },
  }

  for (const tid of taskIds.sort()) {
    const task = ws.tasks[tid]
    if (!task || task.status !== 'active') continue

    // owner Aim の activeTaskId を解除 (taskSystem の cancel と同じ)
    const ownerKey = decisionSubjectKey(task.owner)
    for (const aid of ws.aimIndex.byOwner[ownerKey] ?? []) {
      const aim = ws.aims[aid]
      if (aim && aim.activeTaskId === tid) {
        ws.aims[aid] = { ...aim, activeTaskId: undefined } as unknown as Aim
        break
      }
    }

    removeTaskFromIndicesMut(ws, tid)

    // DiplomaticPlay の activeTaskIds 参照を解除 (§10 integrity)
    if (task.targetRef.kind === 'diplomatic_play') {
      const play = ws.diplomaticPlays[task.targetRef.id]
      if (play) {
        ws.diplomaticPlays[task.targetRef.id] = {
          ...play,
          initiatorActiveTaskIds: play.initiatorActiveTaskIds.filter(
            (id) => (id as string) !== (tid as string),
          ),
          targetActiveTaskIds: play.targetActiveTaskIds.filter(
            (id) => (id as string) !== (tid as string),
          ),
        }
      }
    }
  }
  return ws
}
