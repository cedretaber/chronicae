import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { Task, TaskKind } from '../types/task'
import { targetRefKey } from '../types/task'
import type { DecisionSubjectRef } from '../types/goal'
import type {
  ProjectKind,
  ProjectStageKey,
  LandClaimProject,
  ContractRevisionProject,
  RespondToPressureProject,
} from '../types/project'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import { TERMINAL_DIPLOMATIC_PLAY_STATUSES } from '../types/diplomaticPlay'
import type { OrganizationRef } from '../types/office'
import type { DiplomaticPlayId, PersonId, TaskId } from '../types/ids'
import { createTaskId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import {
  getTaskActionCost,
  getTaskEffortRequired,
  getTaskDefaultDifficulty,
  getTaskDefaultRelevantAbility,
  PROJECT_KIND_ABILITY_MAP,
  selectDiplomaticTaskKind,
  getDiplomaticPlayDelegate,
  getConspiracyTaskOverride,
} from '../selectors/taskSelectors'
import { getProjectStageType } from '../config/projectStageSequences'
import { isDiplomaticProjectKind } from '../mutations/projectMutations'
import { addTaskToIndicesMut } from '../mutations/taskMutations'
import { isLivingPerson } from '../types/person'

const TERMINAL_PLAY_SET = new Set(TERMINAL_DIPLOMATIC_PLAY_STATUSES)

const PREPARATORY_TASK_KIND_MAP: Record<string, TaskKind> = {
  'acquire_land:prepare_claim': 'gather_claim_evidence',
  'sell_land:prepare_offer': 'prepare_argument',
  'improve_contract_terms:prepare_argument': 'prepare_argument',
  'demand_tax_increase:prepare_argument': 'prepare_argument',
  'respond_to_pressure:prepare_response': 'prepare_argument',
  // v0.47 §3.6: petition 系 Project の preparatory stage は汎用 prepare_project / advance_project に
  //   落とす (未登録だと projectTaskGenerationSystem が task を生成せず stall するため明示登録が必須)。
  //   stage 前進は task kind ではなく stage type で駆動される (taskSystem の project 完了 routing)。
  'request_rank_promotion:prepare_petition': 'prepare_project',
  'request_rank_promotion:build_case': 'advance_project',
  'request_land_grant:prepare_petition': 'prepare_project',
  'request_land_grant:build_case': 'advance_project',
  'request_cadet_branch_title_transfer:secure_family_support': 'prepare_project',
  'request_cadet_branch_title_transfer:negotiate_title_share': 'advance_project',
  'republic_house_foundation:prepare_foundation': 'prepare_project',
  'consolidate_internal_contracts:review_internal_contracts': 'prepare_project',
  'consolidate_internal_contracts:negotiate_internal_terms': 'advance_project',
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
    diplomaticPlays: { ...ctx.state.diplomaticPlays },
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
    } else if (isDiplomaticProjectKind(project.kind)) {
      generateNegotiateTaskMut(
        ws,
        config,
        project as LandClaimProject | ContractRevisionProject | RespondToPressureProject,
        absoluteWeek,
      )
      continue
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
      // v0.44 §6.6: personal_training は鍛錬対象能力で task を解決する
      relevantAbility:
        project.kind === 'personal_training'
          ? project.trainingAbilityKey
          : PROJECT_KIND_ABILITY_MAP[project.kind],
    }

    // v0.51 陰謀リファイン: 陰謀 Project の advance_project は重い effort・高 difficulty に上書き。
    const conspiracyOverride = getConspiracyTaskOverride(ws, config, project)
    if (conspiracyOverride) {
      task.effortRequired = conspiracyOverride.effortRequired
      task.difficulty = conspiracyOverride.difficulty
    }

    addTaskToIndicesMut(ws, task)
    ws.nextTaskId++
  }

  generateRevoltNegotiateTasksMut(ws, config, absoluteWeek)

  return {
    ...ctx,
    state: ws,
  }
}

function actorRefsEqual(a: DecisionSubjectRef, b: OrganizationRef): boolean {
  return a.kind === b.kind && (a.id as string) === (b.id as string)
}

function generateNegotiateTaskMut(
  ws: WorldState,
  config: SimulationConfig,
  project: LandClaimProject | ContractRevisionProject | RespondToPressureProject,
  absoluteWeek: number,
): void {
  const playId = project.diplomaticPlayId
  if (!playId) return

  const play = ws.diplomaticPlays[playId]
  if (!play) return
  if (TERMINAL_PLAY_SET.has(play.status as (typeof TERMINAL_DIPLOMATIC_PLAY_STATUSES)[number]))
    return

  const side: 'initiator' | 'target' = actorRefsEqual(project.owner, play.initiator)
    ? 'initiator'
    : 'target'

  const activeTaskIds =
    side === 'initiator' ? play.initiatorActiveTaskIds : play.targetActiveTaskIds
  if (activeTaskIds.length >= config.diplomaticPlayMaxActiveTasksPerSide) return

  let delegateId =
    side === 'initiator' ? play.initiatorDelegatePersonId : play.targetDelegatePersonId
  if (!delegateId || !isValidDelegate(ws, delegateId)) {
    const actor = side === 'initiator' ? play.initiator : play.target
    delegateId = getDiplomaticPlayDelegate(ws, actor)
    if (!delegateId) return
    const updatedPlay: DiplomaticPlay = { ...play }
    if (side === 'initiator') {
      updatedPlay.initiatorDelegatePersonId = delegateId
    } else {
      updatedPlay.targetDelegatePersonId = delegateId
    }
    ws.diplomaticPlays[playId] = updatedPlay
  }

  const stance = project.kind === 'respond_to_pressure' ? project.stance : undefined
  const taskKind = selectDiplomaticTaskKind(ws, config, play, side, stance)

  const taskId: TaskId = createTaskId(ws.nextTaskId)
  const actor = side === 'initiator' ? play.initiator : play.target
  const owner: DecisionSubjectRef =
    actor.kind === 'polity' ? { kind: 'polity', id: actor.id } : { kind: 'house', id: actor.id }

  const task: Task = {
    id: taskId,
    owner,
    assigneePersonId: delegateId,
    kind: taskKind,
    targetRef: { kind: 'diplomatic_play', id: play.id },
    priority: 1,
    actionCost: getTaskActionCost(config, taskKind),
    effortRequired: getTaskEffortRequired(config, taskKind),
    effortDone: 0,
    createdWeek: absoluteWeek,
    deadlineWeek: play.deadlineWeek,
    status: 'active',
    reasonIds: [],
    difficulty: getTaskDefaultDifficulty(taskKind),
    relevantAbility: getTaskDefaultRelevantAbility(taskKind),
  }

  addTaskToIndicesMut(ws, task)
  ws.nextTaskId++

  const updatedPlay: DiplomaticPlay = {
    ...ws.diplomaticPlays[playId]!,
    ...(side === 'initiator'
      ? { initiatorActiveTaskIds: [...ws.diplomaticPlays[playId]!.initiatorActiveTaskIds, taskId] }
      : { targetActiveTaskIds: [...ws.diplomaticPlays[playId]!.targetActiveTaskIds, taskId] }),
  }
  ws.diplomaticPlays[playId] = updatedPlay
}

function isValidDelegate(ws: WorldState, personId: PersonId): boolean {
  return isLivingPerson(ws.persons[personId])
}

function generateRevoltNegotiateTasksMut(
  ws: WorldState,
  config: SimulationConfig,
  absoluteWeek: number,
): void {
  for (const [playIdStr, play] of Object.entries(ws.diplomaticPlays)) {
    if (!play || play.kind !== 'revolt_negotiation' || play.status !== 'active') continue
    const playId = playIdStr as DiplomaticPlayId

    for (const side of ['initiator', 'target'] as const) {
      const currentPlay = ws.diplomaticPlays[playId]
      if (!currentPlay || currentPlay.status !== 'active') break

      const activeTaskIds =
        side === 'initiator' ? currentPlay.initiatorActiveTaskIds : currentPlay.targetActiveTaskIds
      if (activeTaskIds.length >= config.diplomaticPlayMaxActiveTasksPerSide) continue

      let delegateId =
        side === 'initiator'
          ? currentPlay.initiatorDelegatePersonId
          : currentPlay.targetDelegatePersonId
      if (!delegateId || !isValidDelegate(ws, delegateId)) {
        const actor = side === 'initiator' ? currentPlay.initiator : currentPlay.target
        delegateId = getDiplomaticPlayDelegate(ws, actor)
        if (!delegateId) continue
        const updatedPlay: DiplomaticPlay = { ...currentPlay }
        if (side === 'initiator') {
          updatedPlay.initiatorDelegatePersonId = delegateId
        } else {
          updatedPlay.targetDelegatePersonId = delegateId
        }
        ws.diplomaticPlays[playId] = updatedPlay
      }

      const taskKind = selectDiplomaticTaskKind(ws, config, currentPlay, side)

      const taskId: TaskId = createTaskId(ws.nextTaskId)
      const actor = side === 'initiator' ? currentPlay.initiator : currentPlay.target
      const owner: DecisionSubjectRef =
        actor.kind === 'polity' ? { kind: 'polity', id: actor.id } : { kind: 'house', id: actor.id }

      const task: Task = {
        id: taskId,
        owner,
        assigneePersonId: delegateId,
        kind: taskKind,
        targetRef: { kind: 'diplomatic_play', id: playId },
        priority: 1,
        actionCost: getTaskActionCost(config, taskKind),
        effortRequired: getTaskEffortRequired(config, taskKind),
        effortDone: 0,
        createdWeek: absoluteWeek,
        deadlineWeek: currentPlay.deadlineWeek,
        status: 'active',
        reasonIds: [],
        difficulty: getTaskDefaultDifficulty(taskKind),
        relevantAbility: getTaskDefaultRelevantAbility(taskKind),
      }

      addTaskToIndicesMut(ws, task)
      ws.nextTaskId++

      const refreshedPlay = ws.diplomaticPlays[playId]!
      ws.diplomaticPlays[playId] = {
        ...refreshedPlay,
        ...(side === 'initiator'
          ? { initiatorActiveTaskIds: [...refreshedPlay.initiatorActiveTaskIds, taskId] }
          : { targetActiveTaskIds: [...refreshedPlay.targetActiveTaskIds, taskId] }),
      }
    }
  }
}
