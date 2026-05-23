import type { TickContext } from './context'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import type { Aim, PersonAimKind } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { Task, TaskOutcomeKind } from '../types/task'
import type { PersonActivityLog } from '../types/task'
import type { WorldState } from '../types/world'
import type { EntityRef } from '../types/goal'
import type { ActorIntent } from '../types/actorIntent'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import type { PersonId, DiplomaticPlayId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import type { AbilityKey } from '../types/person'
import type { AbilityTrainingExperience } from '../types/task'
import { clamp } from '../utils/math'
import { getPersonWeeklyActionCapacity, computeWeeklyEffort } from '../selectors/taskSelectors'
import { createNextTaskForAim } from '../selectors/taskSelectors'
import { removeTask } from '../selectors/taskSelectors'
import { checkEntityExists } from '../selectors/taskSelectors'
import { isEntityTerminal } from '../selectors/taskSelectors'

// --- isDecisionSubjectActive ---

function isDecisionSubjectActive(
  state: WorldState,
  owner: import('../types/goal').DecisionSubjectRef,
): boolean {
  if (owner.kind === 'polity') {
    return state.polities[owner.id]?.active === true
  }
  if (owner.kind === 'house') {
    const house = state.houses[owner.id]
    return house !== undefined && house.active && house.kind !== 'system'
  }
  if (owner.kind === 'person') {
    const person = state.persons[owner.id]
    return person !== undefined && person.alive && person.kind !== 'placeholder'
  }
  return false
}

// --- Auto-cancel tasks ---

function autoCancelTasks(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const state = currentCtx.state

  for (const [, task] of Object.entries(state.tasks)) {
    if (!task || task.status !== 'active') continue

    let shouldCancel = false
    let cancelReason: string | undefined

    // Check if assignee is dead or placeholder
    const assignee = state.persons[task.assigneePersonId]
    if (!assignee || !assignee.alive || assignee.kind === 'placeholder') {
      shouldCancel = true
      cancelReason = 'assignee_no_longer_available'
    }

    // Check if owner is inactive
    if (!shouldCancel && !isDecisionSubjectActive(state, task.owner)) {
      shouldCancel = true
      cancelReason = 'owner_inactive'
    }

    // Check if targetRef entity exists and is not terminal
    if (!shouldCancel && task.targetRef.kind === 'aim') {
      const targetRef: EntityRef = { kind: 'aim', id: task.targetRef.id }
      if (!checkEntityExists(state, targetRef)) {
        shouldCancel = true
        cancelReason = 'target_removed'
      } else if (isEntityTerminal(state, targetRef)) {
        shouldCancel = true
        cancelReason = 'target_terminal'
      }
    }

    // Check intent-targeted tasks
    if (!shouldCancel && task.targetRef.kind === 'intent') {
      const intent = state.actorIntents[task.targetRef.id]
      if (!intent) {
        shouldCancel = true
        cancelReason = 'target_removed'
      } else if (intent.status !== 'active') {
        shouldCancel = true
        cancelReason = 'target_terminal'
      }
    }

    // Check diplomatic_play-targeted tasks
    if (!shouldCancel && task.targetRef.kind === 'diplomatic_play') {
      const play = state.diplomaticPlays[task.targetRef.id]
      if (!play) {
        shouldCancel = true
        cancelReason = 'target_removed'
      } else if (play.status !== 'active' && play.status !== 'escalated') {
        shouldCancel = true
        cancelReason = 'target_terminal'
      }
    }

    if (shouldCancel) {
      const ownerKey = decisionSubjectKey(task.owner)
      const ownerAimIds = state.aimIndex.byOwner[ownerKey] ?? []
      let ownerAim: Aim | undefined

      // Find the aim that owns this task
      for (const aid of ownerAimIds) {
        const a = state.aims[aid]
        if (a && a.activeTaskId === task.id) {
          ownerAim = a
          break
        }
      }

      // Remove the task from state
      let newState = removeTask(state, task.id)

      // Clear intent.activeTaskId if this was an intent-targeted task
      if (task.targetRef.kind === 'intent') {
        const intent = newState.actorIntents[task.targetRef.id]
        if (intent && intent.activeTaskId === task.id) {
          const cleaned = Object.fromEntries(
            Object.entries(intent).filter(([k]) => k !== 'activeTaskId'),
          ) as ActorIntent
          newState = {
            ...newState,
            actorIntents: { ...newState.actorIntents, [intent.id]: cleaned },
          }
        }
      }

      // Clear play activeTaskIds if this was a diplomatic_play-targeted task
      if (task.targetRef.kind === 'diplomatic_play') {
        newState = removeDiplomaticPlayTaskId(newState, task.targetRef.id, task.id)
      }

      // Update the owning Aim if found
      if (ownerAim) {
        const aimId = ownerAim.id
        // support_organization_aim: fail immediately if target is gone/terminal
        const shouldFailAim =
          ownerAim.kind === 'support_organization_aim' &&
          (cancelReason === 'target_removed' || cancelReason === 'target_terminal')
        const updatedAim = {
          ...ownerAim,
          activeTaskId: undefined,
          ...(shouldFailAim
            ? { status: 'failed' as const }
            : cancelReason !== undefined
              ? { blockedReasonKey: cancelReason }
              : {}),
        } as unknown as Aim
        newState = {
          ...newState,
          aims: { ...newState.aims, [aimId]: updatedAim },
        }

        // Emit TASK_CANCELLED event
        const personId = ownerAim.owner.kind === 'person' ? ownerAim.owner.id : undefined
        if (personId) {
          const person = newState.persons[personId]
          const personNameKey = person?.nameKey ?? personId
          const { event, ctx: evCtx } = createSimEvent(currentCtx, {
            type: 'TASK_CANCELLED',
            importance: 'minor',
            messageKey: 'task.cancelled',
            messageParams: {
              person: nameParam('person', personNameKey),
              task: ownerAim.kind,
              reason: cancelReason ?? 'unknown',
            },
            entityRefs: [entityRef('person', personId, 'person', personNameKey)],
          })
          currentCtx = { ...evCtx, events: [...evCtx.events, event] }
        }
        currentCtx = { ...currentCtx, state: newState }
      }

      currentCtx = { ...currentCtx, state: newState }
    }
  }

  return currentCtx
}

// --- failOrphanedSupportAims ---

function failOrphanedSupportAims(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const [, aim] of Object.entries(currentCtx.state.aims)) {
    if (!aim || aim.status !== 'active') continue
    if (aim.kind !== 'support_organization_aim') continue
    if (!aim.target || aim.target.kind !== 'aim') continue

    const targetAim = currentCtx.state.aims[aim.target.id]
    if (targetAim && targetAim.status === 'active') continue

    const newStatus = targetAim?.status === 'succeeded' ? 'succeeded' : 'failed'
    const updatedAim: Aim = { ...aim, status: newStatus, activeTaskId: undefined } as unknown as Aim
    let newState = {
      ...currentCtx.state,
      aims: { ...currentCtx.state.aims, [aim.id]: updatedAim },
    }

    // Also remove any active task for this aim
    if (aim.activeTaskId) {
      const task = newState.tasks[aim.activeTaskId]
      if (task) {
        newState = removeTask(newState, aim.activeTaskId)
      }
    }

    if (aim.owner.kind === 'person') {
      const person = newState.persons[aim.owner.id]
      const personNameKey = person?.nameKey ?? aim.owner.id
      const evType = newStatus === 'succeeded' ? 'PERSON_AIM_SUCCEEDED' : 'PERSON_AIM_FAILED'
      const evKey = newStatus === 'succeeded' ? 'person.aim.succeeded' : 'person.aim.failed'
      const { event, ctx: evCtx } = createSimEvent(
        { ...currentCtx, state: newState },
        {
          type: evType,
          importance: 'minor',
          messageKey: evKey,
          messageParams: {
            owner: nameParam('person', personNameKey),
            kind: aim.kind,
          },
          entityRefs: [entityRef('person', aim.owner.id, 'owner', personNameKey)],
        },
      )
      currentCtx = { ...evCtx, state: newState, events: [...evCtx.events, event] }
    } else {
      currentCtx = { ...currentCtx, state: newState }
    }
  }

  return currentCtx
}

// --- getAbilityFromAimTarget ---

function getAbilityFromAimTarget(target: EntityRef | undefined): AbilityKey | undefined {
  if (!target || target.kind !== 'ability') return undefined
  return target.ability
}

// --- createActivityLogForTask ---

function createActivityLogForTask(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  task: Task,
  outcome: TaskOutcomeKind,
  absoluteWeek: number,
): WorldState {
  const logId = `al-${state.nextPersonActivityLogId}` as import('../types/ids').PersonActivityLogId
  const kind: import('../types/task').PersonActivityKind =
    outcome === 'success'
      ? 'task_completed'
      : outcome === 'failure'
        ? 'task_failed'
        : 'task_cancelled'

  const log: PersonActivityLog = {
    id: logId,
    personId,
    week: absoluteWeek,
    kind,
    outcome,
    taskKind: task.kind,
    sourceRef: task.targetRef,
    relatedRefs: [],
    summaryKey: `activity.${task.kind}`,
    importance: 10,
  }

  const personKey = personId as string
  const existingLogs = state.personActivityLogIndex.byPerson[personKey] ?? []

  const newLogs: Record<string, PersonActivityLog> = { ...state.personActivityLogs, [logId]: log }
  let newIndex = [...existingLogs, logId]

  // Enforce per-person limit
  if (newIndex.length > config.maxActivityLogsPerPerson) {
    const logsWithMeta = newIndex.map((id) => ({ id, log: newLogs[id] }))
    logsWithMeta.sort((a, b) => {
      if (!a.log || !b.log) return 0
      if (a.log.importance !== b.log.importance) return a.log.importance - b.log.importance
      return a.log.week - b.log.week
    })
    const toRemove = logsWithMeta.slice(0, newIndex.length - config.maxActivityLogsPerPerson)
    for (const r of toRemove) {
      delete newLogs[r.id]
    }
    newIndex = newIndex.filter((id) => newLogs[id] !== undefined)
  }

  return {
    ...state,
    personActivityLogs: newLogs,
    personActivityLogIndex: {
      ...state.personActivityLogIndex,
      byPerson: {
        ...state.personActivityLogIndex.byPerson,
        [personKey]: newIndex,
      },
    },
    nextPersonActivityLogId: state.nextPersonActivityLogId + 1,
  }
}

// --- Handle completion of a single task ---

function handleTaskCompletion(
  ctx: TickContext,
  originalTask: Task,
  personId: PersonId,
  absoluteWeek: number,
): TickContext {
  let currentCtx = ctx
  const config = currentCtx.config
  const outcome: TaskOutcomeKind = 'success'

  {
    const task = originalTask
    let newState = currentCtx.state

    // Find the owning aim
    const ownerKey = decisionSubjectKey(task.owner)
    const ownerAimIds = newState.aimIndex.byOwner[ownerKey] ?? []
    let ownerAim: Aim | undefined

    for (const aid of ownerAimIds) {
      const a = newState.aims[aid]
      if (a && a.activeTaskId === task.id) {
        ownerAim = a
        break
      }
    }

    if (ownerAim) {
      const aimId = ownerAim.id
      const aimProgress = ownerAim.progress + 1
      const aimSucceeded = aimProgress >= ownerAim.targetProgress

      // For improve_ability tasks: add to personTrainingExperience
      if (ownerAim.kind === 'improve_ability') {
        const trainingExp: AbilityTrainingExperience =
          newState.personTrainingExperience[personId] ?? {}
        const abilityKey = getAbilityFromAimTarget(ownerAim.target)
        if (abilityKey) {
          trainingExp[abilityKey] =
            (trainingExp[abilityKey] ?? 0) + config.taskTrainingExperienceGain
          newState = {
            ...newState,
            personTrainingExperience: {
              ...newState.personTrainingExperience,
              [personId]: trainingExp,
            },
          }
        }
      }

      // For support_organization_aim: also increment target organization Aim's progress
      if (ownerAim.kind === 'support_organization_aim' && ownerAim.target?.kind === 'aim') {
        const targetOrgAim = newState.aims[ownerAim.target.id]
        if (targetOrgAim && targetOrgAim.status === 'active') {
          const newOrgProgress = Math.min(targetOrgAim.progress + 1, targetOrgAim.targetProgress)
          newState = {
            ...newState,
            aims: {
              ...newState.aims,
              [targetOrgAim.id]: { ...targetOrgAim, progress: newOrgProgress },
            },
          }
        }
      }

      // For obtain_office after seek_office_support: set waiting state
      if (ownerAim.kind === 'obtain_office' && task.kind === 'seek_office_support') {
        const waitingAim = {
          ...ownerAim,
          progress: aimProgress,
          activeTaskId: undefined,
          waitingReasonKey: 'waiting.appointment_cycle',
          nextReviewWeek: absoluteWeek + 12,
          status: aimSucceeded ? 'succeeded' : 'active',
        } as unknown as Aim
        newState = {
          ...newState,
          aims: { ...newState.aims, [aimId]: waitingAim },
          waitingAimIds: [...newState.waitingAimIds, aimId],
        }
      } else if (aimSucceeded) {
        const succeededAim: Aim = {
          ...ownerAim,
          progress: aimProgress,
          status: 'succeeded',
        }
        // Clear activeTaskId on succeeded aims to prevent dangling references
        delete succeededAim.activeTaskId
        newState = {
          ...newState,
          aims: { ...newState.aims, [aimId]: succeededAim },
        }
      } else {
        const updatedAim: Aim = {
          ...ownerAim,
          progress: aimProgress,
        }
        newState = {
          ...newState,
          aims: { ...newState.aims, [aimId]: updatedAim },
        }
      }

      // Create PersonActivityLog
      newState = createActivityLogForTask(newState, config, personId, task, outcome, absoluteWeek)

      // Remove completed task from state
      newState = removeTask(newState, task.id)

      // Create next task for aim (if aim not succeeded)
      const updatedAimCheck = newState.aims[aimId]
      if (updatedAimCheck && updatedAimCheck.status === 'active') {
        const nextTaskResult = createNextTaskForAim(
          newState,
          config,
          updatedAimCheck,
          task.kind,
          absoluteWeek,
        )
        if (nextTaskResult) {
          const aimWithTask: Aim = {
            ...updatedAimCheck,
            activeTaskId: nextTaskResult.task.id,
          }
          newState = {
            ...nextTaskResult.state,
            aims: { ...nextTaskResult.state.aims, [aimId]: aimWithTask },
          }
          currentCtx = { ...currentCtx, state: newState }
        } else {
          // No next task — aim stays active with no activeTaskId
          const noTaskAim = {
            ...updatedAimCheck,
            activeTaskId: undefined,
          } as unknown as Aim
          newState = {
            ...newState,
            aims: { ...newState.aims, [aimId]: noTaskAim },
          }
          currentCtx = { ...currentCtx, state: newState }
        }
      } else if (updatedAimCheck && updatedAimCheck.status === 'succeeded') {
        // Aim succeeded — emit PERSON_AIM_SUCCEEDED event
        const personIdForEvent =
          updatedAimCheck.owner.kind === 'person' ? updatedAimCheck.owner.id : undefined
        if (personIdForEvent) {
          const person = newState.persons[personIdForEvent]
          const personNameKey = person?.nameKey ?? personIdForEvent
          const { event, ctx: evCtx } = createSimEvent(currentCtx, {
            type: 'PERSON_AIM_SUCCEEDED',
            importance: 'major',
            messageKey: 'person.aim.succeeded',
            messageParams: {
              owner: nameParam('person', personNameKey),
              kind: updatedAimCheck.kind,
            },
            entityRefs: [entityRef('person', personIdForEvent, 'owner', personNameKey)],
          })
          currentCtx = { ...evCtx, events: [...evCtx.events, event] }
        }
        currentCtx = { ...currentCtx, state: newState }
      }
    } else if (task.targetRef.kind === 'intent') {
      // Intent-targeted task completed: increment intent.progress, clear activeTaskId
      const intent = newState.actorIntents[task.targetRef.id]
      if (intent && intent.status === 'active') {
        const cleaned = Object.fromEntries(
          Object.entries(intent).filter(([k]) => k !== 'activeTaskId'),
        ) as ActorIntent
        const updatedIntent: ActorIntent = {
          ...cleaned,
          progress: (intent.progress ?? 0) + 1,
        }
        newState = {
          ...newState,
          actorIntents: { ...newState.actorIntents, [intent.id]: updatedIntent },
        }
      }

      newState = createActivityLogForTask(newState, config, personId, task, outcome, absoluteWeek)
      newState = removeTask(newState, task.id)
      currentCtx = { ...currentCtx, state: newState }
    } else if (task.targetRef.kind === 'diplomatic_play') {
      // Diplomatic play-targeted task completed: apply negotiation effects
      const playId = task.targetRef.id
      const play = newState.diplomaticPlays[playId]
      if (play && (play.status === 'active' || play.status === 'escalated')) {
        const isInitiator = play.initiatorActiveTaskIds.some(
          (id) => (id as string) === (task.id as string),
        )
        const side: 'initiator' | 'target' = isInitiator ? 'initiator' : 'target'

        newState = applyDiplomaticTaskEffect(newState, config, playId, task, side)
        newState = removeDiplomaticPlayTaskId(newState, playId, task.id)
      }

      newState = createActivityLogForTask(newState, config, personId, task, outcome, absoluteWeek)
      newState = removeTask(newState, task.id)
      currentCtx = { ...currentCtx, state: newState }
    } else {
      // No owning aim found — just remove task and log
      newState = removeTask(newState, task.id)
      newState = createActivityLogForTask(newState, config, personId, task, outcome, absoluteWeek)
      currentCtx = { ...currentCtx, state: newState }
    }

    currentCtx = { ...currentCtx, state: newState }
  }

  return currentCtx
}

// --- getAimDeadlineWeeks ---

function getAimDeadlineWeeks(config: SimulationConfig, kind: PersonAimKind): number {
  if (kind === 'obtain_office') return config.personAimDeadlineObtainOffice
  if (kind === 'retain_office') return config.personAimDeadlineRetainOffice
  return config.personAimDeadlineDefault
}

// --- Waiting review for aims ---

function reviewWaitingAims(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const config = currentCtx.config
  const absoluteWeek = currentCtx.state.absoluteWeek

  const waitingIds = currentCtx.state.waitingAimIds
  if (waitingIds.length === 0) return currentCtx

  const remainingWaitingIds: import('../types/ids').AimId[] = []

  for (const aimId of waitingIds) {
    const aim = currentCtx.state.aims[aimId]
    if (!aim || aim.status !== 'active') continue
    if (!aim.waitingReasonKey) continue
    if (!aim.nextReviewWeek || absoluteWeek < aim.nextReviewWeek) {
      remainingWaitingIds.push(aimId)
      continue
    }

    // Check if person got the office
    if (aim.owner.kind !== 'person') continue
    const personId = aim.owner.id
    const person = currentCtx.state.persons[personId]
    if (!person) continue

    // Find target office from aim.target
    const targetOffice = aim.target
    if (!targetOffice || targetOffice.kind !== 'office') continue

    // Check if office is assigned to this person (use officeIndex for efficiency)
    let officeAssigned = false
    const holderKey = personId as string
    const holderOfficeIds = currentCtx.state.officeIndex.byHolderPerson[holderKey] ?? []
    for (const oaId of holderOfficeIds) {
      const oa = currentCtx.state.officeAssignments[oaId]
      if (!oa || !oa.active) continue
      if (
        oa.organization.kind === targetOffice.organization.kind &&
        (oa.organization.id as string) === (targetOffice.organization.id as string) &&
        oa.role === targetOffice.role
      ) {
        officeAssigned = true
        break
      }
    }

    if (officeAssigned) {
      // Aim succeeded
      const succeededAim: Aim = { ...aim, status: 'succeeded' }
      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          aims: { ...currentCtx.state.aims, [aimId]: succeededAim },
        },
      }

      const personNameKey = person.nameKey ?? personId
      const { event, ctx: evCtx } = createSimEvent(currentCtx, {
        type: 'PERSON_AIM_SUCCEEDED',
        importance: 'major',
        messageKey: 'person.aim.succeeded',
        messageParams: {
          owner: nameParam('person', personNameKey),
          kind: aim.kind,
        },
        entityRefs: [entityRef('person', personId, 'owner', personNameKey)],
      })
      currentCtx = { ...evCtx, events: [...evCtx.events, event] }
    } else {
      // Check deadline
      const deadlineWeeks = getAimDeadlineWeeks(config, aim.kind as PersonAimKind)
      const deadlineWeek = aim.createdWeek + deadlineWeeks
      if (absoluteWeek >= deadlineWeek) {
        // Aim failed
        const failedAim: Aim = { ...aim, status: 'failed' }
        currentCtx = {
          ...currentCtx,
          state: {
            ...currentCtx.state,
            aims: { ...currentCtx.state.aims, [aimId]: failedAim },
          },
        }

        const personNameKey = person.nameKey ?? personId
        const { event, ctx: evCtx } = createSimEvent(currentCtx, {
          type: 'PERSON_AIM_FAILED',
          importance: 'minor',
          messageKey: 'person.aim.failed',
          messageParams: {
            owner: nameParam('person', personNameKey),
            kind: aim.kind,
          },
          entityRefs: [entityRef('person', personId, 'owner', personNameKey)],
        })
        currentCtx = { ...evCtx, events: [...evCtx.events, event] }
      } else {
        // Deadline not passed — clear waiting state
        const personNameKey = person.nameKey ?? personId
        const { event, ctx: evCtx } = createSimEvent(currentCtx, {
          type: 'TASK_COMPLETED',
          importance: 'minor',
          messageKey: 'task.review_waiting',
          messageParams: {
            person: nameParam('person', personNameKey),
            kind: aim.kind,
          },
          entityRefs: [entityRef('person', personId, 'person', personNameKey)],
        })
        currentCtx = { ...evCtx, events: [...evCtx.events, event] }
        // Clear waiting state
        const continuingAim: Aim = {
          ...aim,
          waitingReasonKey: undefined as unknown as string,
          nextReviewWeek: undefined as unknown as number,
        }
        currentCtx = {
          ...currentCtx,
          state: {
            ...currentCtx.state,
            aims: { ...currentCtx.state.aims, [aimId]: continuingAim },
          },
        }
      }
    }
  }

  // Update waitingAimIds
  currentCtx = {
    ...currentCtx,
    state: {
      ...currentCtx.state,
      waitingAimIds: remainingWaitingIds,
    },
  }

  return currentCtx
}

// --- Batch effort update for non-completing tasks ---

type EffortUpdate = { taskId: import('../types/ids').TaskId; newEffortDone: number }
type CompletedTaskInfo = {
  task: Task
  personId: PersonId
}

function batchProcessTasks(ctx: TickContext): {
  ctx: TickContext
  effortUpdates: EffortUpdate[]
  completed: CompletedTaskInfo[]
} {
  const state = ctx.state
  const config = ctx.config
  const effortUpdates: EffortUpdate[] = []
  const completed: CompletedTaskInfo[] = []

  for (const assigneeKey of Object.keys(state.taskIndex.byAssignee)) {
    const taskIds = state.taskIndex.byAssignee[assigneeKey]
    if (!taskIds || taskIds.length === 0) continue

    const personId = assigneeKey as PersonId
    const person = state.persons[personId]
    if (!person || !person.alive || person.kind === 'placeholder') continue

    const capacity = getPersonWeeklyActionCapacity(state, config, personId)
    if (capacity <= 0) continue

    let remainingCapacity = capacity

    for (const tid of taskIds) {
      const task = state.tasks[tid]
      if (!task || task.status !== 'active') continue
      if (task.actionCost > remainingCapacity) continue

      remainingCapacity -= task.actionCost
      const weeklyEffort = computeWeeklyEffort(state, config, task)
      const newEffortDone = task.effortDone + weeklyEffort

      if (newEffortDone >= task.effortRequired) {
        completed.push({ task, personId })
      } else {
        effortUpdates.push({ taskId: task.id, newEffortDone })
      }
    }
  }

  return { ctx, effortUpdates, completed }
}

// --- runTaskSystem ---

export function runTaskSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const absoluteWeek = currentCtx.state.absoluteWeek

  // Step 1: Auto-cancel invalid tasks
  currentCtx = autoCancelTasks(currentCtx)

  // Step 1.5: Fail support_organization_aim Person Aims whose target Aim is gone/terminal
  currentCtx = failOrphanedSupportAims(currentCtx)

  // Step 2: Batch effort calculation (no state copy per task)
  const { effortUpdates, completed } = batchProcessTasks(currentCtx)

  // Step 3: Apply effort updates in one bulk state copy
  if (effortUpdates.length > 0) {
    const newTasks = { ...currentCtx.state.tasks }
    for (const { taskId, newEffortDone } of effortUpdates) {
      const task = newTasks[taskId]
      if (task) {
        newTasks[taskId] = { ...task, effortDone: newEffortDone }
      }
    }
    currentCtx = {
      ...currentCtx,
      state: { ...currentCtx.state, tasks: newTasks },
    }
  }

  // Step 4: Process completed tasks (these do require state changes)
  for (const { task, personId } of completed) {
    currentCtx = handleTaskCompletion(currentCtx, task, personId, absoluteWeek)
  }

  // Step 5: Review waiting aims
  currentCtx = reviewWaitingAims(currentCtx)

  return currentCtx
}

// --- DiplomaticPlay Task helpers ---

function removeDiplomaticPlayTaskId(
  state: WorldState,
  playId: DiplomaticPlayId,
  taskId: import('../types/ids').TaskId,
): WorldState {
  const play = state.diplomaticPlays[playId]
  if (!play) return state
  const updatedPlay: DiplomaticPlay = {
    ...play,
    initiatorActiveTaskIds: play.initiatorActiveTaskIds.filter(
      (id) => (id as string) !== (taskId as string),
    ),
    targetActiveTaskIds: play.targetActiveTaskIds.filter(
      (id) => (id as string) !== (taskId as string),
    ),
  }
  return {
    ...state,
    diplomaticPlays: { ...state.diplomaticPlays, [playId]: updatedPlay },
  }
}

function applyDiplomaticTaskEffect(
  state: WorldState,
  config: SimulationConfig,
  playId: DiplomaticPlayId,
  task: Task,
  side: 'initiator' | 'target',
): WorldState {
  const play = state.diplomaticPlays[playId]
  if (!play) return state

  const updated: DiplomaticPlay = { ...play }

  switch (task.kind) {
    case 'prepare_argument':
      if (side === 'initiator') {
        updated.initiatorPreparation = clamp(
          play.initiatorPreparation + config.diplomaticPlayTaskLeverageGainSmall,
          0,
          100,
        )
      } else {
        updated.targetPreparation = clamp(
          play.targetPreparation + config.diplomaticPlayTaskLeverageGainSmall,
          0,
          100,
        )
      }
      break
    case 'gather_claim_evidence':
      if (side === 'initiator') {
        updated.initiatorLeverage = clamp(
          play.initiatorLeverage + config.diplomaticPlayTaskLeverageGainMedium,
          0,
          100,
        )
      } else {
        updated.targetLeverage = clamp(
          play.targetLeverage + config.diplomaticPlayTaskLeverageGainMedium,
          0,
          100,
        )
      }
      break
    case 'secure_internal_support':
      if (side === 'initiator') {
        updated.initiatorCommitment = clamp(
          play.initiatorCommitment + config.diplomaticPlayTaskCommitmentGainMedium,
          0,
          100,
        )
      } else {
        updated.targetCommitment = clamp(
          play.targetCommitment + config.diplomaticPlayTaskCommitmentGainMedium,
          0,
          100,
        )
      }
      break
    case 'negotiate_terms':
      updated.progress = clamp(play.progress + config.diplomaticPlayTaskProgressGainMedium, 0, 100)
      break
    case 'pressure_counterparty':
      updated.tension = clamp(play.tension + config.diplomaticPlayTaskTensionGainMedium, 0, 100)
      if (side === 'initiator') {
        updated.targetCommitment = Math.max(
          0,
          play.targetCommitment - config.diplomaticPlayTaskOpponentPressureGainMedium,
        )
      } else {
        updated.initiatorCommitment = Math.max(
          0,
          play.initiatorCommitment - config.diplomaticPlayTaskOpponentPressureGainMedium,
        )
      }
      break
    case 'offer_compromise':
      updated.progress = clamp(play.progress + config.diplomaticPlayTaskProgressGainMedium, 0, 100)
      updated.tension = Math.max(0, play.tension - config.diplomaticPlayTaskTensionReductionSmall)
      break
    case 'undermine_counterparty_position':
      if (side === 'initiator') {
        updated.targetLeverage = Math.max(
          0,
          play.targetLeverage - config.diplomaticPlayTaskOpponentLeverageReductionSmall,
        )
      } else {
        updated.initiatorLeverage = Math.max(
          0,
          play.initiatorLeverage - config.diplomaticPlayTaskOpponentLeverageReductionSmall,
        )
      }
      break
  }

  return {
    ...state,
    diplomaticPlays: { ...state.diplomaticPlays, [playId]: updated },
  }
}
