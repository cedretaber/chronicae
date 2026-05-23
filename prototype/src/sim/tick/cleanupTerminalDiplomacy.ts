import type { TickContext } from './context'
import type { ActorIntentId, AimId, GoalId, DiplomaticPlayId, PersonId } from '../types/ids'
import type { ActorIntent } from '../types/actorIntent'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import type { PoliticalActorRef } from '../types/actor'
import type { DecisionSubjectRef } from '../types/goal'
import type { LandContractId } from '../types/ids'
import type { LandContract } from '../types/landContract'
import type { WorldState } from '../types/world'
import { removeTask, getDiplomaticPlayDelegate } from '../selectors/taskSelectors'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import {
  TERMINAL_ACTOR_INTENT_STATUSES,
  type TerminalActorIntentStatus,
} from '../types/actorIntent'
import {
  TERMINAL_DIPLOMATIC_PLAY_STATUSES,
  type TerminalDiplomaticPlayStatus,
} from '../types/diplomaticPlay'

// v0.18 Stage A §5.7 / §6.6
// tick 末で terminal status の ActorIntent / DiplomaticPlay を Record から完全削除する phase。
// v0.17.3 で発覚した OfficeAssignment / FactionMembership の inactive 累積 perf 問題を
// 再発させないため、最初から「履歴は event ログに残し、Entity としては保持しない」設計とする。
//
// v0.18 Stage D 追加: actor が inactive になった Intent / Play は terminal 化したうえで削除する。
//   ConflictResolution や polityOwnerConsistencySystem が Polity を deactivate した直後の
//   tick で integrityCheck §20 を通すため、cleanup phase で同時に処理する。

const TERMINAL_INTENT_SET = new Set<TerminalActorIntentStatus>(TERMINAL_ACTOR_INTENT_STATUSES)
const TERMINAL_PLAY_SET = new Set<TerminalDiplomaticPlayStatus>(TERMINAL_DIPLOMATIC_PLAY_STATUSES)

function isActorActive(state: WorldState, actor: PoliticalActorRef): boolean {
  if (actor.kind === 'polity') {
    return state.polities[actor.id]?.active === true
  }
  return state.houses[actor.id]?.active === true
}

export function runCleanupTerminalDiplomacy(ctx: TickContext): TickContext {
  const intents = ctx.state.actorIntents
  const plays = ctx.state.diplomaticPlays

  let nextIntents: Record<ActorIntentId, ActorIntent> | undefined

  for (const idStr of Object.keys(intents)) {
    const intent = intents[idStr as ActorIntentId]
    if (!intent) continue
    // actor / targetActor が inactive なら expired として削除
    if (
      !isActorActive(ctx.state, intent.actor) ||
      (intent.targetActor && !isActorActive(ctx.state, intent.targetActor))
    ) {
      if (!nextIntents) nextIntents = { ...intents }
      delete nextIntents[idStr as ActorIntentId]
      continue
    }
    if (TERMINAL_INTENT_SET.has(intent.status as TerminalActorIntentStatus)) {
      if (!nextIntents) nextIntents = { ...intents }
      delete nextIntents[idStr as ActorIntentId]
    }
  }

  let nextPlays: Record<DiplomaticPlayId, DiplomaticPlay> | undefined
  // Collect IDs of plays that will be removed
  const removedPlayIds = new Set<string>()
  for (const idStr of Object.keys(plays)) {
    const play = plays[idStr as DiplomaticPlayId]
    if (!play) continue
    // initiator / target が inactive なら cancelled として削除
    if (!isActorActive(ctx.state, play.initiator) || !isActorActive(ctx.state, play.target)) {
      if (!nextPlays) nextPlays = { ...plays }
      delete nextPlays[idStr as DiplomaticPlayId]
      removedPlayIds.add(idStr)
      continue
    }
    if (TERMINAL_PLAY_SET.has(play.status as TerminalDiplomaticPlayStatus)) {
      if (!nextPlays) nextPlays = { ...plays }
      delete nextPlays[idStr as DiplomaticPlayId]
      removedPlayIds.add(idStr)
    }
  }

  // Reassign dead delegates in active plays
  const activePlays = nextPlays ?? plays
  for (const idStr of Object.keys(activePlays)) {
    const play = activePlays[idStr as DiplomaticPlayId]
    if (!play) continue
    if (TERMINAL_PLAY_SET.has(play.status as TerminalDiplomaticPlayStatus)) continue

    const initDead =
      play.initiatorDelegatePersonId && !isPersonAlive(ctx.state, play.initiatorDelegatePersonId)
    const targDead =
      play.targetDelegatePersonId && !isPersonAlive(ctx.state, play.targetDelegatePersonId)
    if (initDead || targDead) {
      if (!nextPlays) nextPlays = { ...plays }
      const updated: DiplomaticPlay = { ...play }
      if (initDead) {
        const replacement = getDiplomaticPlayDelegate(ctx.state, play.initiator)
        if (replacement) {
          updated.initiatorDelegatePersonId = replacement
        } else {
          delete updated.initiatorDelegatePersonId
        }
      }
      if (targDead) {
        const replacement = getDiplomaticPlayDelegate(ctx.state, play.target)
        if (replacement) {
          updated.targetDelegatePersonId = replacement
        } else {
          delete updated.targetDelegatePersonId
        }
      }
      nextPlays[idStr as DiplomaticPlayId] = updated
    }
  }

  // Clean up aims that reference removed intents or plays
  const removedIntentIds = new Set<string>()
  if (nextIntents) {
    for (const idStr of Object.keys(intents)) {
      if (!nextIntents[idStr as ActorIntentId]) {
        removedIntentIds.add(idStr)
      }
    }
  }

  let nextAims: Record<AimId, (typeof ctx.state.aims)[AimId]> | undefined
  for (const idStr of Object.keys(ctx.state.aims)) {
    const aim = ctx.state.aims[idStr as AimId]
    if (!aim) continue
    const playRemoved = aim.activeDiplomaticPlayId && removedPlayIds.has(aim.activeDiplomaticPlayId)
    const intentRemoved = aim.activeIntentId && removedIntentIds.has(aim.activeIntentId)
    if (playRemoved || intentRemoved) {
      if (!nextAims) nextAims = { ...ctx.state.aims }
      const keysToRemove = new Set<string>()
      if (playRemoved) keysToRemove.add('activeDiplomaticPlayId')
      if (intentRemoved) keysToRemove.add('activeIntentId')
      const entries = Object.entries(aim).filter(([k]) => !keysToRemove.has(k))
      nextAims[idStr as AimId] = Object.fromEntries(entries) as typeof aim
    }
  }

  // v0.22: Abandon Goals/Aims whose owners became inactive this tick
  let nextGoals: Record<GoalId, (typeof ctx.state.goals)[GoalId]> | undefined
  for (const [idStr, goal] of Object.entries(ctx.state.goals)) {
    if (!goal || goal.status !== 'active') continue
    if (!isDecisionSubjectActive(ctx.state, goal.owner)) {
      if (!nextGoals) nextGoals = { ...ctx.state.goals }
      nextGoals[idStr as GoalId] = { ...goal, status: 'abandoned' }
    }
  }

  const currentGoals = nextGoals ?? ctx.state.goals
  for (const [idStr, aim] of Object.entries(nextAims ?? ctx.state.aims)) {
    if (!aim || aim.status !== 'active') continue
    let shouldAbandon = false
    if (!isDecisionSubjectActive(ctx.state, aim.owner)) {
      shouldAbandon = true
    } else if (aim.goalId) {
      const parentGoal = currentGoals[aim.goalId]
      if (parentGoal && parentGoal.status !== 'active') shouldAbandon = true
    }
    if (shouldAbandon) {
      if (!nextAims) nextAims = { ...ctx.state.aims }
      nextAims[idStr as AimId] = { ...aim, status: 'abandoned' }
    }
  }

  // v0.23 Phase D: Remove Tasks associated with removed DiplomaticPlays
  let taskCleanedState: WorldState | undefined
  if (removedPlayIds.size > 0) {
    let tempState = ctx.state
    for (const playIdStr of removedPlayIds) {
      const play = plays[playIdStr as DiplomaticPlayId]
      if (!play) continue
      for (const taskId of play.initiatorActiveTaskIds) {
        if (tempState.tasks[taskId]) {
          tempState = removeTask(tempState, taskId)
        }
      }
      for (const taskId of play.targetActiveTaskIds) {
        if (tempState.tasks[taskId]) {
          tempState = removeTask(tempState, taskId)
        }
      }
    }
    if (tempState !== ctx.state) {
      taskCleanedState = tempState
    }
  }

  // Set contract grace period for terminal contract_tax_revision plays
  let nextLandContracts: Record<LandContractId, LandContract> | undefined
  if (removedPlayIds.size > 0) {
    const gracePeriodWeeks = ctx.config.taxRevisionGracePeriodYears * WEEKS_PER_YEAR
    for (const playIdStr of removedPlayIds) {
      const play = plays[playIdStr as DiplomaticPlayId]
      if (!play || play.kind !== 'contract_tax_revision') continue
      if (play.primaryDemand.kind !== 'change_contract_tax_rate') continue
      const contractId = play.primaryDemand.landContractId
      const base = nextLandContracts ?? ctx.state.landContracts
      const contract = base[contractId]
      if (!contract) continue
      if (!nextLandContracts) nextLandContracts = { ...ctx.state.landContracts }
      nextLandContracts[contractId] = {
        ...contract,
        termsProtectedUntilWeek: ctx.state.absoluteWeek + gracePeriodWeeks,
      }
    }
  }

  if (
    !nextIntents &&
    !nextPlays &&
    !nextAims &&
    !nextGoals &&
    !taskCleanedState &&
    !nextLandContracts
  )
    return ctx

  const baseState = taskCleanedState ?? ctx.state
  return {
    ...ctx,
    state: {
      ...baseState,
      actorIntents: nextIntents ?? baseState.actorIntents,
      diplomaticPlays: nextPlays ?? baseState.diplomaticPlays,
      aims: nextAims ?? baseState.aims,
      goals: nextGoals ?? baseState.goals,
      landContracts: nextLandContracts ?? baseState.landContracts,
    },
  }
}

function isPersonAlive(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  return person !== undefined && person.alive && person.kind !== 'placeholder'
}

function isDecisionSubjectActive(state: WorldState, owner: DecisionSubjectRef): boolean {
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
