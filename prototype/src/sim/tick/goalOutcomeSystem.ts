import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { Goal } from '../types/goal'
import { TERMINAL_AIM_STATUSES } from '../types/goal'
import { clamp } from '../utils/math'
import { nameParam, entityRef } from '../types/event'
import type { DecisionSubjectRef } from '../types/goal'

const TERMINAL_AIM_SET = new Set<string>(TERMINAL_AIM_STATUSES as readonly string[])

export function runGoalOutcomeSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const [, aim] of Object.entries(currentCtx.state.aims)) {
    if (!aim) continue
    if (!TERMINAL_AIM_SET.has(aim.status)) continue
    if (!aim.goalId) continue

    const goal = currentCtx.state.goals[aim.goalId]
    if (!goal || goal.status !== 'active') continue

    // Check if we already processed this aim (avoid double-counting)
    // We use a simple heuristic: only process aims that became terminal this tick
    // Since this runs every 4w, and aim status transitions happen in the same tick cycle,
    // we can safely process all terminal aims each time (cleanup will delete them)

    let progressDelta = 0
    if (aim.status === 'succeeded') {
      progressDelta = currentCtx.config.goalProgressOnAimSucceeded
    } else if (aim.status === 'failed') {
      progressDelta = currentCtx.config.goalProgressOnAimFailed
    } else if (aim.status === 'abandoned') {
      progressDelta = currentCtx.config.goalProgressOnAimAbandoned
    }

    const isPersonGoal = goal.owner.kind === 'person'
    const progressCeil = isPersonGoal ? 100 : goal.targetProgress
    const newProgress = clamp(goal.progress + progressDelta, 0, progressCeil)
    let updatedGoal: Goal = { ...goal, progress: newProgress }

    // Person Goal は fulfillment であり succeeded にならない
    if (!isPersonGoal && updatedGoal.progress >= updatedGoal.targetProgress) {
      updatedGoal = { ...updatedGoal, status: 'succeeded' }

      const ownerNameKey = getOwnerNameKey(currentCtx, goal.owner)
      const { event, ctx: evCtx } = createSimEvent(currentCtx, {
        type: 'GOAL_SUCCEEDED',
        importance: 'normal',
        messageKey: 'goal.succeeded',
        messageParams: {
          owner: nameParam(goal.owner.kind, ownerNameKey),
          kind: goal.kind,
        },
        entityRefs: [entityRef(goal.owner.kind, goal.owner.id, 'owner', ownerNameKey)],
      })
      currentCtx = { ...evCtx, events: [...evCtx.events, event] }
    }

    currentCtx = {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        goals: { ...currentCtx.state.goals, [goal.id]: updatedGoal },
      },
    }
  }

  return currentCtx
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
