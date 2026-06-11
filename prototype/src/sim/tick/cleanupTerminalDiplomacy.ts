import type { TickContext, CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { awardDiplomaticPlayOutcomeMut } from '../helpers/awardHelpers'
import { nameParam, entityRef } from '../types/event'
import type {
  AimId,
  GoalId,
  DiplomaticPlayId,
  DiplomaticOfferId,
  PressureId,
  ProjectId,
  PersonId,
} from '../types/ids'
import type { EventId } from '../types/ids'
import type { DiplomaticPlay, DiplomaticOffer } from '../types/diplomaticPlay'
import type { OrganizationRef } from '../types/office'
import type { DecisionSubjectRef } from '../types/goal'
import { getOwnerNameRefForEmit } from '../utils/ownerNames'
import type { LandContractId, HoldingId } from '../types/ids'
import type { LandContract, Holding } from '../types/landContract'
import type { Project } from '../types/project'
import type { Pressure, PressureIndex } from '../types/pressure'
import type { WorldState } from '../types/world'
import { getDiplomaticPlayDelegate } from '../selectors/taskSelectors'
import { removeTask } from '../mutations/taskMutations'
import { isLivingPerson } from '../types/person'
import { removePressureFromIndexMut } from '../mutations/pressureMutations'
import { createLogger } from '../debug/logger'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import {
  TERMINAL_DIPLOMATIC_PLAY_STATUSES,
  type TerminalDiplomaticPlayStatus,
} from '../types/diplomaticPlay'

const TERMINAL_PLAY_SET = new Set<TerminalDiplomaticPlayStatus>(TERMINAL_DIPLOMATIC_PLAY_STATUSES)

function isActorActive(state: WorldState, actor: OrganizationRef): boolean {
  if (actor.kind === 'polity') {
    return state.polities[actor.id]?.active === true
  }
  return state.houses[actor.id]?.active === true
}

export function runCleanupTerminalDiplomacy(ctx: TickContext): TickContext {
  const plays = ctx.state.diplomaticPlays

  let nextPlays: Record<DiplomaticPlayId, DiplomaticPlay> | undefined
  const removedPlayIds = new Set<string>()
  const offerIdsToDelete = new Set<DiplomaticOfferId>()
  // v0.44 §7: terminal play の削除直前 award 対象 (この cleanup 以外に安全な処理地点はない §13.2)
  const awardPlays: DiplomaticPlay[] = []
  for (const idStr of Object.keys(plays)) {
    const play = plays[idStr as DiplomaticPlayId]
    if (!play) continue
    if (!isActorActive(ctx.state, play.initiator) || !isActorActive(ctx.state, play.target)) {
      if (!nextPlays) nextPlays = { ...plays }
      delete nextPlays[idStr as DiplomaticPlayId]
      removedPlayIds.add(idStr)
      collectPlayOfferIds(play, offerIdsToDelete)
      continue
    }
    if (TERMINAL_PLAY_SET.has(play.status as TerminalDiplomaticPlayStatus)) {
      if (!nextPlays) nextPlays = { ...plays }
      delete nextPlays[idStr as DiplomaticPlayId]
      removedPlayIds.add(idStr)
      collectPlayOfferIds(play, offerIdsToDelete)
      // v0.44 §7.1: terminal status での削除のみ award 対象 (actor-inactive 削除は対象外。
      //   そちらは play が active のまま削除される — 上の分岐で continue 済み)。
      //   terminalOutcome 未設定 (= セット漏れ) も skip — integrity §12.3 が検出する。
      if (play.terminalOutcome !== undefined) {
        awardPlays.push(play)
      }
    }
  }

  // v0.30 Phase C: cascade-delete offers for removed plays
  let nextOffers: Record<DiplomaticOfferId, DiplomaticOffer> | undefined
  if (offerIdsToDelete.size > 0) {
    for (const offerId of offerIdsToDelete) {
      if (ctx.state.diplomaticOffers[offerId]) {
        if (!nextOffers) nextOffers = { ...ctx.state.diplomaticOffers }
        delete nextOffers[offerId]
      }
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

  // v0.43 §15.1: active play の inactive supporter を無音除去する (play は継続)。
  //   primary (initiator/target) inactive は上の既存経路で play ごと削除済み。
  {
    const base = nextPlays ?? plays
    for (const idStr of Object.keys(base)) {
      const play = base[idStr as DiplomaticPlayId]
      if (!play) continue
      if (TERMINAL_PLAY_SET.has(play.status as TerminalDiplomaticPlayStatus)) continue
      const initKeep = play.initiatorSupporters.filter((s) => isActorActive(ctx.state, s.actor))
      const targKeep = play.targetSupporters.filter((s) => isActorActive(ctx.state, s.actor))
      if (
        initKeep.length !== play.initiatorSupporters.length ||
        targKeep.length !== play.targetSupporters.length
      ) {
        if (!nextPlays) nextPlays = { ...plays }
        nextPlays[idStr as DiplomaticPlayId] = {
          ...play,
          initiatorSupporters: initKeep,
          targetSupporters: targKeep,
        }
      }
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
            nextProjects[pressure.responseProjectId] = {
              ...respProject,
              status: 'cancelled',
              terminalReason: 'play_terminal',
            }
          }
        }

        if (pressure.relatedProjectId) {
          const base = nextProjects ?? ctx.state.projects
          const initProject = base[pressure.relatedProjectId]
          if (initProject && initProject.status === 'active') {
            if (!nextProjects) nextProjects = { ...ctx.state.projects }
            nextProjects[pressure.relatedProjectId] = {
              ...initProject,
              status: 'cancelled',
              terminalReason: 'play_terminal',
            }
          }
        }

        const play = plays[playId]
        const eventType = play?.status === 'cancelled' ? 'PRESSURE_CANCELLED' : 'PRESSURE_RESOLVED'
        const sourceRef = getOwnerNameRefForEmit(ctx.state, pressure.source)
        const targetRef = getOwnerNameRefForEmit(ctx.state, pressure.target)
        const sourceNameKey = sourceRef.nameKey
        const targetNameKey = targetRef.nameKey
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
            source: nameParam(sourceRef.category, sourceNameKey),
            target: nameParam(targetRef.category, targetNameKey),
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
      if (!play.issue || play.issue.kind !== 'contract_tax_revision') continue
      const contractId = play.issue.landContractId
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

  // v0.47.3 §6.69: Set holding grace period for terminal land_claim plays (税制改定と対称)。
  //   outcome で絞らない (税制改定も絞らない): 勝った holding は自所有になり findAcquire が
  //   自所有を skip するため demands_met/escalated_to_war を含めても安全。失敗した請求を毎年
  //   再生成する churn (同一 holding を ~1.5 年ごとに再請求) を 5 年止める。
  let nextHoldings: Record<HoldingId, Holding> | undefined
  if (removedPlayIds.size > 0) {
    const landClaimGraceWeeks = ctx.config.landClaimGracePeriodYears * WEEKS_PER_YEAR
    for (const playIdStr of removedPlayIds) {
      const play = plays[playIdStr as DiplomaticPlayId]
      if (!play || play.kind !== 'land_claim') continue
      if (!play.issue || play.issue.kind !== 'land_claim') continue
      const holdingId = play.issue.holdingId
      const base = nextHoldings ?? ctx.state.holdings
      const holding = base[holdingId]
      if (!holding) continue
      if (!nextHoldings) nextHoldings = { ...ctx.state.holdings }
      nextHoldings[holdingId] = {
        ...holding,
        landClaimProtectedUntilWeek: ctx.state.absoluteWeek + landClaimGraceWeeks,
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
    !nextHoldings &&
    !nextOffers &&
    !nextPressures &&
    !nextPressureIndex &&
    !nextProjects &&
    newEvents.length === 0
  )
    return ctx

  const baseState = taskCleanedState ?? ctx.state
  let resultCtx: TickContext = {
    ...ctx,
    state: {
      ...baseState,
      diplomaticPlays: nextPlays ?? baseState.diplomaticPlays,
      diplomaticOffers: nextOffers ?? baseState.diplomaticOffers,
      aims: nextAims ?? baseState.aims,
      goals: nextGoals ?? baseState.goals,
      landContracts: nextLandContracts ?? baseState.landContracts,
      holdings: nextHoldings ?? baseState.holdings,
      pressures: nextPressures ?? baseState.pressures,
      pressureIndex: nextPressureIndex ?? baseState.pressureIndex,
      projects: nextProjects ?? baseState.projects,
    },
    events: newEvents.length > 0 ? [...ctx.events, ...newEvents] : ctx.events,
    nextEventIndex,
  }

  // v0.44 §7: 削除した terminal play の delegate へ経験・評判を付与する (§13.2: terminal 化と
  //   同 tick 削除のため、この cleanup 内が唯一の安全な処理地点)。play エンティティは state から
  //   削除済みだが、award はローカルに保持した play オブジェクトで行う。
  if (awardPlays.length > 0) {
    const ws: WorldState = { ...resultCtx.state, persons: { ...resultCtx.state.persons } }
    let rng = resultCtx.rng
    const awardEvents: SimEvent[] = []
    let awardEventIndex = resultCtx.nextEventIndex
    const emitAwardEvent = (input: CreateSimEventInput): void => {
      const id = `e-${ws.absoluteWeek}-${awardEventIndex}` as EventId
      awardEventIndex++
      awardEvents.push({
        id,
        year: ws.currentYear,
        weekOfYear: ws.currentWeekOfYear,
        type: input.type,
        importance: input.importance,
        messageKey: input.messageKey,
        messageParams: input.messageParams,
        entityRefs: input.entityRefs ?? [],
        reasons: input.reasons ?? [],
        effects: input.effects ?? [],
      })
    }
    // 反復順は play id 昇順に固定 (決定性 §13.5)
    const sortedPlays = [...awardPlays].sort((a, b) => (a.id as string).localeCompare(b.id))
    for (const play of sortedPlays) {
      rng = awardDiplomaticPlayOutcomeMut(ws, ctx.config, play, rng, emitAwardEvent)
    }
    resultCtx = {
      ...resultCtx,
      state: ws,
      rng,
      events: awardEvents.length > 0 ? [...resultCtx.events, ...awardEvents] : resultCtx.events,
      nextEventIndex: awardEventIndex,
    }
  }
  return resultCtx
}

function isPersonAlive(state: WorldState, personId: PersonId): boolean {
  return isLivingPerson(state.persons[personId])
}

function collectPlayOfferIds(play: DiplomaticPlay, out: Set<DiplomaticOfferId>): void {
  for (const offerId of play.offerHistoryIds) out.add(offerId)
  if (play.currentOfferId && !out.has(play.currentOfferId)) out.add(play.currentOfferId)
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
    return isLivingPerson(state.persons[owner.id])
  }
  return false
}
