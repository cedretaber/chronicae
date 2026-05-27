import type { TickContext } from './context'
import type { CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { Aim, PersonAimKind, DecisionSubjectRef, EntityRef } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type {
  Task,
  TaskOutcomeKind,
  TaskKind,
  TaskTargetRef,
  PersonActivityLog,
  PersonActivityKind,
  AbilityTrainingExperience,
} from '../types/task'
import { targetRefKey } from '../types/task'
import type { WorldState } from '../types/world'
import type {
  DiplomaticPlay,
  DiplomaticDemand,
  ContractTaxRevisionIssue,
} from '../types/diplomaticPlay'
import type { PoliticalActorRef } from '../types/actor'
import type {
  PersonId,
  DiplomaticPlayId,
  TaskId,
  AimId,
  PersonActivityLogId,
  EventId,
  HoldingId,
  LandContractId,
  PolityId,
} from '../types/ids'
import { createTaskId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import type { AbilityKey } from '../types/person'
import type { ProjectId } from '../types/ids'
import type {
  Project,
  LandClaimProject,
  ContractRevisionProject,
  ProjectBudget,
  ProjectKind,
} from '../types/project'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { HoldingKind } from '../types/landContract'
import { getHoldingImprovementLevel } from '../selectors/holdingImprovementSelectors'
import { createProjectId } from '../types/ids'
import { clamp } from '../utils/math'
import {
  addProjectToIndexMut,
  aimKindToProjectKind,
  isDiplomaticProjectKind,
  getProjectDeadlineWeeks,
} from '../mutations/projectMutations'
import { selectProjectSupervisor } from '../selectors/projectSelectors'
import { getProvinceHoldings, getLandContractGrantor } from '../selectors/landContractSelectors'
import {
  getPersonWeeklyActionCapacity,
  computeWeeklyEffort,
  computeEffectivePriority,
  getTaskRelevantAbility,
  getTaskActionCost,
  getTaskEffortRequired,
  getTaskDefaultDifficulty,
  getTaskDefaultRelevantAbility,
  getNextTaskKind,
  checkEntityExists,
  isEntityTerminal,
  determineTaskOutcome,
} from '../selectors/taskSelectors'
import type { RngState } from '../rng/rng'
import {
  getInitialProjectStageKey,
  getProjectStageType,
  getNextProjectStageKey,
} from '../config/projectStageSequences'
import { resolveImmediateStages } from './projectStageSystem'
import { createDiplomaticOfferMut } from '../mutations/diplomaticOfferMutations'
import { computeLandClaimCompensation } from './diplomaticOfferEvaluation'
import { createLogger } from '../debug/logger'

// --- Types ---

type EffortUpdate = { taskId: TaskId; newEffortDone: number }
type CompletedTaskInfo = { task: Task; personId: PersonId }

// --- isDecisionSubjectActive ---

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

// --- Pure helpers ---

function getAbilityFromAimTarget(target: EntityRef | undefined): AbilityKey | undefined {
  if (!target || target.kind !== 'ability') return undefined
  return target.ability
}

function getAimDeadlineWeeks(config: SimulationConfig, kind: PersonAimKind): number {
  if (kind === 'obtain_office') return config.personAimDeadlineObtainOffice
  if (kind === 'retain_office') return config.personAimDeadlineRetainOffice
  return config.personAimDeadlineDefault
}

function getDiplomaticEffectMultiplier(state: WorldState, task: Task): number {
  const person = state.persons[task.assigneePersonId]
  if (!person) return 1.0
  const ability = getTaskRelevantAbility(task.kind)
  const abilityValue = person.abilities[ability]
  return 0.5 + abilityValue / 100
}

// --- Mutable helpers ---

function removeTaskMut(ws: WorldState, taskId: TaskId): void {
  const task = ws.tasks[taskId]
  if (!task) return

  const ownerKey = decisionSubjectKey(task.owner)
  const targetKey = targetRefKey(task.targetRef)
  const assigneeKey = task.assigneePersonId as string

  delete ws.tasks[taskId]

  const byAssignee = ws.taskIndex.byAssignee[assigneeKey]
  if (byAssignee) {
    const filtered = byAssignee.filter((id) => (id as string) !== (taskId as string))
    if (filtered.length > 0) ws.taskIndex.byAssignee[assigneeKey] = filtered
    else delete ws.taskIndex.byAssignee[assigneeKey]
  }
  const byOwner = ws.taskIndex.byOwner[ownerKey]
  if (byOwner) {
    const filtered = byOwner.filter((id) => (id as string) !== (taskId as string))
    if (filtered.length > 0) ws.taskIndex.byOwner[ownerKey] = filtered
    else delete ws.taskIndex.byOwner[ownerKey]
  }
  const byTarget = ws.taskIndex.byTarget[targetKey]
  if (byTarget) {
    const filtered = byTarget.filter((id) => (id as string) !== (taskId as string))
    if (filtered.length > 0) ws.taskIndex.byTarget[targetKey] = filtered
    else delete ws.taskIndex.byTarget[targetKey]
  }
}

function createTaskMut(
  ws: WorldState,
  config: SimulationConfig,
  input: {
    owner: DecisionSubjectRef
    assigneePersonId: PersonId
    kind: TaskKind
    targetRef: TaskTargetRef
    absoluteWeek: number
    deadlineWeek?: number
    difficulty?: number
    relevantAbility?: AbilityKey
  },
): Task {
  const taskId = createTaskId(ws.nextTaskId)
  const task: Task = {
    id: taskId,
    owner: input.owner,
    assigneePersonId: input.assigneePersonId,
    kind: input.kind,
    targetRef: input.targetRef,
    priority: 1,
    actionCost: getTaskActionCost(config, input.kind),
    effortRequired: getTaskEffortRequired(config, input.kind),
    effortDone: 0,
    createdWeek: input.absoluteWeek,
    ...(input.deadlineWeek !== undefined ? { deadlineWeek: input.deadlineWeek } : {}),
    status: 'active',
    reasonIds: [],
    difficulty: input.difficulty ?? getTaskDefaultDifficulty(input.kind),
    relevantAbility: input.relevantAbility ?? getTaskDefaultRelevantAbility(input.kind),
  }

  const ownerKey = decisionSubjectKey(input.owner)
  const targetKey = targetRefKey(input.targetRef)
  const assigneeKey = input.assigneePersonId as string

  ws.tasks[taskId] = task
  ws.taskIndex.byAssignee[assigneeKey] = [...(ws.taskIndex.byAssignee[assigneeKey] ?? []), taskId]
  ws.taskIndex.byOwner[ownerKey] = [...(ws.taskIndex.byOwner[ownerKey] ?? []), taskId]
  ws.taskIndex.byTarget[targetKey] = [...(ws.taskIndex.byTarget[targetKey] ?? []), taskId]
  ws.nextTaskId++

  return task
}

function createNextTaskMut(
  ws: WorldState,
  config: SimulationConfig,
  aim: Aim,
  previousTaskKind: TaskKind | undefined,
): Task | undefined {
  const personId = aim.owner.kind === 'person' ? aim.owner.id : undefined
  if (!personId) return undefined

  const taskKind = getNextTaskKind(aim.kind as PersonAimKind, previousTaskKind)
  if (!taskKind) return undefined

  return createTaskMut(ws, config, {
    owner: aim.owner,
    assigneePersonId: personId,
    kind: taskKind,
    targetRef: { kind: 'aim', id: aim.id },
    absoluteWeek: ws.absoluteWeek,
  })
}

function createActivityLogMut(
  ws: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  task: Task,
  outcome: TaskOutcomeKind,
): void {
  const logId = `al-${ws.nextPersonActivityLogId}` as PersonActivityLogId
  const kind: PersonActivityKind =
    outcome === 'success'
      ? 'task_completed'
      : outcome === 'failure'
        ? 'task_failed'
        : 'task_cancelled'

  const log: PersonActivityLog = {
    id: logId,
    personId,
    week: ws.absoluteWeek,
    kind,
    outcome,
    taskKind: task.kind,
    sourceRef: task.targetRef,
    relatedRefs: [],
    summaryKey: `activity.${task.kind}`,
    importance: 10,
  }

  const personKey = personId as string
  const existingLogs = ws.personActivityLogIndex.byPerson[personKey] ?? []

  ws.personActivityLogs[logId] = log
  let newIndex = [...existingLogs, logId]

  if (newIndex.length > config.maxActivityLogsPerPerson) {
    const logsWithMeta = newIndex.map((id) => ({ id, log: ws.personActivityLogs[id] }))
    logsWithMeta.sort((a, b) => {
      if (!a.log || !b.log) return 0
      if (a.log.importance !== b.log.importance) return a.log.importance - b.log.importance
      return a.log.week - b.log.week
    })
    const toRemove = logsWithMeta.slice(0, newIndex.length - config.maxActivityLogsPerPerson)
    for (const r of toRemove) {
      delete ws.personActivityLogs[r.id]
    }
    newIndex = newIndex.filter((id) => ws.personActivityLogs[id] !== undefined)
  }

  ws.personActivityLogIndex.byPerson[personKey] = newIndex
  ws.nextPersonActivityLogId++
}

function removeDiplomaticPlayTaskIdMut(
  ws: WorldState,
  playId: DiplomaticPlayId,
  taskId: TaskId,
): void {
  const play = ws.diplomaticPlays[playId]
  if (!play) return
  ws.diplomaticPlays[playId] = {
    ...play,
    initiatorActiveTaskIds: play.initiatorActiveTaskIds.filter(
      (id) => (id as string) !== (taskId as string),
    ),
    targetActiveTaskIds: play.targetActiveTaskIds.filter(
      (id) => (id as string) !== (taskId as string),
    ),
  }
}

function applyDiplomaticTaskEffectMut(
  ws: WorldState,
  config: SimulationConfig,
  playId: DiplomaticPlayId,
  task: Task,
  side: 'initiator' | 'target',
): void {
  const play = ws.diplomaticPlays[playId]
  if (!play) return

  const updated: DiplomaticPlay = { ...play }
  const mul = getDiplomaticEffectMultiplier(ws, task)

  switch (task.kind) {
    case 'prepare_argument':
      if (side === 'initiator') {
        updated.initiatorPreparation = clamp(
          play.initiatorPreparation + config.diplomaticPlayTaskLeverageGainSmall * mul,
          0,
          100,
        )
      } else {
        updated.targetPreparation = clamp(
          play.targetPreparation + config.diplomaticPlayTaskLeverageGainSmall * mul,
          0,
          100,
        )
      }
      break
    case 'gather_claim_evidence':
      if (side === 'initiator') {
        updated.initiatorLeverage = clamp(
          play.initiatorLeverage + config.diplomaticPlayTaskLeverageGainMedium * mul,
          0,
          100,
        )
      } else {
        updated.targetLeverage = clamp(
          play.targetLeverage + config.diplomaticPlayTaskLeverageGainMedium * mul,
          0,
          100,
        )
      }
      break
    case 'secure_internal_support':
      if (side === 'initiator') {
        updated.initiatorCommitment = clamp(
          play.initiatorCommitment + config.diplomaticPlayTaskCommitmentGainMedium * mul,
          0,
          100,
        )
      } else {
        updated.targetCommitment = clamp(
          play.targetCommitment + config.diplomaticPlayTaskCommitmentGainMedium * mul,
          0,
          100,
        )
      }
      break
    case 'negotiate_terms':
      updated.progress = clamp(play.progress + config.negotiateTermsProgressDelta * mul, 0, 100)
      break
    case 'pressure_counterparty':
      updated.tension = clamp(
        play.tension + config.diplomaticPlayTaskTensionGainMedium * mul,
        0,
        100,
      )
      if (side === 'initiator') {
        updated.targetCommitment = Math.max(
          0,
          play.targetCommitment - config.diplomaticPlayTaskOpponentPressureGainMedium * mul,
        )
      } else {
        updated.initiatorCommitment = Math.max(
          0,
          play.initiatorCommitment - config.diplomaticPlayTaskOpponentPressureGainMedium * mul,
        )
      }
      break
    case 'offer_compromise':
      updated.progress = clamp(play.progress + config.offerCompromiseProgressDelta * mul, 0, 100)
      updated.tension = Math.max(
        0,
        play.tension - config.diplomaticPlayTaskTensionReductionSmall * mul,
      )
      // v0.30: Create compromise offer based on last rejected offer
      buildAndCreateCompromiseOffer(ws, config, play, side)
      break
    case 'undermine_counterparty_position':
      if (side === 'initiator') {
        updated.targetLeverage = Math.max(
          0,
          play.targetLeverage - config.diplomaticPlayTaskOpponentLeverageReductionSmall * mul,
        )
      } else {
        updated.initiatorLeverage = Math.max(
          0,
          play.initiatorLeverage - config.diplomaticPlayTaskOpponentLeverageReductionSmall * mul,
        )
      }
      break
  }

  ws.diplomaticPlays[playId] = updated
}

// --- v0.30: Compromise offer builder ---

const COMPROMISE_ADJUSTMENT = 0.3

export function buildAndCreateCompromiseOffer(
  ws: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: 'initiator' | 'target',
): void {
  // revolt_negotiation plays do not use the offer system
  if (play.kind === 'revolt_negotiation') return
  // Only polity actors can create offers
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') return

  // Determine base offer: lastRejectedOffer > currentOffer > build from issue
  const baseOfferId = play.lastRejectedOfferId ?? play.currentOfferId
  const baseOffer = baseOfferId ? ws.diplomaticOffers[baseOfferId] : undefined
  const baseDemands: DiplomaticDemand[] | undefined = baseOffer?.demands

  const proposedBy: PoliticalActorRef = side === 'initiator' ? play.initiator : play.target

  let adjustedDemands: DiplomaticDemand[] | undefined

  if (play.kind === 'land_claim') {
    adjustedDemands = buildLandClaimCompromiseDemands(ws, config, play, side, baseDemands)
  } else if (play.kind === 'contract_tax_revision') {
    adjustedDemands = buildTaxRevisionCompromiseDemands(ws, config, play, side, baseDemands)
  }

  if (!adjustedDemands || adjustedDemands.length === 0) return

  createDiplomaticOfferMut(ws, play.id, proposedBy, adjustedDemands, [])
}

function buildLandClaimCompromiseDemands(
  ws: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: 'initiator' | 'target',
  baseDemands: DiplomaticDemand[] | undefined,
): DiplomaticDemand[] | undefined {
  if (!play.issue || play.issue.kind !== 'land_claim') return undefined
  const holdingId = play.issue.holdingId

  if (baseDemands) {
    return adjustLandClaimDemands(ws, config, play, side, baseDemands, holdingId)
  }

  // No base offer — create a default: transfer + pay using computeLandClaimCompensation
  const compensation = computeLandClaimCompensation(ws, config, holdingId)
  const demands: DiplomaticDemand[] = [
    {
      kind: 'transfer_land_contract',
      holdingId,
      toPolityId: play.initiator.id as PolityId,
    },
    {
      kind: 'pay_wealth',
      from: play.initiator,
      to: play.target,
      amount: Math.round(compensation),
    },
  ]
  return demands
}

function adjustLandClaimDemands(
  ws: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: 'initiator' | 'target',
  baseDemands: DiplomaticDemand[],
  holdingId: HoldingId,
): DiplomaticDemand[] {
  // Detect whether the base offer is a status_quo offer or a transfer offer.
  // This determines how pay_wealth adjustment works for the target side:
  //   - transfer offer: pay_wealth flows initiator→target (land price); target compromise = decrease
  //   - status_quo offer: pay_wealth flows target→initiator (compensation); target compromise = increase
  const isStatusQuoOffer = baseDemands.some((d) => d.kind === 'status_quo')

  const result: DiplomaticDemand[] = []
  let hasPayWealth = false

  for (const demand of baseDemands) {
    if (demand.kind === 'pay_wealth') {
      hasPayWealth = true
      if (side === 'initiator') {
        // Initiator compromising toward target: increase pay_wealth by 30%
        result.push({
          ...demand,
          amount: Math.round(demand.amount * (1 + COMPROMISE_ADJUSTMENT)),
        })
      } else if (isStatusQuoOffer) {
        // Target compromising on status_quo: increase compensation by 30%
        result.push({
          ...demand,
          amount: Math.round(demand.amount * (1 + COMPROMISE_ADJUSTMENT)),
        })
      } else {
        // Target compromising on transfer: decrease pay_wealth by 30% (cheaper for initiator)
        result.push({
          ...demand,
          amount: Math.round(demand.amount * (1 - COMPROMISE_ADJUSTMENT)),
        })
      }
    } else {
      result.push(demand)
    }
  }

  // If side === 'initiator' and no pay_wealth existed, add one based on compensation
  if (side === 'initiator' && !hasPayWealth) {
    const compensation = computeLandClaimCompensation(ws, config, holdingId)
    result.push({
      kind: 'pay_wealth',
      from: play.initiator,
      to: play.target,
      amount: Math.round(compensation * (1 + COMPROMISE_ADJUSTMENT)),
    })
  }

  return result
}

function buildTaxRevisionCompromiseDemands(
  ws: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: 'initiator' | 'target',
  baseDemands: DiplomaticDemand[] | undefined,
): DiplomaticDemand[] | undefined {
  if (!play.issue || play.issue.kind !== 'contract_tax_revision') return undefined
  const issue = play.issue
  const holdingId = issue.holdingId
  const landContractId = issue.landContractId
  const baseTaxRate = issue.baseTaxRateToGrantor

  if (baseDemands) {
    return adjustTaxRevisionDemands(
      ws,
      config,
      play,
      side,
      baseDemands,
      holdingId,
      landContractId,
      baseTaxRate,
      issue,
    )
  }

  // No base offer — create default: change_contract_tax_rate with rate halfway between base and desired
  const desiredRate = issue.desiredTaxRateToGrantor
  const halfwayRate = clamp(
    (baseTaxRate + desiredRate) / 2,
    config.taxRevisionMinRate,
    config.taxRevisionMaxRate,
  )
  const demands: DiplomaticDemand[] = [
    {
      kind: 'change_contract_tax_rate',
      holdingId,
      landContractId,
      newTaxRateToGrantor: halfwayRate,
    },
  ]
  return demands
}

function adjustTaxRevisionDemands(
  _ws: WorldState,
  config: SimulationConfig,
  _play: DiplomaticPlay,
  _side: 'initiator' | 'target',
  baseDemands: DiplomaticDemand[],
  holdingId: HoldingId,
  landContractId: LandContractId,
  baseTaxRate: number,
  issue: ContractTaxRevisionIssue | undefined,
): DiplomaticDemand[] {
  const result: DiplomaticDemand[] = []
  let hasTaxChange = false

  for (const demand of baseDemands) {
    if (demand.kind === 'change_contract_tax_rate') {
      hasTaxChange = true
      // Move newTaxRateToGrantor 30% toward baseTaxRate (compromise toward status quo)
      const currentRate = demand.newTaxRateToGrantor
      const compromiseRate = clamp(
        currentRate + (baseTaxRate - currentRate) * COMPROMISE_ADJUSTMENT,
        config.taxRevisionMinRate,
        config.taxRevisionMaxRate,
      )
      result.push({
        ...demand,
        newTaxRateToGrantor: compromiseRate,
      })
    } else {
      result.push(demand)
    }
  }

  // If no change_contract_tax_rate in base demands (e.g., status_quo offer),
  // create one with halfway rate
  if (!hasTaxChange) {
    const desiredRate = issue?.desiredTaxRateToGrantor ?? baseTaxRate
    const halfwayRate = clamp(
      (baseTaxRate + desiredRate) / 2,
      config.taxRevisionMinRate,
      config.taxRevisionMaxRate,
    )
    // Replace status_quo with tax change demand
    const nonStatusQuo = result.filter((d) => d.kind !== 'status_quo')
    nonStatusQuo.push({
      kind: 'change_contract_tax_rate',
      holdingId,
      landContractId,
      newTaxRateToGrantor: halfwayRate,
    })
    return nonStatusQuo
  }

  return result
}

// --- System functions ---

function autoCancelTasksMut(ws: WorldState, emitEvent: (input: CreateSimEventInput) => void): void {
  const taskEntries = Object.entries(ws.tasks)

  for (const [, task] of taskEntries) {
    if (!task || task.status !== 'active') continue

    let shouldCancel = false
    let cancelReason: string | undefined

    const assignee = ws.persons[task.assigneePersonId]
    if (!assignee || !assignee.alive || assignee.kind === 'placeholder') {
      shouldCancel = true
      cancelReason = 'assignee_no_longer_available'
    }

    if (!shouldCancel && !isDecisionSubjectActive(ws, task.owner)) {
      shouldCancel = true
      cancelReason = 'owner_inactive'
    }

    if (!shouldCancel && task.targetRef.kind === 'aim') {
      const targetRef: EntityRef = { kind: 'aim', id: task.targetRef.id }
      if (!checkEntityExists(ws, targetRef)) {
        shouldCancel = true
        cancelReason = 'target_removed'
      } else if (isEntityTerminal(ws, targetRef)) {
        shouldCancel = true
        cancelReason = 'target_terminal'
      }
    }

    if (!shouldCancel && task.targetRef.kind === 'diplomatic_play') {
      const play = ws.diplomaticPlays[task.targetRef.id]
      if (!play) {
        shouldCancel = true
        cancelReason = 'target_removed'
      } else if (play.status !== 'active' && play.status !== 'escalated') {
        shouldCancel = true
        cancelReason = 'target_terminal'
      }
    }

    if (!shouldCancel && task.targetRef.kind === 'project') {
      const project = ws.projects[task.targetRef.id]
      if (!project) {
        shouldCancel = true
        cancelReason = 'target_removed'
      } else if (project.status !== 'active') {
        shouldCancel = true
        cancelReason = 'target_terminal'
      }
    }

    if (!shouldCancel && task.targetRef.kind === 'holding_office_assignment') {
      const assignment = ws.holdingOfficeAssignments[task.targetRef.id]
      if (!assignment || !assignment.active) {
        shouldCancel = true
        cancelReason = 'target_removed'
      }
    }

    if (!shouldCancel) continue

    const ownerKey = decisionSubjectKey(task.owner)
    const ownerAimIds = ws.aimIndex.byOwner[ownerKey] ?? []
    let ownerAim: Aim | undefined

    for (const aid of ownerAimIds) {
      const a = ws.aims[aid]
      if (a && a.activeTaskId === task.id) {
        ownerAim = a
        break
      }
    }

    removeTaskMut(ws, task.id)

    if (task.targetRef.kind === 'diplomatic_play') {
      removeDiplomaticPlayTaskIdMut(ws, task.targetRef.id, task.id)
    }

    if (ownerAim) {
      const shouldFailAim =
        ownerAim.kind === 'support_organization_aim' &&
        (cancelReason === 'target_removed' || cancelReason === 'target_terminal')
      ws.aims[ownerAim.id] = {
        ...ownerAim,
        activeTaskId: undefined,
        ...(shouldFailAim
          ? { status: 'failed' as const }
          : cancelReason !== undefined
            ? { blockedReasonKey: cancelReason }
            : {}),
      } as unknown as Aim

      const personId = ownerAim.owner.kind === 'person' ? ownerAim.owner.id : undefined
      if (personId) {
        const person = ws.persons[personId]
        const personNameKey = person?.nameKey ?? personId
        emitEvent({
          type: 'TASK_CANCELLED',
          importance: 'minor',
          messageKey: 'task.cancelled',
          messageParams: {
            person: nameParam('person', personNameKey),
            task: ownerAim.kind,
            reason: cancelReason ?? 'unknown',
          },
          entityRefs: [entityRef('person', personId, 'person', personNameKey)],
        })
      }
    }
  }
}

function failOrphanedSupportAimsMut(
  ws: WorldState,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  const aimEntries = Object.entries(ws.aims)

  for (const [, aim] of aimEntries) {
    if (!aim || aim.status !== 'active') continue
    if (aim.kind !== 'support_organization_aim') continue
    if (!aim.target || aim.target.kind !== 'aim') continue

    const targetAim = ws.aims[aim.target.id]
    if (targetAim && targetAim.status === 'active') continue

    const newStatus = targetAim?.status === 'succeeded' ? 'succeeded' : 'failed'
    ws.aims[aim.id] = { ...aim, status: newStatus, activeTaskId: undefined } as unknown as Aim

    if (aim.activeTaskId) {
      if (ws.tasks[aim.activeTaskId]) {
        removeTaskMut(ws, aim.activeTaskId)
      }
    }

    if (aim.owner.kind === 'person') {
      const person = ws.persons[aim.owner.id]
      const personNameKey = person?.nameKey ?? aim.owner.id
      const evType = newStatus === 'succeeded' ? 'PERSON_AIM_SUCCEEDED' : 'PERSON_AIM_FAILED'
      const evKey = newStatus === 'succeeded' ? 'person.aim.succeeded' : 'person.aim.failed'
      emitEvent({
        type: evType,
        importance: 'minor',
        messageKey: evKey,
        messageParams: {
          owner: nameParam('person', personNameKey),
          kind: aim.kind,
        },
        entityRefs: [entityRef('person', aim.owner.id, 'owner', personNameKey)],
      })
    }
  }
}

function batchComputeEfforts(
  ws: WorldState,
  config: SimulationConfig,
): { effortUpdates: EffortUpdate[]; completed: CompletedTaskInfo[] } {
  const effortUpdates: EffortUpdate[] = []
  const completed: CompletedTaskInfo[] = []

  for (const assigneeKey of Object.keys(ws.taskIndex.byAssignee)) {
    const taskIds = ws.taskIndex.byAssignee[assigneeKey]
    if (!taskIds || taskIds.length === 0) continue

    const personId = assigneeKey as PersonId
    const person = ws.persons[personId]
    if (!person || !person.alive || person.kind === 'placeholder') continue

    const capacity = getPersonWeeklyActionCapacity(ws, config, personId)
    if (capacity <= 0) continue

    let remainingCapacity = capacity

    // Phase 1-a: Schwartzian transform — compute priority once per task
    const prioritized = taskIds
      .map((tid) => {
        const task = ws.tasks[tid]
        if (!task || task.status !== 'active') return undefined
        return { task, priority: computeEffectivePriority(ws, config, task) }
      })
      .filter((x): x is NonNullable<typeof x> => x !== undefined)
      .sort((a, b) => b.priority - a.priority)

    for (const { task } of prioritized) {
      if (task.actionCost > remainingCapacity) continue

      remainingCapacity -= task.actionCost
      const weeklyEffort = computeWeeklyEffort(ws, config, task)
      const newEffortDone = task.effortDone + weeklyEffort

      if (newEffortDone >= task.effortRequired) {
        completed.push({ task, personId })
      } else {
        effortUpdates.push({ taskId: task.id, newEffortDone })
      }
    }
  }

  return { effortUpdates, completed }
}

function handleTaskCompletionMut(
  ws: WorldState,
  config: SimulationConfig,
  originalTask: Task,
  personId: PersonId,
  emitEvent: (input: CreateSimEventInput) => void,
  rng: RngState,
): RngState {
  const task = originalTask
  const { outcome, rng: nextRng } = determineTaskOutcome(ws, config, task, rng)
  rng = nextRng
  const absoluteWeek = ws.absoluteWeek

  const ownerKey = decisionSubjectKey(task.owner)
  const ownerAimIds = ws.aimIndex.byOwner[ownerKey] ?? []
  let ownerAim: Aim | undefined

  for (const aid of ownerAimIds) {
    const a = ws.aims[aid]
    if (a && a.activeTaskId === task.id) {
      ownerAim = a
      break
    }
  }

  if (ownerAim) {
    if (task.kind === 'prepare_project') {
      handlePrepareProjectCompletionMut(
        ws,
        config,
        ownerAim,
        personId,
        absoluteWeek,
        emitEvent,
        outcome,
      )
      createActivityLogMut(ws, config, personId, task, outcome)
      removeTaskMut(ws, task.id)
      return rng
    }

    const aimId = ownerAim.id

    if (outcome !== 'success') {
      createActivityLogMut(ws, config, personId, task, outcome)
      removeTaskMut(ws, task.id)
      ws.aims[aimId] = { ...ownerAim, activeTaskId: undefined } as unknown as Aim
      return rng
    }

    const aimProgress = ownerAim.progress + 1
    const aimSucceeded = aimProgress >= ownerAim.targetProgress

    if (ownerAim.kind === 'improve_ability') {
      const existingExp = ws.personTrainingExperience[personId]
      const trainingExp: AbilityTrainingExperience = existingExp ? { ...existingExp } : {}
      const abilityKey = getAbilityFromAimTarget(ownerAim.target)
      if (abilityKey) {
        trainingExp[abilityKey] = (trainingExp[abilityKey] ?? 0) + config.taskTrainingExperienceGain
        ws.personTrainingExperience[personId] = trainingExp
      }
    }

    if (ownerAim.kind === 'support_organization_aim' && ownerAim.target?.kind === 'aim') {
      const targetOrgAim = ws.aims[ownerAim.target.id]
      if (targetOrgAim && targetOrgAim.status === 'active') {
        const newOrgProgress = Math.min(targetOrgAim.progress + 1, targetOrgAim.targetProgress)
        ws.aims[targetOrgAim.id] = { ...targetOrgAim, progress: newOrgProgress }
      }
    }

    if (ownerAim.kind === 'obtain_office' && task.kind === 'seek_office_support') {
      ws.aims[aimId] = {
        ...ownerAim,
        progress: aimProgress,
        activeTaskId: undefined,
        waitingReasonKey: 'waiting.appointment_cycle',
        nextReviewWeek: absoluteWeek + 12,
        status: aimSucceeded ? 'succeeded' : 'active',
      } as unknown as Aim
      ws.waitingAimIds = [...ws.waitingAimIds, aimId]
    } else if (aimSucceeded) {
      const succeededAim: Aim = {
        ...ownerAim,
        progress: aimProgress,
        status: 'succeeded',
      }
      delete succeededAim.activeTaskId
      ws.aims[aimId] = succeededAim
    } else {
      ws.aims[aimId] = { ...ownerAim, progress: aimProgress }
    }

    createActivityLogMut(ws, config, personId, task, outcome)
    removeTaskMut(ws, task.id)

    const updatedAimCheck = ws.aims[aimId]
    if (updatedAimCheck && updatedAimCheck.status === 'active') {
      const nextTask = createNextTaskMut(ws, config, updatedAimCheck, task.kind)
      if (nextTask) {
        ws.aims[aimId] = { ...updatedAimCheck, activeTaskId: nextTask.id }
      } else {
        ws.aims[aimId] = {
          ...updatedAimCheck,
          activeTaskId: undefined,
        } as unknown as Aim
      }
    } else if (updatedAimCheck && updatedAimCheck.status === 'succeeded') {
      const personIdForEvent =
        updatedAimCheck.owner.kind === 'person' ? updatedAimCheck.owner.id : undefined
      if (personIdForEvent) {
        const person = ws.persons[personIdForEvent]
        const personNameKey = person?.nameKey ?? personIdForEvent
        emitEvent({
          type: 'PERSON_AIM_SUCCEEDED',
          importance: 'major',
          messageKey: 'person.aim.succeeded',
          messageParams: {
            owner: nameParam('person', personNameKey),
            kind: updatedAimCheck.kind,
          },
          entityRefs: [entityRef('person', personIdForEvent, 'owner', personNameKey)],
        })
      }
    }
  } else if (task.targetRef.kind === 'diplomatic_play') {
    const playId = task.targetRef.id
    const play = ws.diplomaticPlays[playId]
    if (play && (play.status === 'active' || play.status === 'escalated')) {
      const isInitiator = play.initiatorActiveTaskIds.some(
        (id) => (id as string) === (task.id as string),
      )
      const side: 'initiator' | 'target' = isInitiator ? 'initiator' : 'target'

      applyDiplomaticTaskEffectMut(ws, config, playId, task, side)

      // Phase B: bridge negotiate task outcome to project progress
      if (play.originProjectId) {
        const originProject = ws.projects[play.originProjectId]
        if (originProject && originProject.status === 'active') {
          const ownerMatchesSide =
            (side === 'initiator' &&
              originProject.owner.kind === play.initiator.kind &&
              (originProject.owner.id as string) === (play.initiator.id as string)) ||
            (side === 'target' &&
              originProject.owner.kind === play.target.kind &&
              (originProject.owner.id as string) === (play.target.id as string))
          if (ownerMatchesSide) {
            const progressGain =
              outcome === 'success'
                ? config.projectAdvanceProgressSuccess
                : outcome === 'partial'
                  ? config.projectAdvanceProgressPartial
                  : config.projectAdvanceProgressFailure
            const newProgress = Math.min(
              originProject.progress + progressGain,
              originProject.targetProgress,
            )
            ws.projects[play.originProjectId] = { ...originProject, progress: newProgress }
          }
        }
      }
      const pressureIdsForPlay = ws.pressureIndex.byDiplomaticPlay[playId]
      if (pressureIdsForPlay) {
        for (const pressureId of pressureIdsForPlay) {
          const pressure = ws.pressures[pressureId]
          if (!pressure || pressure.status !== 'active') continue
          if (!pressure.responseProjectId) continue
          const responseProject = ws.projects[pressure.responseProjectId]
          if (!responseProject || responseProject.status !== 'active') continue
          if (side === 'target') {
            const ownerMatchesTarget =
              responseProject.owner.kind === play.target.kind &&
              (responseProject.owner.id as string) === (play.target.id as string)
            if (ownerMatchesTarget) {
              const progressGain =
                outcome === 'success'
                  ? config.projectAdvanceProgressSuccess
                  : outcome === 'partial'
                    ? config.projectAdvanceProgressPartial
                    : config.projectAdvanceProgressFailure
              const newProgress = Math.min(
                responseProject.progress + progressGain,
                responseProject.targetProgress,
              )
              ws.projects[pressure.responseProjectId] = {
                ...responseProject,
                progress: newProgress,
              }
            }
          }
        }
      }

      removeDiplomaticPlayTaskIdMut(ws, playId, task.id)
    }

    createActivityLogMut(ws, config, personId, task, outcome)
    removeTaskMut(ws, task.id)
  } else if (task.targetRef.kind === 'project') {
    const targetProject = ws.projects[task.targetRef.id]
    const targetStageType = targetProject
      ? getProjectStageType(targetProject.kind, targetProject.currentStageKey)
      : undefined
    if (targetStageType === 'preparatory') {
      handlePreparatoryStageCompletionMut(ws, config, task.targetRef.id, outcome)
    } else {
      handleAdvanceProjectCompletionMut(ws, config, task.targetRef.id, outcome)
    }
    createActivityLogMut(ws, config, personId, task, outcome)
    removeTaskMut(ws, task.id)
  } else {
    removeTaskMut(ws, task.id)
    createActivityLogMut(ws, config, personId, task, outcome)
  }

  return rng
}

function reviewWaitingAimsMut(
  ws: WorldState,
  config: SimulationConfig,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  const absoluteWeek = ws.absoluteWeek
  const waitingIds = ws.waitingAimIds
  if (waitingIds.length === 0) return

  const remainingWaitingIds: AimId[] = []

  for (const aimId of waitingIds) {
    const aim = ws.aims[aimId]
    if (!aim || aim.status !== 'active') continue
    if (!aim.waitingReasonKey) continue
    if (!aim.nextReviewWeek || absoluteWeek < aim.nextReviewWeek) {
      remainingWaitingIds.push(aimId)
      continue
    }

    if (aim.owner.kind !== 'person') continue
    const personId = aim.owner.id
    const person = ws.persons[personId]
    if (!person) continue

    const targetOffice = aim.target
    if (!targetOffice || targetOffice.kind !== 'office') continue

    let officeAssigned = false
    const holderKey = personId as string
    const holderOfficeIds = ws.officeIndex.byHolderPerson[holderKey] ?? []
    for (const oaId of holderOfficeIds) {
      const oa = ws.officeAssignments[oaId]
      if (!oa || !oa.active) continue
      if (
        oa.organization.kind === targetOffice.organization.kind &&
        (oa.organization.id as string) === (targetOffice.organization.id as string) &&
        oa.role === targetOffice.role
      ) {
        officeAssigned = true
        break
      }
    }

    if (officeAssigned) {
      ws.aims[aimId] = { ...aim, status: 'succeeded' }
      const personNameKey = person.nameKey ?? personId
      emitEvent({
        type: 'PERSON_AIM_SUCCEEDED',
        importance: 'major',
        messageKey: 'person.aim.succeeded',
        messageParams: {
          owner: nameParam('person', personNameKey),
          kind: aim.kind,
        },
        entityRefs: [entityRef('person', personId, 'owner', personNameKey)],
      })
    } else {
      const deadlineWeeks = getAimDeadlineWeeks(config, aim.kind as PersonAimKind)
      const deadlineWeek = aim.createdWeek + deadlineWeeks
      if (absoluteWeek >= deadlineWeek) {
        ws.aims[aimId] = { ...aim, status: 'failed' }
        const personNameKey = person.nameKey ?? personId
        emitEvent({
          type: 'PERSON_AIM_FAILED',
          importance: 'minor',
          messageKey: 'person.aim.failed',
          messageParams: {
            owner: nameParam('person', personNameKey),
            kind: aim.kind,
          },
          entityRefs: [entityRef('person', personId, 'owner', personNameKey)],
        })
      } else {
        const personNameKey = person.nameKey ?? personId
        emitEvent({
          type: 'TASK_COMPLETED',
          importance: 'minor',
          messageKey: 'task.review_waiting',
          messageParams: {
            person: nameParam('person', personNameKey),
            kind: aim.kind,
          },
          entityRefs: [entityRef('person', personId, 'person', personNameKey)],
        })
        ws.aims[aimId] = {
          ...aim,
          waitingReasonKey: undefined as unknown as string,
          nextReviewWeek: undefined as unknown as number,
        }
      }
    }
  }

  ws.waitingAimIds = remainingWaitingIds
}

// --- Main ---

export function runTaskSystem(ctx: TickContext): TickContext {
  const config = ctx.config

  // Create mutable working state (shallow copy only of modified collections)
  const ws: WorldState = {
    ...ctx.state,
    tasks: { ...ctx.state.tasks },
    taskIndex: {
      byAssignee: { ...ctx.state.taskIndex.byAssignee },
      byOwner: { ...ctx.state.taskIndex.byOwner },
      byTarget: { ...ctx.state.taskIndex.byTarget },
    },
    aims: { ...ctx.state.aims },
    projects: { ...ctx.state.projects },
    projectIndex: {
      byOwner: { ...ctx.state.projectIndex.byOwner },
      byAim: { ...ctx.state.projectIndex.byAim },
      byParentProject: { ...ctx.state.projectIndex.byParentProject },
      byCreatorPerson: { ...ctx.state.projectIndex.byCreatorPerson },
      bySupervisorPerson: { ...ctx.state.projectIndex.bySupervisorPerson },
      byRelatedEntity: { ...ctx.state.projectIndex.byRelatedEntity },
    },
    diplomaticPlays: { ...ctx.state.diplomaticPlays },
    personActivityLogs: { ...ctx.state.personActivityLogs },
    personActivityLogIndex: {
      ...ctx.state.personActivityLogIndex,
      byPerson: { ...ctx.state.personActivityLogIndex.byPerson },
    },
    personTrainingExperience: { ...ctx.state.personTrainingExperience },
    waitingAimIds: [...ctx.state.waitingAimIds],
  }

  // Event accumulator
  const newEvents: SimEvent[] = []
  let nextEventIndex = ctx.nextEventIndex

  function emitEvent(input: CreateSimEventInput): void {
    const id = `e-${ws.absoluteWeek}-${nextEventIndex}` as EventId
    nextEventIndex++
    newEvents.push({
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

  // Step 1: Auto-cancel invalid tasks
  autoCancelTasksMut(ws, emitEvent)

  // Step 1.5: Fail orphaned support aims
  failOrphanedSupportAimsMut(ws, emitEvent)

  // Step 2: Batch effort computation (Schwartzian transform)
  const { effortUpdates, completed } = batchComputeEfforts(ws, config)

  // Step 3: Apply effort updates
  for (const { taskId, newEffortDone } of effortUpdates) {
    const task = ws.tasks[taskId]
    if (task) {
      ws.tasks[taskId] = { ...task, effortDone: newEffortDone }
    }
  }

  // Step 4: Process completed tasks
  let rng = ctx.rng
  for (const { task, personId } of completed) {
    rng = handleTaskCompletionMut(ws, config, task, personId, emitEvent, rng)
  }

  // Step 5: Review waiting aims
  reviewWaitingAimsMut(ws, config, emitEvent)

  // Debug summary
  const log = createLogger(config.debug)
  if (config.debug) {
    let activeRemaining = 0
    for (const t of Object.values(ws.tasks)) {
      if (t?.status === 'active') activeRemaining++
    }
    log.log('TASK_SUMMARY', {
      completed: completed.length,
      activeRemaining,
    })
  }

  // Return final state (single immutable construction)
  return {
    ...ctx,
    state: ws,
    rng,
    events: [...ctx.events, ...newEvents],
    nextEventIndex,
  }
}

// --- prepare_project completion ---

function handlePrepareProjectCompletionMut(
  ws: WorldState,
  config: SimulationConfig,
  aim: Aim,
  creatorPersonId: PersonId,
  absoluteWeek: number,
  emitEvent: (input: CreateSimEventInput) => void,
  outcome: TaskOutcomeKind,
): void {
  const projectKind = aimKindToProjectKind(aim.kind)
  if (!projectKind) {
    ws.aims[aim.id] = { ...aim, activeTaskId: undefined } as unknown as Aim
    return
  }

  if (outcome === 'failure') {
    ws.aims[aim.id] = { ...aim, activeTaskId: undefined } as unknown as Aim
    return
  }

  const fields = buildProjectFieldsForAim(ws, config, aim, projectKind)
  if (!fields) {
    ws.aims[aim.id] = { ...aim, activeTaskId: undefined } as unknown as Aim
    return
  }

  const supervisorId =
    selectProjectSupervisor(ws, config, aim.owner, projectKind, creatorPersonId) ?? creatorPersonId

  const projectId: ProjectId = createProjectId(ws.nextProjectId)
  const targetProgress =
    outcome === 'partial'
      ? config.projectDefaultTargetProgress + config.prepareProjectPartialTargetProgressPenalty
      : config.projectDefaultTargetProgress
  const deadlineWeeks = getProjectDeadlineWeeks(config, projectKind, targetProgress)
  const deadlineWeek = aim.deadlineWeek
    ? Math.min(aim.deadlineWeek, absoluteWeek + deadlineWeeks)
    : absoluteWeek + deadlineWeeks

  const project: Project = {
    id: projectId,
    owner: aim.owner,
    origin: { kind: 'aim', aimId: aim.id },
    kind: projectKind,
    creatorPersonId,
    supervisorPersonId: supervisorId,
    status: 'active',
    progress: 0,
    targetProgress,
    createdWeek: absoluteWeek,
    deadlineWeek,
    reasonIds: [...aim.reasonIds],
    ...fields,
  } as Project

  ws.projects[projectId] = project
  ws.nextProjectId++
  addProjectToIndexMut(ws, project)

  resolveImmediateStages(ws, config, projectId, absoluteWeek)

  ws.aims[aim.id] = { ...aim, activeTaskId: undefined } as unknown as Aim

  const ownerNameKey = getOwnerNameKeyForProject(ws, aim.owner)
  emitEvent({
    type: 'PROJECT_STARTED',
    importance: 'minor',
    messageKey: 'project.started',
    messageParams: {
      owner: nameParam(aim.owner.kind, ownerNameKey),
      kind: projectKind,
    },
    entityRefs: [entityRef(aim.owner.kind, aim.owner.id, 'owner', ownerNameKey)],
  })
}

function selectImprovementKind(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  holdingKind: HoldingKind,
): HoldingImprovementKind | undefined {
  const maxByKind = config.holdingImprovementMaxLevelByHoldingKind[holdingKind]
  const kinds: HoldingImprovementKind[] = [
    'agricultural_infrastructure',
    'urban_infrastructure',
    'storage_infrastructure',
    'transport_infrastructure',
  ]
  let bestKind: HoldingImprovementKind | undefined
  let bestLevel = Infinity
  for (const k of kinds) {
    const maxLevel = maxByKind[k]
    const curLevel = getHoldingImprovementLevel(ws, holdingId, k)
    if (curLevel >= maxLevel) continue
    if (curLevel < bestLevel) {
      bestLevel = curLevel
      bestKind = k
    }
  }
  return bestKind
}

function buildProjectFieldsForAim(
  ws: WorldState,
  config: SimulationConfig,
  aim: Aim,
  projectKind: string,
): Record<string, unknown> | undefined {
  switch (projectKind) {
    case 'develop_holding': {
      const holdingId = aim.target?.kind === 'holding' ? aim.target.id : undefined
      if (!holdingId) return undefined
      const holding = ws.holdings[holdingId]
      if (!holding) return undefined

      const improvementKind = selectImprovementKind(ws, config, holdingId, holding.kind)
      if (!improvementKind) return undefined

      const currentLevel = getHoldingImprovementLevel(ws, holdingId, improvementKind)
      const targetLevel = currentLevel + 1

      const baseCost = config.developHoldingProjectBaseCostByImprovementKind[improvementKind]
      const costMult = config.improvementLevelCostMultiplier[targetLevel] ?? 1
      const required = baseCost * costMult * config.projectBudgetMarginMultiplier

      const baseProgress =
        config.developHoldingProjectBaseProgressByImprovementKind[improvementKind]
      const progMult = config.improvementLevelProgressMultiplier[targetLevel] ?? 1

      return {
        holdingId,
        improvementKind,
        targetImprovementLevel: targetLevel,
        currentStageKey: getInitialProjectStageKey('develop_holding'),
        budget: {
          required,
          allocated: 0,
          remaining: 0,
          spent: 0,
          source: { kind: 'owner' },
        } satisfies ProjectBudget,
        targetProgress: baseProgress * progMult,
      }
    }
    case 'expand_polity_share': {
      const polityId = aim.target?.kind === 'polity' ? aim.target.id : undefined
      const houseId = aim.owner.kind === 'house' ? aim.owner.id : undefined
      return {
        polityId,
        houseId,
        budget: config.expandPolityShareCost,
        spentBudget: 0,
        currentStageKey: getInitialProjectStageKey('expand_polity_share'),
      }
    }
    case 'promote_policy_shift': {
      const polityId = aim.target?.kind === 'polity' ? aim.target.id : undefined
      const houseId = aim.owner.kind === 'house' ? aim.owner.id : undefined
      return {
        polityId,
        houseId,
        currentStageKey: getInitialProjectStageKey('promote_policy_shift'),
      }
    }
    case 'patronize_artist': {
      const houseId = aim.owner.kind === 'house' ? aim.owner.id : undefined
      return {
        houseId,
        budget: config.patronizeArtistCost,
        spentBudget: 0,
        currentStageKey: getInitialProjectStageKey('patronize_artist'),
      }
    }
    case 'commission_chronicle': {
      const houseId = aim.owner.kind === 'house' ? aim.owner.id : undefined
      return {
        houseId,
        budget: config.commissionChronicleCost,
        spentBudget: 0,
        currentStageKey: getInitialProjectStageKey('commission_chronicle'),
      }
    }
    case 'acquire_land': {
      if (aim.owner.kind !== 'polity') return undefined
      const target = findAcquireTargetForProject(ws, aim)
      if (!target) return undefined
      return {
        holdingId: target.holdingId,
        provinceId: target.provinceId,
        counterpartyPolityId: target.targetPolityId,
        preparation: 0,
        leverage: 0,
        commitment: 0,
        currentStageKey: getInitialProjectStageKey('acquire_land'),
      }
    }
    case 'improve_contract_terms': {
      if (aim.owner.kind !== 'polity') return undefined
      const target = findImproveTargetForProject(ws, config, aim)
      if (!target) return undefined
      return {
        holdingId: target.holdingId,
        landContractId: target.contractId,
        counterpartyPolityId: target.targetPolityId,
        preparation: 0,
        leverage: 0,
        commitment: 0,
        currentStageKey: getInitialProjectStageKey('improve_contract_terms'),
      }
    }
    case 'demand_tax_increase': {
      if (aim.owner.kind !== 'polity') return undefined
      const target = findDemandTaxIncreaseTargetForProject(ws, config, aim)
      if (!target) return undefined
      return {
        holdingId: target.holdingId,
        landContractId: target.contractId,
        counterpartyPolityId: target.targetPolityId,
        preparation: 0,
        leverage: 0,
        commitment: 0,
        currentStageKey: getInitialProjectStageKey('demand_tax_increase'),
      }
    }
    default:
      return { currentStageKey: getInitialProjectStageKey(projectKind as ProjectKind) }
  }
}

function findAcquireTargetForProject(
  ws: WorldState,
  aim: Aim,
): { targetPolityId: string; provinceId: string; holdingId: string } | undefined {
  if (aim.owner.kind !== 'polity') return undefined
  const polityId = aim.owner.id
  if (aim.target && aim.target.kind === 'province') {
    const holdings = getProvinceHoldings(ws, aim.target.id)
    for (const h of holdings) {
      const tp = ws.holdingTerminalPolityCache[h.id]
      if (tp && (tp as string) !== (polityId as string)) {
        const targetPolity = ws.polities[tp]
        if (targetPolity && targetPolity.active) {
          return { targetPolityId: tp, provinceId: aim.target.id, holdingId: h.id }
        }
      }
    }
  }
  return undefined
}

function findImproveTargetForProject(
  ws: WorldState,
  _config: SimulationConfig,
  aim: Aim,
): { targetPolityId: string; holdingId?: string; contractId?: string } | undefined {
  if (aim.owner.kind !== 'polity') return undefined
  const polityId = aim.owner.id
  const contractIds = ws.landContractIndex.byGranteePolity[polityId] ?? []
  for (const cid of contractIds) {
    const contract = ws.landContracts[cid]
    if (!contract) continue
    if (contract.termsProtectedUntilWeek && ws.absoluteWeek < contract.termsProtectedUntilWeek)
      continue
    if (contract.terms.taxRateToGrantor <= 0.15) continue
    const grantor = getLandContractGrantor(ws, cid)
    if (!grantor || grantor.kind !== 'polity') continue
    const grantorPolity = ws.polities[grantor.id]
    if (grantorPolity && grantorPolity.active) {
      const holdings = getProvinceHoldings(ws, contract.provinceId)
      const firstHolding = holdings[0]
      const base = { targetPolityId: grantor.id as string, contractId: cid as string }
      if (firstHolding) return { ...base, holdingId: firstHolding.id }
      return base
    }
  }
  return undefined
}

function findDemandTaxIncreaseTargetForProject(
  ws: WorldState,
  config: SimulationConfig,
  aim: Aim,
): { targetPolityId: string; holdingId?: string; contractId?: string } | undefined {
  if (aim.owner.kind !== 'polity') return undefined
  const polityId = aim.owner.id
  const contractIds = ws.landContractIndex.byGranteePolity[polityId] ?? []
  for (const cid of contractIds) {
    const contract = ws.landContracts[cid]
    if (!contract) continue
    const childContractId = ws.landContractIndex.byParent[contract.id]
    if (childContractId === undefined) continue
    const child = ws.landContracts[childContractId]
    if (!child) continue
    if (child.termsProtectedUntilWeek && ws.absoluteWeek < child.termsProtectedUntilWeek) continue
    if (child.terms.taxRateToGrantor >= config.taxRevisionMaxRateForIncrease) continue
    const vassalPolity = ws.polities[child.granteePolityId]
    if (vassalPolity && vassalPolity.active) {
      const holdings = getProvinceHoldings(ws, child.provinceId)
      const firstHolding = holdings[0]
      const base = {
        targetPolityId: child.granteePolityId as string,
        contractId: child.id as string,
      }
      if (firstHolding) return { ...base, holdingId: firstHolding.id }
      return base
    }
  }
  return undefined
}

function getOwnerNameKeyForProject(ws: WorldState, owner: DecisionSubjectRef): string {
  if (owner.kind === 'polity') return ws.polities[owner.id]?.nameKey ?? owner.id
  if (owner.kind === 'house') return ws.houses[owner.id]?.nameKey ?? owner.id
  return ws.persons[owner.id]?.nameKey ?? owner.id
}

// --- advance_project completion ---

function handleAdvanceProjectCompletionMut(
  ws: WorldState,
  config: SimulationConfig,
  projectId: ProjectId,
  outcome: TaskOutcomeKind,
): void {
  const project = ws.projects[projectId]
  if (!project || project.status !== 'active') return

  const progressGain =
    outcome === 'success'
      ? config.projectAdvanceProgressSuccess
      : outcome === 'partial'
        ? config.projectAdvanceProgressPartial
        : config.projectAdvanceProgressFailure
  const newProgress = Math.min(project.progress + progressGain, project.targetProgress)

  if (project.kind === 'develop_holding') {
    const expectedTasks = Math.max(
      1,
      Math.ceil(project.targetProgress / config.projectAdvanceProgressSuccess),
    )
    const consumption =
      project.budget.required / (expectedTasks * config.projectBudgetMarginMultiplier)
    const actualConsumption = Math.min(consumption, project.budget.remaining)
    const newBudget: ProjectBudget = {
      ...project.budget,
      remaining: project.budget.remaining - actualConsumption,
      spent: project.budget.spent + actualConsumption,
    }
    ws.projects[projectId] = { ...project, progress: newProgress, budget: newBudget }
    return
  }

  ws.projects[projectId] = { ...project, progress: newProgress }
}

// --- preparatory stage completion ---

function handlePreparatoryStageCompletionMut(
  ws: WorldState,
  config: SimulationConfig,
  projectId: ProjectId,
  outcome: TaskOutcomeKind,
): void {
  const project = ws.projects[projectId]
  if (!project || project.status !== 'active') return

  if (outcome === 'success') {
    const updated = applyPreparatoryGainMut(project, config, 'full')
    const nextKey = getNextProjectStageKey(updated)
    if (nextKey) {
      const nextProject = { ...updated, currentStageKey: nextKey }
      delete nextProject.stageAttemptCount
      ws.projects[projectId] = nextProject
    } else {
      ws.projects[projectId] = updated
    }
  } else if (outcome === 'partial') {
    ws.projects[projectId] = applyPreparatoryGainMut(project, config, 'partial')
  } else {
    const newCount = (project.stageAttemptCount ?? 0) + 1
    if (newCount >= config.projectStageMaxAttempts) {
      ws.projects[projectId] = { ...project, status: 'failed' }
    } else {
      ws.projects[projectId] = { ...project, stageAttemptCount: newCount }
    }
  }
}

function applyPreparatoryGainMut(
  project: Project,
  config: SimulationConfig,
  level: 'full' | 'partial',
): Project {
  if (!isDiplomaticProjectKind(project.kind)) return project
  if (project.kind === 'respond_to_pressure') return project

  const lcp = project as LandClaimProject | ContractRevisionProject
  const prepGain =
    level === 'full'
      ? config.diplomaticProjectPreparationGainSuccess
      : config.diplomaticProjectPreparationGainPartial
  const levGain =
    level === 'full'
      ? config.diplomaticProjectLeverageGainSuccess
      : config.diplomaticProjectLeverageGainPartial
  const comGain =
    level === 'full'
      ? config.diplomaticProjectCommitmentGainSuccess
      : config.diplomaticProjectCommitmentGainPartial

  return {
    ...lcp,
    preparation: Math.min(lcp.preparation + prepGain, 100),
    leverage: Math.min(lcp.leverage + levGain, 100),
    commitment: Math.min(lcp.commitment + comGain, 100),
  }
}
