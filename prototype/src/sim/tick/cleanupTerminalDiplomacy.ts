import type { TickContext } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { AimId, GoalId, DiplomaticPlayId, PressureId, ProjectId, PersonId } from '../types/ids'
import type { EventId } from '../types/ids'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import type { PoliticalActorRef } from '../types/actor'
import type { DecisionSubjectRef } from '../types/goal'
import type { LandContractId } from '../types/ids'
import type { LandContract } from '../types/landContract'
import type { Project } from '../types/project'
import type { Pressure, PressureIndex } from '../types/pressure'
import type { WorldState } from '../types/world'
import { removeTask, getDiplomaticPlayDelegate } from '../selectors/taskSelectors'
import { removePressureFromIndexMut } from '../mutations/pressureMutations'
import { createLogger } from '../debug/logger'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import {
  TERMINAL_DIPLOMATIC_PLAY_STATUSES,
  type TerminalDiplomaticPlayStatus,
} from '../types/diplomaticPlay'

const TERMINAL_PLAY_SET = new Set<TerminalDiplomaticPlayStatus>(TERMINAL_DIPLOMATIC_PLAY_STATUSES)

function isActorActive(state: WorldState, actor: PoliticalActorRef): boolean {
  if (actor.kind === 'polity') {
    return state.polities[actor.id]?.active === true
  }
  return state.houses[actor.id]?.active === true
}

export function runCleanupTerminalDiplomacy(ctx: TickContext): TickContext {
  const plays = ctx.state.diplomaticPlays

  let nextPlays: Record<DiplomaticPlayId, DiplomaticPlay> | undefined
  const removedPlayIds = new Set<string>()
  for (const idStr of Object.keys(plays)) {
    const play = plays[idStr as DiplomaticPlayId]
    if (!play) continue
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
        const exclude = targDead ? undefined : play.targetDelegatePersonId
        const replacement = getDiplomaticPlayDelegate(ctx.state, play.initiator, exclude)
        if (replacement) {
          updated.initiatorDelegatePersonId = replacement
        } else {
          delete updated.initiatorDelegatePersonId
        }
      }
      if (targDead) {
        const replacement = getDiplomaticPlayDelegate(
          ctx.state,
          play.target,
          updated.initiatorDelegatePersonId,
        )
        if (replacement) {
          updated.targetDelegatePersonId = replacement
        } else {
          delete updated.targetDelegatePersonId
        }
      }
      nextPlays[idStr as DiplomaticPlayId] = updated
    }
  }

  // Clean up aims that reference removed plays
  let nextAims: Record<AimId, (typeof ctx.state.aims)[AimId]> | undefined
  for (const idStr of Object.keys(ctx.state.aims)) {
    const aim = ctx.state.aims[idStr as AimId]
    if (!aim) continue
    const playRemoved = aim.activeDiplomaticPlayId && removedPlayIds.has(aim.activeDiplomaticPlayId)
    if (playRemoved) {
      if (!nextAims) nextAims = { ...ctx.state.aims }
      const entries = Object.entries(aim).filter(([k]) => k !== 'activeDiplomaticPlayId')
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

  // v0.29 Phase C: Sync Pressures + cancel response/initiator Projects for terminal plays
  let nextPressures: Record<PressureId, Pressure> | undefined
  let nextPressureIndex: PressureIndex | undefined
  let nextProjects: Record<ProjectId, Project> | undefined
  const newEvents: SimEvent[] = []
  let nextEventIndex = ctx.nextEventIndex

  if (removedPlayIds.size > 0) {
    for (const playIdStr of removedPlayIds) {
      const playId = playIdStr as DiplomaticPlayId
      const pressureIds = ctx.state.pressureIndex.byDiplomaticPlay[playId]
      if (!pressureIds) continue
      for (const pid of pressureIds) {
        const pressure = (nextPressures ?? ctx.state.pressures)[pid]
        if (!pressure) continue
        if (!nextPressures) nextPressures = { ...ctx.state.pressures }
        if (!nextPressureIndex) {
          nextPressureIndex = {
            byTarget: { ...ctx.state.pressureIndex.byTarget },
            bySource: { ...ctx.state.pressureIndex.bySource },
            byDiplomaticPlay: { ...ctx.state.pressureIndex.byDiplomaticPlay },
            byProject: { ...ctx.state.pressureIndex.byProject },
          }
        }

        if (pressure.responseProjectId) {
          const base = nextProjects ?? ctx.state.projects
          const respProject = base[pressure.responseProjectId]
          if (respProject && respProject.status === 'active') {
            if (!nextProjects) nextProjects = { ...ctx.state.projects }
            nextProjects[pressure.responseProjectId] = { ...respProject, status: 'cancelled' }
          }
        }

        if (pressure.relatedProjectId) {
          const base = nextProjects ?? ctx.state.projects
          const initProject = base[pressure.relatedProjectId]
          if (initProject && initProject.status === 'active') {
            if (!nextProjects) nextProjects = { ...ctx.state.projects }
            nextProjects[pressure.relatedProjectId] = { ...initProject, status: 'cancelled' }
          }
        }

        const play = plays[playId]
        const eventType = play?.status === 'cancelled' ? 'PRESSURE_CANCELLED' : 'PRESSURE_RESOLVED'
        const sourceNameKey = getDecisionSubjectNameKey(ctx.state, pressure.source)
        const targetNameKey = getDecisionSubjectNameKey(ctx.state, pressure.target)
        const eventId = `e-${ctx.state.absoluteWeek}-${nextEventIndex}` as EventId
        nextEventIndex++
        newEvents.push({
          id: eventId,
          year: ctx.state.currentYear,
          weekOfYear: ctx.state.currentWeekOfYear,
          type: eventType,
          importance: 'minor',
          messageKey:
            eventType === 'PRESSURE_CANCELLED' ? 'pressure.cancelled' : 'pressure.resolved',
          messageParams: {
            source: nameParam(pressure.source.kind, sourceNameKey),
            target: nameParam(pressure.target.kind, targetNameKey),
          },
          entityRefs: [
            entityRef(pressure.source.kind, pressure.source.id, 'source', sourceNameKey),
            entityRef(pressure.target.kind, pressure.target.id, 'target', targetNameKey),
          ],
          reasons: [],
          effects: [],
        })

        removePressureFromIndexMut(
          { pressureIndex: nextPressureIndex } as unknown as WorldState,
          pressure,
        )
        delete nextPressures[pid]
      }
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

  const log = createLogger(ctx.config.debug)
  if (removedPlayIds.size > 0 || nextPressures || nextProjects) {
    let cancelledProjectCount = 0
    if (nextProjects) {
      for (const [idStr, proj] of Object.entries(nextProjects)) {
        const orig = ctx.state.projects[idStr as ProjectId]
        if (orig && orig.status === 'active' && proj?.status === 'cancelled')
          cancelledProjectCount++
      }
    }
    let removedPressureCount = 0
    if (nextPressures) {
      for (const pid of Object.keys(ctx.state.pressures)) {
        if (!(pid in nextPressures)) removedPressureCount++
      }
    }
    log.log('CLEANUP_DIPLOMACY', {
      removedPlays: removedPlayIds.size,
      cancelledProjects: cancelledProjectCount,
      removedPressures: removedPressureCount,
    })
  }

  if (
    !nextPlays &&
    !nextAims &&
    !nextGoals &&
    !taskCleanedState &&
    !nextLandContracts &&
    !nextPressures &&
    !nextPressureIndex &&
    !nextProjects &&
    newEvents.length === 0
  )
    return ctx

  const baseState = taskCleanedState ?? ctx.state
  return {
    ...ctx,
    state: {
      ...baseState,
      diplomaticPlays: nextPlays ?? baseState.diplomaticPlays,
      aims: nextAims ?? baseState.aims,
      goals: nextGoals ?? baseState.goals,
      landContracts: nextLandContracts ?? baseState.landContracts,
      pressures: nextPressures ?? baseState.pressures,
      pressureIndex: nextPressureIndex ?? baseState.pressureIndex,
      projects: nextProjects ?? baseState.projects,
    },
    events: newEvents.length > 0 ? [...ctx.events, ...newEvents] : ctx.events,
    nextEventIndex,
  }
}

function isPersonAlive(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  return person !== undefined && person.alive && person.kind !== 'placeholder'
}

function getDecisionSubjectNameKey(state: WorldState, ref: DecisionSubjectRef): string {
  if (ref.kind === 'polity') return state.polities[ref.id]?.nameKey ?? ref.id
  if (ref.kind === 'house') return state.houses[ref.id]?.nameKey ?? ref.id
  return state.persons[ref.id]?.nameKey ?? ref.id
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
