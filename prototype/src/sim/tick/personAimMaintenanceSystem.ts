import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { Aim, DecisionSubjectRef, DecisionReason, PersonAimKind, Goal } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { AimId, DecisionReasonId, PersonId } from '../types/ids'
import { createAimId, createDecisionReasonId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import { getActivePersonGoal } from '../selectors/personGoalSelectors'
import { pickPersonAim } from '../selectors/personAimSelectors'
import { createInitialTaskForAim } from '../selectors/taskSelectors'
import type { SimulationConfig } from '../config/defaultConfig'

export function runPersonAimMaintenanceSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const absoluteWeek = currentCtx.state.absoluteWeek

  // Runs every 4 weeks
  if (absoluteWeek % 4 !== 0) return currentCtx

  for (const [, person] of Object.entries(currentCtx.state.persons)) {
    if (!person || !person.alive) continue
    if (person.kind === 'placeholder') continue
    if (person.age < currentCtx.config.adultAge) continue

    const house = currentCtx.state.houses[person.houseId]
    if (!house || !house.active) continue

    const goal = getActivePersonGoal(currentCtx.state, person.id)
    if (!goal) continue

    // Check for existing active aim
    const ownerKey = decisionSubjectKey({ kind: 'person', id: person.id })
    const aimIds = currentCtx.state.aimIndex.byOwner[ownerKey]
    let hasActiveAim = false
    if (aimIds) {
      for (const aid of aimIds) {
        const aim = currentCtx.state.aims[aid]
        if (aim && aim.status === 'active') {
          hasActiveAim = true
          break
        }
      }
    }

    if (!hasActiveAim) {
      currentCtx = createPersonAim(currentCtx, person.id, goal, absoluteWeek)
    }
  }

  // Check deadline/validity of existing Person Aims
  currentCtx = checkPersonAimDeadlines(currentCtx)

  return currentCtx
}

function getAimDeadlineWeeks(config: SimulationConfig, kind: PersonAimKind): number {
  if (kind === 'obtain_office') return config.personAimDeadlineObtainOffice
  if (kind === 'retain_office') return config.personAimDeadlineRetainOffice
  return config.personAimDeadlineDefault
}

function getAimTargetProgress(kind: PersonAimKind): number {
  if (kind === 'obtain_office') return 2
  return 3
}

function createPersonAim(
  ctx: TickContext,
  personId: PersonId,
  goal: Goal,
  absoluteWeek: number,
): TickContext {
  const result = pickPersonAim(ctx.state, ctx.config, personId, goal, ctx.rng)
  if (!result) return ctx

  const { kind, target, rng: nextRng } = result
  let currentCtx = { ...ctx, rng: nextRng }

  const owner: DecisionSubjectRef = { kind: 'person', id: personId }

  const reasonId: DecisionReasonId = createDecisionReasonId(currentCtx.state.nextDecisionReasonId)
  const reason: DecisionReason = {
    id: reasonId,
    owner,
    summaryKey: `decision.reason.aim.${kind}`,
    weight: 1,
    createdWeek: absoluteWeek,
  }

  const aimId: AimId = createAimId(currentCtx.state.nextAimId)
  const deadlineWeeks = getAimDeadlineWeeks(currentCtx.config, kind)
  const targetProgress = getAimTargetProgress(kind)

  let deadlineWeek = absoluteWeek + deadlineWeeks
  // support_organization_aim: cap deadline at target Aim's deadline
  if (kind === 'support_organization_aim' && target?.kind === 'aim') {
    const targetAim = currentCtx.state.aims[target.id]
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
    successfulIntentCount: 0,
    failedIntentCount: 0,
    status: 'active',
    reasonIds: [reasonId],
    ...(target !== undefined ? { target } : {}),
  }

  const ownerKey = decisionSubjectKey(owner)
  const existingOwnerAims = currentCtx.state.aimIndex.byOwner[ownerKey] ?? []
  const existingGoalAims = currentCtx.state.aimIndex.byGoal[goal.id as string] ?? []

  currentCtx = {
    ...currentCtx,
    state: {
      ...currentCtx.state,
      aims: { ...currentCtx.state.aims, [aimId]: aim },
      decisionReasons: { ...currentCtx.state.decisionReasons, [reasonId]: reason },
      aimIndex: {
        byOwner: {
          ...currentCtx.state.aimIndex.byOwner,
          [ownerKey]: [...existingOwnerAims, aimId],
        },
        byGoal: {
          ...currentCtx.state.aimIndex.byGoal,
          [goal.id as string]: [...existingGoalAims, aimId],
        },
      },
      nextAimId: currentCtx.state.nextAimId + 1,
      nextDecisionReasonId: currentCtx.state.nextDecisionReasonId + 1,
    },
  }

  // Create initial task for the aim
  const taskResult = createInitialTaskForAim(currentCtx.state, currentCtx.config, aim, absoluteWeek)
  if (taskResult) {
    const aimWithTask = { ...aim, activeTaskId: taskResult.task.id }
    currentCtx = {
      ...currentCtx,
      state: {
        ...taskResult.state,
        aims: { ...taskResult.state.aims, [aimId]: aimWithTask },
      },
    }
  }

  const person = currentCtx.state.persons[personId]
  const personNameKey = person?.nameKey ?? personId
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'PERSON_AIM_CREATED',
    importance: 'minor',
    messageKey: 'person.aim.created',
    messageParams: {
      owner: nameParam('person', personNameKey),
      kind,
    },
    entityRefs: [entityRef('person', personId, 'owner', personNameKey)],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return currentCtx
}

function checkPersonAimDeadlines(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const absoluteWeek = currentCtx.state.absoluteWeek

  for (const [, aim] of Object.entries(currentCtx.state.aims)) {
    if (!aim || aim.status !== 'active') continue
    // Only check Person Aims (not Polity or House Aims)
    if (aim.owner.kind !== 'person') continue

    // support_organization_aim: fail if target Aim is terminal
    if (aim.kind === 'support_organization_aim' && aim.target?.kind === 'aim') {
      const targetAim = currentCtx.state.aims[aim.target.id]
      if (!targetAim || targetAim.status !== 'active') {
        const newStatus = targetAim?.status === 'succeeded' ? 'succeeded' : 'failed'
        const updatedAim: Aim = { ...aim, status: newStatus }
        currentCtx = {
          ...currentCtx,
          state: {
            ...currentCtx.state,
            aims: { ...currentCtx.state.aims, [aim.id]: updatedAim },
          },
        }
        const person = currentCtx.state.persons[aim.owner.id]
        const personNameKey = person?.nameKey ?? aim.owner.id
        const evType = newStatus === 'succeeded' ? 'PERSON_AIM_SUCCEEDED' : 'PERSON_AIM_FAILED'
        const evKey = newStatus === 'succeeded' ? 'person.aim.succeeded' : 'person.aim.failed'
        const { event, ctx: evCtx } = createSimEvent(currentCtx, {
          type: evType,
          importance: 'minor',
          messageKey: evKey,
          messageParams: {
            owner: nameParam('person', personNameKey),
            kind: aim.kind,
          },
          entityRefs: [entityRef('person', aim.owner.id, 'owner', personNameKey)],
        })
        currentCtx = { ...evCtx, events: [...evCtx.events, event] }
        continue
      }
    }

    // Deadline check
    if (absoluteWeek >= aim.deadlineWeek) {
      const updatedAim: Aim = { ...aim, status: 'failed' }
      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          aims: { ...currentCtx.state.aims, [aim.id]: updatedAim },
        },
      }

      const person = currentCtx.state.persons[aim.owner.id]
      const personNameKey = person?.nameKey ?? aim.owner.id
      const { event, ctx: evCtx } = createSimEvent(currentCtx, {
        type: 'PERSON_AIM_FAILED',
        importance: 'minor',
        messageKey: 'person.aim.failed',
        messageParams: {
          owner: nameParam('person', personNameKey),
          kind: aim.kind,
        },
        entityRefs: [entityRef('person', aim.owner.id, 'owner', personNameKey)],
      })
      currentCtx = { ...evCtx, events: [...evCtx.events, event] }
    }
  }

  return currentCtx
}
