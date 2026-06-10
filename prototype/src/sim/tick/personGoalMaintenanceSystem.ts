import type { TickContext } from './context'
import { createSimEvent } from './context'
import { isLifeStageAtLeast } from '../types/person'
import type { Goal, DecisionSubjectRef, DecisionReason } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { GoalId, DecisionReasonId, PersonId } from '../types/ids'
import { createGoalId, createDecisionReasonId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import { selectPersonGoalKind, getActivePersonGoal } from '../selectors/personGoalSelectors'
import type { WorldState } from '../types/world'

// active polity office を 1 つでも持つか (無家人物の goal 形成資格)。
function hasActivePolityOfficeForGoal(state: WorldState, personId: PersonId): boolean {
  for (const oaId of state.officeIndex.byHolderPerson[personId as string] ?? []) {
    const oa = state.officeAssignments[oaId]
    if (oa && oa.active && oa.organization.kind === 'polity') return true
  }
  return false
}

export function runPersonGoalMaintenanceSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const absoluteWeek = currentCtx.state.absoluteWeek

  for (const personId of currentCtx.state.livingPersonIds) {
    const person = currentCtx.state.persons[personId]
    if (!person) continue
    if (person.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(person.lifeStage, 'young_adulthood')) continue
    // v0.47 §9.3/§13: 有家人物に加え、active polity office を持つ無家人物も goal を形成できる
    //   (共和国役職者の House 創設・無家被任命者の分封 petition の前提)。全無家人物には開かない。
    if (!person.houseId) {
      if (!hasActivePolityOfficeForGoal(currentCtx.state, personId)) continue
    } else {
      const house = currentCtx.state.houses[person.houseId]
      if (!house || !house.active) continue
    }

    const existingGoal = getActivePersonGoal(currentCtx.state, person.id)
    if (existingGoal) continue

    // Create a new Person Goal
    currentCtx = createPersonGoal(currentCtx, person.id, absoluteWeek)
  }

  return currentCtx
}

function createPersonGoal(ctx: TickContext, personId: PersonId, absoluteWeek: number): TickContext {
  const selection = selectPersonGoalKind(ctx.state, ctx.config, personId, ctx.rng)
  if (!selection) return ctx

  const { kind, rng: nextRng } = selection
  let currentCtx = { ...ctx, rng: nextRng }

  const owner: DecisionSubjectRef = { kind: 'person', id: personId }

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
    nextReviewWeek: absoluteWeek + currentCtx.config.personGoalReviewIntervalWeeks,
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

  const person = currentCtx.state.persons[personId]
  const personNameKey = person?.nameKey ?? personId
  const { event, ctx: evCtx } = createSimEvent(currentCtx, {
    type: 'PERSON_GOAL_CREATED',
    importance: 'minor',
    messageKey: 'person.goal.created',
    messageParams: {
      owner: nameParam('person', personNameKey),
      kind,
    },
    entityRefs: [entityRef('person', personId, 'owner', personNameKey)],
  })
  currentCtx = { ...evCtx, events: [...evCtx.events, event] }

  return currentCtx
}
