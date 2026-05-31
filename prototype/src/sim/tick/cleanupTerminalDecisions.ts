import type { TickContext } from './context'
import type { GoalId, AimId, DecisionReasonId } from '../types/ids'
import type { Goal } from '../types/goal'
import type { Aim } from '../types/goal'
import { TERMINAL_GOAL_STATUSES, TERMINAL_AIM_STATUSES } from '../types/goal'

const TERMINAL_GOAL_SET = new Set<string>(TERMINAL_GOAL_STATUSES as readonly string[])
const TERMINAL_AIM_SET = new Set<string>(TERMINAL_AIM_STATUSES as readonly string[])

export function runCleanupTerminalDecisions(ctx: TickContext): TickContext {
  const goals = ctx.state.goals
  const aims = ctx.state.aims
  const reasons = ctx.state.decisionReasons

  // Collect aim/goal IDs still referenced by active Projects or DiplomaticPlays
  const referencedAimIds = new Set<string>()
  const referencedGoalIds = new Set<string>()
  for (const [, project] of Object.entries(ctx.state.projects)) {
    if (!project || project.status !== 'active') continue
    if (project.origin.kind === 'aim') referencedAimIds.add(project.origin.aimId)
  }
  for (const [, play] of Object.entries(ctx.state.diplomaticPlays)) {
    if (!play) continue
    if (play.aimId) referencedAimIds.add(play.aimId)
    if (play.goalId) referencedGoalIds.add(play.goalId)
  }

  // A Goal must not be deleted while an Aim that survives this cleanup still
  // references it via goalId. An Aim survives if it is non-terminal, or if it is
  // terminal but held alive by an active Project/Play (referencedAimIds). This
  // completes the dependency chain active Project → origin Aim → Goal: a Project
  // requires its origin Aim to exist (integrity), so the Aim's Goal must persist
  // too. Without this, a terminal Goal could be deleted while a surviving Aim
  // still points at it, leaving a dangling goalId reference (year-end integrity
  // violation "Aim X: goalId Y does not exist").
  for (const [aidStr, aim] of Object.entries(aims)) {
    if (!aim || !aim.goalId) continue
    const aimSurvives = !TERMINAL_AIM_SET.has(aim.status) || referencedAimIds.has(aidStr)
    if (aimSurvives) referencedGoalIds.add(aim.goalId)
  }

  // Collect terminal goal IDs (only if not referenced by active entities)
  const terminalGoalIds: GoalId[] = []
  let nextGoals: Record<GoalId, Goal> | undefined
  for (const [idStr, goal] of Object.entries(goals)) {
    if (!goal) continue
    if (TERMINAL_GOAL_SET.has(goal.status) && !referencedGoalIds.has(idStr)) {
      terminalGoalIds.push(idStr as GoalId)
      if (!nextGoals) nextGoals = { ...goals }
      delete nextGoals[idStr as GoalId]
    }
  }

  // Collect terminal aim IDs (only if not referenced by active entities)
  const terminalAimIds: AimId[] = []
  let nextAims: Record<AimId, Aim> | undefined
  for (const [idStr, aim] of Object.entries(aims)) {
    if (!aim) continue
    if (TERMINAL_AIM_SET.has(aim.status) && !referencedAimIds.has(idStr)) {
      terminalAimIds.push(idStr as AimId)
      if (!nextAims) nextAims = { ...aims }
      delete nextAims[idStr as AimId]
    }
  }

  if (terminalGoalIds.length === 0 && terminalAimIds.length === 0) return ctx

  // Update goalIndex: remove terminal goals from byOwner
  let nextGoalIndex = ctx.state.goalIndex
  if (terminalGoalIds.length > 0) {
    const removedSet = new Set<string>(terminalGoalIds as string[])
    const newByOwner = { ...ctx.state.goalIndex.byOwner }
    for (const [ownerKey, goalIds] of Object.entries(newByOwner)) {
      if (!goalIds) continue
      const filtered = goalIds.filter((gid) => !removedSet.has(gid as string))
      if (filtered.length !== goalIds.length) {
        newByOwner[ownerKey] = filtered
      }
    }
    nextGoalIndex = { byOwner: newByOwner }
  }

  // Update aimIndex: remove terminal aims from byOwner and byGoal
  let nextAimIndex = ctx.state.aimIndex
  if (terminalAimIds.length > 0) {
    const removedSet = new Set<string>(terminalAimIds as string[])
    const newByOwner = { ...ctx.state.aimIndex.byOwner }
    for (const [ownerKey, aimIds] of Object.entries(newByOwner)) {
      if (!aimIds) continue
      const filtered = aimIds.filter((aid) => !removedSet.has(aid as string))
      if (filtered.length !== aimIds.length) {
        newByOwner[ownerKey] = filtered
      }
    }
    const newByGoal = { ...ctx.state.aimIndex.byGoal }
    for (const [goalKey, aimIds] of Object.entries(newByGoal)) {
      if (!aimIds) continue
      const filtered = aimIds.filter((aid) => !removedSet.has(aid as string))
      if (filtered.length !== aimIds.length) {
        newByGoal[goalKey] = filtered
      }
    }
    nextAimIndex = { byOwner: newByOwner, byGoal: newByGoal }
  }

  // Collect all reasonIds still referenced by surviving goals and aims
  const referencedReasonIds = new Set<string>()
  const survivingGoals = nextGoals ?? goals
  const survivingAims = nextAims ?? aims
  for (const [, goal] of Object.entries(survivingGoals)) {
    if (!goal) continue
    for (const rid of goal.reasonIds) {
      referencedReasonIds.add(rid)
    }
  }
  for (const [, aim] of Object.entries(survivingAims)) {
    if (!aim) continue
    for (const rid of aim.reasonIds) {
      referencedReasonIds.add(rid)
    }
  }

  // Remove orphan DecisionReasons
  let nextReasons: Record<DecisionReasonId, (typeof reasons)[DecisionReasonId]> | undefined
  for (const [idStr] of Object.entries(reasons)) {
    if (!referencedReasonIds.has(idStr)) {
      if (!nextReasons) nextReasons = { ...reasons }
      delete nextReasons[idStr as DecisionReasonId]
    }
  }

  return {
    ...ctx,
    state: {
      ...ctx.state,
      goals: nextGoals ?? goals,
      aims: nextAims ?? aims,
      decisionReasons: nextReasons ?? reasons,
      goalIndex: nextGoalIndex,
      aimIndex: nextAimIndex,
    },
  }
}
