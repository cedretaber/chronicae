import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { GoalId, DecisionReasonId } from '../types/ids'
import { createGoalId, createDecisionReasonId } from '../types/ids'
import type { Goal, DecisionReason, DecisionSubjectRef } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import {
  getActiveGoalForOwner,
  getActiveAimsForGoal,
  selectGoalKind,
} from '../selectors/goalSelectors'
import { nameParam, entityRef } from '../types/event'
import { clamp } from '../utils/math'

export function runGoalMaintenanceSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  // Always abandon goals for inactive owners (runs every 4w)
  currentCtx = abandonGoalsForInactiveOwners(currentCtx)

  // Goal creation/review runs only at annual boundaries
  const absoluteWeek = currentCtx.state.absoluteWeek
  if (absoluteWeek % ctx.config.goalReviewIntervalWeeks !== 0) return currentCtx

  const owners: DecisionSubjectRef[] = []

  for (const [, polity] of Object.entries(currentCtx.state.polities)) {
    if (!polity || !polity.active) continue
    owners.push({ kind: 'polity', id: polity.id })
  }

  for (const [, house] of Object.entries(currentCtx.state.houses)) {
    if (!house || !house.active) continue
    if (house.kind === 'system') continue
    owners.push({ kind: 'house', id: house.id })
  }

  for (const owner of owners) {
    const existingGoal = getActiveGoalForOwner(currentCtx.state, owner)

    if (!existingGoal) {
      currentCtx = createGoalForOwner(currentCtx, owner, absoluteWeek)
      continue
    }

    if (absoluteWeek < existingGoal.nextReviewWeek) continue

    currentCtx = reviewGoal(currentCtx, existingGoal, absoluteWeek)
  }

  return currentCtx
}

function createGoalForOwner(
  ctx: TickContext,
  owner: DecisionSubjectRef,
  absoluteWeek: number,
): TickContext {
  const selection = selectGoalKind(ctx.state, ctx.config, owner, ctx.rng)
  if (!selection) return ctx

  const { kind, rng: nextRng } = selection
  let currentCtx = { ...ctx, rng: nextRng }

  const reasonId: DecisionReasonId = createDecisionReasonId(currentCtx.state.nextDecisionReasonId)
  const reason: DecisionReason = {
    id: reasonId,
    owner,
    summaryKey: `decision.reason.goal.${kind}`,
    weight: 1,
    createdWeek: absoluteWeek,
  }

  const goalId: GoalId = createGoalId(currentCtx.state.nextGoalId)
  const goal: Goal = {
    id: goalId,
    owner,
    kind,
    priority: 1,
    progress: 0,
    targetProgress: 100,
    createdWeek: absoluteWeek,
    minimumUntilWeek: absoluteWeek + currentCtx.config.goalMinimumDurationWeeks,
    lastReviewWeek: absoluteWeek,
    nextReviewWeek: absoluteWeek + currentCtx.config.goalReviewIntervalWeeks,
    status: 'active',
    reasonIds: [reasonId],
  }

  const ownerKey = decisionSubjectKey(owner)
  const existingOwnerGoals = currentCtx.state.goalIndex.byOwner[ownerKey] ?? []

  currentCtx = {
    ...currentCtx,
    state: {
      ...currentCtx.state,
      goals: { ...currentCtx.state.goals, [goalId]: goal },
      decisionReasons: { ...currentCtx.state.decisionReasons, [reasonId]: reason },
      goalIndex: {
        byOwner: {
          ...currentCtx.state.goalIndex.byOwner,
          [ownerKey]: [...existingOwnerGoals, goalId],
        },
      },
      nextGoalId: currentCtx.state.nextGoalId + 1,
      nextDecisionReasonId: currentCtx.state.nextDecisionReasonId + 1,
    },
  }

  const ownerNameKey = getOwnerNameKey(currentCtx, owner)
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'GOAL_CREATED',
    importance: 'minor',
    messageKey: 'goal.created',
    messageParams: {
      owner: nameParam(owner.kind, ownerNameKey),
      kind,
    },
    entityRefs: [entityRef(owner.kind, owner.id, 'owner', ownerNameKey)],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return currentCtx
}

function reviewGoal(ctx: TickContext, goal: Goal, absoluteWeek: number): TickContext {
  let currentCtx = ctx

  if (absoluteWeek < goal.minimumUntilWeek) {
    const updatedGoal: Goal = {
      ...goal,
      lastReviewWeek: absoluteWeek,
      nextReviewWeek: absoluteWeek + currentCtx.config.goalReviewIntervalWeeks,
    }
    return {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        goals: { ...currentCtx.state.goals, [goal.id]: updatedGoal },
      },
    }
  }

  const activeAims = getActiveAimsForGoal(currentCtx.state, goal.id)
  const goalAgeYears = (absoluteWeek - goal.createdWeek) / currentCtx.config.goalReviewIntervalWeeks
  const keepScore = goal.progress * 0.5 + activeAims.length * 10 + clamp(goalAgeYears, 0, 10) * 5

  if (keepScore > currentCtx.config.goalSwitchThreshold) {
    const updatedGoal: Goal = {
      ...goal,
      lastReviewWeek: absoluteWeek,
      nextReviewWeek: absoluteWeek + currentCtx.config.goalReviewIntervalWeeks,
    }
    currentCtx = {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        goals: { ...currentCtx.state.goals, [goal.id]: updatedGoal },
      },
    }

    const ownerNameKey = getOwnerNameKey(currentCtx, goal.owner)
    const { event, ctx: evCtx } = createSimEvent(currentCtx, {
      type: 'GOAL_REVIEWED',
      importance: 'minor',
      messageKey: 'goal.reviewed',
      messageParams: {
        owner: nameParam(goal.owner.kind, ownerNameKey),
        kind: goal.kind,
      },
      entityRefs: [entityRef(goal.owner.kind, goal.owner.id, 'owner', ownerNameKey)],
    })
    currentCtx = { ...evCtx, events: [...evCtx.events, event] }

    return currentCtx
  }

  // Abandon and replace
  currentCtx = abandonGoal(currentCtx, goal)
  currentCtx = createGoalForOwner(currentCtx, goal.owner, absoluteWeek)

  return currentCtx
}

function abandonGoal(ctx: TickContext, goal: Goal): TickContext {
  let currentCtx = ctx
  const updatedGoal: Goal = { ...goal, status: 'abandoned' }
  currentCtx = {
    ...currentCtx,
    state: {
      ...currentCtx.state,
      goals: { ...currentCtx.state.goals, [goal.id]: updatedGoal },
    },
  }

  // Also abandon active aims under this goal
  const activeAims = getActiveAimsForGoal(currentCtx.state, goal.id)
  for (const aim of activeAims) {
    const updatedAim = { ...aim, status: 'abandoned' as const }
    currentCtx = {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        aims: { ...currentCtx.state.aims, [aim.id]: updatedAim },
      },
    }
  }

  const ownerNameKey = getOwnerNameKey(currentCtx, goal.owner)
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'GOAL_ABANDONED',
    importance: 'minor',
    messageKey: 'goal.abandoned',
    messageParams: {
      owner: nameParam(goal.owner.kind, ownerNameKey),
      kind: goal.kind,
    },
    entityRefs: [entityRef(goal.owner.kind, goal.owner.id, 'owner', ownerNameKey)],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return currentCtx
}

function abandonGoalsForInactiveOwners(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const [, goal] of Object.entries(currentCtx.state.goals)) {
    if (!goal || goal.status !== 'active') continue
    const isActive = isOwnerActive(currentCtx, goal.owner)
    if (!isActive) {
      currentCtx = abandonGoal(currentCtx, goal)
    }
  }

  return currentCtx
}

function isOwnerActive(ctx: TickContext, owner: DecisionSubjectRef): boolean {
  if (owner.kind === 'polity') {
    const polity = ctx.state.polities[owner.id]
    return polity !== undefined && polity.active
  }
  if (owner.kind === 'house') {
    const house = ctx.state.houses[owner.id]
    return house !== undefined && house.active && house.kind !== 'system'
  }
  if (owner.kind === 'person') {
    const person = ctx.state.persons[owner.id]
    return person !== undefined && person.alive && person.kind !== 'placeholder'
  }
  return false
}

function getOwnerNameKey(ctx: TickContext, owner: DecisionSubjectRef): string {
  if (owner.kind === 'polity') {
    return ctx.state.polities[owner.id]?.nameKey ?? owner.id
  }
  if (owner.kind === 'house') {
    return ctx.state.houses[owner.id]?.nameKey ?? owner.id
  }
  return ctx.state.persons[owner.id]?.nameKey ?? owner.id
}
