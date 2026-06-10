import type { TickContext } from './context'
import type { CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import { isLifeStageAtLeast } from '../types/person'
import type { Aim, DecisionSubjectRef, DecisionReason, PersonAimKind, Goal } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { AimId, DecisionReasonId, PersonId, EventId, TaskId } from '../types/ids'
import { createAimId, createDecisionReasonId, createTaskId } from '../types/ids'
import type { Task, TaskKind } from '../types/task'
import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import { getActivePersonGoal } from '../selectors/personGoalSelectors'
import { pickPersonAim } from '../selectors/personAimSelectors'

// active polity office を持つか (無家人物の aim 形成資格・goal 形成資格と一致)。
function hasActivePolityOfficeForAim(state: WorldState, personId: PersonId): boolean {
  for (const oaId of state.officeIndex.byHolderPerson[personId as string] ?? []) {
    const oa = state.officeAssignments[oaId]
    if (oa && oa.active && oa.organization.kind === 'polity') return true
  }
  return false
}
import {
  getInitialTaskKind,
  getTaskActionCost,
  getTaskEffortRequired,
  getTaskDefaultDifficulty,
  getTaskDefaultRelevantAbility,
} from '../selectors/taskSelectors'
import { addTaskToIndicesMut } from '../mutations/taskMutations'
import type { SimulationConfig } from '../config/defaultConfig'

export function runPersonAimMaintenanceSystem(ctx: TickContext): TickContext {
  const absoluteWeek = ctx.state.absoluteWeek

  if (absoluteWeek % 4 !== 0) return ctx

  // --- Mutable draft: shallow clone only records we'll mutate ---
  const ws: WorldState = {
    ...ctx.state,
    aims: { ...ctx.state.aims },
    decisionReasons: { ...ctx.state.decisionReasons },
    aimIndex: {
      byOwner: { ...ctx.state.aimIndex.byOwner },
      byGoal: { ...ctx.state.aimIndex.byGoal },
    },
    tasks: { ...ctx.state.tasks },
    taskIndex: {
      byAssignee: { ...ctx.state.taskIndex.byAssignee },
      byOwner: { ...ctx.state.taskIndex.byOwner },
      byTarget: { ...ctx.state.taskIndex.byTarget },
    },
  }

  // --- Event accumulator ---
  const newEvents: SimEvent[] = []
  let nextEventIndex = ctx.nextEventIndex

  function emitEvent(input: CreateSimEventInput): void {
    const id = `e-${ws.absoluteWeek}-${nextEventIndex}` as EventId
    nextEventIndex++
    newEvents.push({
      id,
      year: ws.currentYear,
      weekOfYear: ws.currentWeekOfYear,
      type: input.type,
      importance: input.importance,
      messageKey: input.messageKey,
      messageParams: input.messageParams,
      entityRefs: input.entityRefs ?? [],
      reasons: input.reasons ?? [],
      effects: input.effects ?? [],
    })
  }

  // --- RNG tracking ---
  let rng = ctx.rng

  // --- Phase 1: Create aims for persons without active aim ---
  for (const personId of ws.livingPersonIds) {
    const person = ws.persons[personId]
    if (!person) continue
    if (person.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(person.lifeStage, 'young_adulthood')) continue
    // v0.47 §9.3/§13: 有家人物に加え active polity office を持つ無家人物も aim を形成できる
    //   (personGoalMaintenanceSystem の goal 形成資格と一致させる)。
    if (!person.houseId) {
      if (!hasActivePolityOfficeForAim(ws, personId)) continue
    } else {
      const house = ws.houses[person.houseId]
      if (!house || !house.active) continue
    }

    const goal = getActivePersonGoal(ws, person.id)
    if (!goal) continue

    const ownerKey = decisionSubjectKey({ kind: 'person', id: person.id })
    const aimIds = ws.aimIndex.byOwner[ownerKey]
    let hasActiveAim = false
    if (aimIds) {
      for (const aid of aimIds) {
        const aim = ws.aims[aid]
        if (aim && aim.status === 'active') {
          hasActiveAim = true
          break
        }
      }
    }

    if (!hasActiveAim) {
      rng = createPersonAimMut(ws, ctx.config, person.id, goal, absoluteWeek, rng, emitEvent)
    }
  }

  // --- Phase 2: Check deadline/validity of existing Person Aims ---
  checkPersonAimDeadlinesMut(ws, emitEvent)

  // --- Exit: single immutable construction ---
  return {
    ...ctx,
    state: ws,
    rng,
    events: [...ctx.events, ...newEvents],
    nextEventIndex,
  }
}

// --- Pure helpers (unchanged) ---

function getAimDeadlineWeeks(config: SimulationConfig, kind: PersonAimKind): number {
  if (kind === 'obtain_office') return config.personAimDeadlineObtainOffice
  if (kind === 'retain_office') return config.personAimDeadlineRetainOffice
  return config.personAimDeadlineDefault
}

function getAimTargetProgress(kind: PersonAimKind): number {
  if (kind === 'obtain_office') return 2
  return 3
}

// --- Mutable task creation (inlined from taskSelectors.createInitialTaskForAim + createTask) ---

function createInitialTaskForAimMut(
  ws: WorldState,
  config: SimulationConfig,
  aim: Aim,
  absoluteWeek: number,
): Task | undefined {
  const personId = aim.owner.kind === 'person' ? aim.owner.id : undefined
  if (!personId) return undefined

  // v0.44 §6.5: improve_ability の直接 Task 生成分岐は撤去 (personal_training Project 経由)。
  // taskKind undefined → activeTaskId を持たず、projectPreparationSystem が拾う。
  const taskKind: TaskKind | undefined = getInitialTaskKind(aim.kind as PersonAimKind)
  if (!taskKind) return undefined

  const taskId: TaskId = createTaskId(ws.nextTaskId)
  const task: Task = {
    id: taskId,
    owner: aim.owner,
    assigneePersonId: personId,
    kind: taskKind,
    targetRef: { kind: 'aim', id: aim.id },
    priority: 1,
    actionCost: getTaskActionCost(config, taskKind),
    effortRequired: getTaskEffortRequired(config, taskKind),
    effortDone: 0,
    createdWeek: absoluteWeek,
    status: 'active',
    reasonIds: [],
    difficulty: getTaskDefaultDifficulty(taskKind),
    relevantAbility: getTaskDefaultRelevantAbility(taskKind),
  }

  addTaskToIndicesMut(ws, task)
  ws.nextTaskId++

  return task
}

// --- Mutable aim creation ---

function createPersonAimMut(
  ws: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  goal: Goal,
  absoluteWeek: number,
  rng: RngState,
  emitEvent: (input: CreateSimEventInput) => void,
): RngState {
  const result = pickPersonAim(ws, config, personId, goal, rng)
  if (!result) return rng

  const { kind, target, rng: nextRng } = result
  const owner: DecisionSubjectRef = { kind: 'person', id: personId }

  const reasonId: DecisionReasonId = createDecisionReasonId(ws.nextDecisionReasonId)
  const reason: DecisionReason = {
    id: reasonId,
    owner,
    summaryKey: `decision.reason.aim.${kind}`,
    weight: 1,
    createdWeek: absoluteWeek,
  }
  ws.decisionReasons[reasonId] = reason
  ws.nextDecisionReasonId++

  const aimId: AimId = createAimId(ws.nextAimId)
  const deadlineWeeks = getAimDeadlineWeeks(config, kind)
  const targetProgress = getAimTargetProgress(kind)

  let deadlineWeek = absoluteWeek + deadlineWeeks
  if (kind === 'support_organization_aim' && target?.kind === 'aim') {
    const targetAim = ws.aims[target.id]
    if (targetAim) {
      deadlineWeek = Math.min(deadlineWeek, targetAim.deadlineWeek)
    }
  }

  const aim: Aim = {
    id: aimId,
    owner,
    goalId: goal.id,
    origin: 'goal_driven',
    kind,
    priority: 1,
    progress: 0,
    targetProgress,
    createdWeek: absoluteWeek,
    deadlineWeek,
    successfulProjectCount: 0,
    failedProjectCount: 0,
    status: 'active',
    reasonIds: [reasonId],
    ...(target !== undefined ? { target } : {}),
  }

  ws.aims[aimId] = aim
  ws.aimIndex.byOwner[decisionSubjectKey(owner)] = [
    ...(ws.aimIndex.byOwner[decisionSubjectKey(owner)] ?? []),
    aimId,
  ]
  ws.aimIndex.byGoal[goal.id as string] = [...(ws.aimIndex.byGoal[goal.id as string] ?? []), aimId]
  ws.nextAimId++

  const task = createInitialTaskForAimMut(ws, config, aim, absoluteWeek)
  if (task) {
    ws.aims[aimId] = { ...aim, activeTaskId: task.id }
  }

  const person = ws.persons[personId]
  const personNameKey = person?.nameKey ?? personId
  emitEvent({
    type: 'PERSON_AIM_CREATED',
    importance: 'minor',
    messageKey: 'person.aim.created',
    messageParams: {
      owner: nameParam('person', personNameKey),
      kind,
    },
    entityRefs: [entityRef('person', personId, 'owner', personNameKey)],
  })

  return nextRng
}

// --- Mutable deadline check ---

function checkPersonAimDeadlinesMut(
  ws: WorldState,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  const absoluteWeek = ws.absoluteWeek

  for (const [, aim] of Object.entries(ws.aims)) {
    if (!aim || aim.status !== 'active') continue
    if (aim.owner.kind !== 'person') continue

    // support_organization_aim: fail if target Aim is terminal
    if (aim.kind === 'support_organization_aim' && aim.target?.kind === 'aim') {
      const targetAim = ws.aims[aim.target.id]
      if (!targetAim || targetAim.status !== 'active') {
        const newStatus = targetAim?.status === 'succeeded' ? 'succeeded' : 'failed'
        ws.aims[aim.id] = { ...aim, status: newStatus }

        const person = ws.persons[aim.owner.id]
        const personNameKey = person?.nameKey ?? aim.owner.id
        const evType = newStatus === 'succeeded' ? 'PERSON_AIM_SUCCEEDED' : 'PERSON_AIM_FAILED'
        const evKey = newStatus === 'succeeded' ? 'person.aim.succeeded' : 'person.aim.failed'
        emitEvent({
          type: evType,
          importance: 'minor',
          messageKey: evKey,
          messageParams: {
            owner: nameParam('person', personNameKey),
            kind: aim.kind,
          },
          entityRefs: [entityRef('person', aim.owner.id, 'owner', personNameKey)],
        })
        continue
      }
    }

    if (absoluteWeek >= aim.deadlineWeek) {
      ws.aims[aim.id] = { ...aim, status: 'failed' }

      const person = ws.persons[aim.owner.id]
      const personNameKey = person?.nameKey ?? aim.owner.id
      emitEvent({
        type: 'PERSON_AIM_FAILED',
        importance: 'minor',
        messageKey: 'person.aim.failed',
        messageParams: {
          owner: nameParam('person', personNameKey),
          kind: aim.kind,
        },
        entityRefs: [entityRef('person', aim.owner.id, 'owner', personNameKey)],
      })
    }
  }
}
