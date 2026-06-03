import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { Goal } from '../types/goal'
import { TERMINAL_AIM_STATUSES } from '../types/goal'
import { clamp } from '../utils/math'
import { nameParam, entityRef } from '../types/event'
import { getOwnerNameKey } from '../utils/ownerNames'

const TERMINAL_AIM_SET = new Set<string>(TERMINAL_AIM_STATUSES as readonly string[])

export function runGoalOutcomeSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const [, aim] of Object.entries(currentCtx.state.aims)) {
    if (!aim) continue
    if (!TERMINAL_AIM_SET.has(aim.status)) continue
    if (!aim.goalId) continue

    const goal = currentCtx.state.goals[aim.goalId]
    if (!goal || goal.status !== 'active') continue

    // 調査 §1.5: 冪等ガード。goalOutcomeSystem は毎 tick (4w) に terminal aim を
    // 全走査するが、外交系 Project が aim を保持して cleanup されない間、同じ aim の
    // progressDelta が再加算され goal progress が膨張していた (実測 最大 11x →
    // GOAL_SUCCEEDED 早期発火)。一度加算済みの aim はスキップする。
    if (aim.goalProgressApplied) continue

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

      const ownerNameKey = getOwnerNameKey(currentCtx.state, goal.owner)
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

    // 冪等フラグを立てて二重加算を防ぐ (§1.5)。
    const appliedAim = { ...aim, goalProgressApplied: true }

    currentCtx = {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        goals: { ...currentCtx.state.goals, [goal.id]: updatedGoal },
        aims: { ...currentCtx.state.aims, [aim.id]: appliedAim },
      },
    }
  }

  return currentCtx
}
