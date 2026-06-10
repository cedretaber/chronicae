import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { Goal } from '../types/goal'
import type { WorldState } from '../types/world'
import { TERMINAL_AIM_STATUSES } from '../types/goal'
import { clamp } from '../utils/math'
import { nameParam, entityRef } from '../types/event'
import { getOwnerNameKey, getOwnerNameRefForEmit } from '../utils/ownerNames'

const TERMINAL_AIM_SET = new Set<string>(TERMINAL_AIM_STATUSES as readonly string[])

// perf (v0.47): mutable-draft パターン (lazy)。かつては処理対象 aim ごとに goals + aims の
//   二重 spread が走っていた。draft は最初の更新時に各 1 回だけ浅コピーし、以降は既存キーの
//   オブジェクト置換。処理対象が 0 件の tick ではコピー自体を回避する。
//   走査は従来どおりループ開始時点の aims スナップショット (Object.entries は 1 回評価)。
export function runGoalOutcomeSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  let draft: WorldState | undefined
  const ensureDraft = (): WorldState => {
    if (!draft) {
      draft = {
        ...currentCtx.state,
        goals: { ...currentCtx.state.goals },
        aims: { ...currentCtx.state.aims },
      }
      currentCtx = { ...currentCtx, state: draft }
    }
    return draft
  }

  for (const [, aim] of Object.entries(ctx.state.aims)) {
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
          owner: nameParam(
            getOwnerNameRefForEmit(currentCtx.state, goal.owner).category,
            ownerNameKey,
          ),
          kind: goal.kind,
        },
        entityRefs: [entityRef(goal.owner.kind, goal.owner.id, 'owner', ownerNameKey)],
      })
      currentCtx = { ...evCtx, events: [...evCtx.events, event] }
    }

    // 冪等フラグを立てて二重加算を防ぐ (§1.5)。
    const appliedAim = { ...aim, goalProgressApplied: true }

    const d = ensureDraft()
    d.goals[goal.id] = updatedGoal
    d.aims[aim.id] = appliedAim
  }

  return currentCtx
}
