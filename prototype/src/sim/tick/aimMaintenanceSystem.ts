import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { AimId, DecisionReasonId } from '../types/ids'
import { createAimId, createDecisionReasonId } from '../types/ids'
import type { Aim, DecisionReason, DecisionSubjectRef, Goal, EntityRef } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import { getActiveAimsForGoal, pickAimForGoal } from '../selectors/goalSelectors'
import { nameParam, entityRef } from '../types/event'

export function runAimMaintenanceSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const absoluteWeek = currentCtx.state.absoluteWeek

  // Deadline, target validity, and parent-goal checks run every 4w
  for (const [, aim] of Object.entries(currentCtx.state.aims)) {
    if (!aim || aim.status !== 'active') continue

    // Deadline check
    if (absoluteWeek >= aim.deadlineWeek) {
      currentCtx = failAim(currentCtx, aim, 'deadline_reached')
      continue
    }

    // Target validity check
    if (aim.target && !isTargetValid(currentCtx, aim)) {
      currentCtx = failAim(currentCtx, aim, 'target_invalid')
      continue
    }

    // Parent goal terminal check
    if (aim.goalId) {
      const parentGoal = currentCtx.state.goals[aim.goalId]
      if (parentGoal && parentGoal.status !== 'active') {
        const updatedAim: Aim = { ...aim, status: 'abandoned' }
        currentCtx = {
          ...currentCtx,
          state: {
            ...currentCtx.state,
            aims: { ...currentCtx.state.aims, [aim.id]: updatedAim },
          },
        }
        const ownerNameKey = getOwnerNameKey(currentCtx, aim.owner)
        const { event, ctx: evCtx } = createSimEvent(currentCtx, {
          type: 'AIM_ABANDONED',
          importance: 'minor',
          messageKey: 'aim.abandoned',
          messageParams: {
            owner: nameParam(aim.owner.kind, ownerNameKey),
            kind: aim.kind,
          },
          entityRefs: [entityRef(aim.owner.kind, aim.owner.id, 'owner', ownerNameKey)],
        })
        currentCtx = { ...evCtx, events: [...evCtx.events, event] }
      }
    }
  }

  // Aim creation runs only at annual boundaries
  if (absoluteWeek % ctx.config.goalReviewIntervalWeeks === 0) {
    for (const [, goal] of Object.entries(currentCtx.state.goals)) {
      if (!goal || goal.status !== 'active') continue
      const activeAims = getActiveAimsForGoal(currentCtx.state, goal.id)
      if (activeAims.length === 0) {
        currentCtx = createAimForGoal(currentCtx, goal, absoluteWeek)
      }
    }
  }

  return currentCtx
}

function createAimForGoal(ctx: TickContext, goal: Goal, absoluteWeek: number): TickContext {
  const result = pickAimForGoal(ctx.state, ctx.config, goal, ctx.rng)
  if (!result) return ctx

  const { kind, target, rng: nextRng } = result
  let currentCtx = { ...ctx, rng: nextRng }

  const reasonId: DecisionReasonId = createDecisionReasonId(currentCtx.state.nextDecisionReasonId)
  const reason: DecisionReason = {
    id: reasonId,
    owner: goal.owner,
    summaryKey: `decision.reason.aim.${kind}`,
    weight: 1,
    createdWeek: absoluteWeek,
  }

  const aimId: AimId = createAimId(currentCtx.state.nextAimId)

  // Build aim object, conditionally including target only if present
  const aimBase: Omit<Aim, 'id' | 'target'> = {
    owner: goal.owner,
    goalId: goal.id,
    origin: 'goal_driven',
    kind,
    priority: 1,
    progress: 0,
    targetProgress: 1,
    createdWeek: absoluteWeek,
    deadlineWeek: absoluteWeek + currentCtx.config.aimDefaultDeadlineWeeks,
    successfulIntentCount: 0,
    failedIntentCount: 0,
    status: 'active',
    reasonIds: [reasonId],
  }

  const aim: Aim = {
    ...aimBase,
    id: aimId,
    ...(target !== undefined ? { target } : {}),
  }

  const ownerKey = decisionSubjectKey(goal.owner)
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

  const ownerNameKey = getOwnerNameKey(currentCtx, goal.owner)
  const targetName = target ? getTargetName(currentCtx, target) : 'none'
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'AIM_CREATED',
    importance: 'minor',
    messageKey: 'aim.created',
    messageParams: {
      owner: nameParam(goal.owner.kind, ownerNameKey),
      kind,
      target: targetName,
    },
    entityRefs: [entityRef(goal.owner.kind, goal.owner.id, 'owner', ownerNameKey)],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return currentCtx
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function failAim(ctx: TickContext, aim: Aim, _reason: string): TickContext {
  const updatedAim: Aim = { ...aim, status: 'failed' }
  let currentCtx = {
    ...ctx,
    state: {
      ...ctx.state,
      aims: { ...ctx.state.aims, [aim.id]: updatedAim },
    },
  }

  const ownerNameKey = getOwnerNameKey(currentCtx, aim.owner)
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'AIM_FAILED',
    importance: 'minor',
    messageKey: 'aim.failed',
    messageParams: {
      owner: nameParam(aim.owner.kind, ownerNameKey),
      kind: aim.kind,
    },
    entityRefs: [entityRef(aim.owner.kind, aim.owner.id, 'owner', ownerNameKey)],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return currentCtx
}

function isTargetValid(ctx: TickContext, aim: Aim): boolean {
  const t = aim.target
  if (!t) return true
  switch (t.kind) {
    case 'polity': {
      const polity = ctx.state.polities[t.id]
      return polity !== undefined && polity.active
    }
    case 'house': {
      const house = ctx.state.houses[t.id]
      return house !== undefined && house.active
    }
    case 'province':
      return ctx.state.provinces[t.id] !== undefined
    case 'holding':
      return ctx.state.holdings[t.id] !== undefined
    case 'land_contract':
      return ctx.state.landContracts[t.id] !== undefined
    default:
      return true
  }
}

function getOwnerNameKey(ctx: TickContext, owner: DecisionSubjectRef): string {
  if (owner.kind === 'polity') {
    return ctx.state.polities[owner.id]?.nameKey ?? owner.id
  }
  if (owner.kind === 'house') {
    return ctx.state.houses[owner.id]?.nameKey ?? owner.id
  }
  return owner.id
}

function getTargetName(ctx: TickContext, target: EntityRef): string {
  if (target.kind === 'polity') {
    return ctx.state.polities[target.id]?.nameKey ?? target.id
  }
  if (target.kind === 'house') {
    return ctx.state.houses[target.id]?.nameKey ?? target.id
  }
  if (target.kind === 'province') {
    return ctx.state.provinces[target.id]?.nameKey ?? target.id
  }
  return target.id
}
