import type { TickContext, CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import { isLivingPerson } from '../types/person'
import { getOwnerNameKey } from '../utils/ownerNames'
import type { SimulationConfig } from '../config/defaultConfig'
import type {
  DevelopHoldingProject,
  LandClaimProject,
  ContractRevisionProject,
  RespondToPressureProject,
} from '../types/project'
import type { DecisionSubjectRef } from '../types/goal'
import type { EventId, PersonId, ProjectId } from '../types/ids'
import type { PressureKind } from '../types/pressure'
import type { PressureResponseStance } from '../types/pressure'
import type { DiplomaticDemand } from '../types/diplomaticPlay'
import type { OrganizationRef } from '../types/office'
import {
  removeProjectFromIndexMut,
  addProjectToIndexMut,
  getProjectDeadlineWeeks,
} from '../mutations/projectMutations'
import {
  buildExistingPlayKeys,
  createDiplomaticPlayFromProjectMut,
} from '../mutations/diplomaticPlayCreation'
import { createPressureMut } from '../mutations/pressureMutations'
import { vacateHoldingBailiff, appointHoldingBailiff } from '../mutations/provinceOfficeMutations'
import {
  getProjectStageType,
  getNextProjectStageKey,
  getInitialProjectStageKey,
  isProjectStageValid,
} from '../config/projectStageSequences'
import { findBailiffCandidateForProject } from './projectStageHelpers'
import { getActorMilitaryPower } from '../selectors/actorSelectors'
import { createDiplomaticOfferMut } from '../mutations/diplomaticOfferMutations'
import { clamp } from '../utils/math'
import { createLogger } from '../debug/logger'

export function runProjectStageSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek

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

  const ws: WorldState = {
    ...ctx.state,
    projects: { ...ctx.state.projects },
    polities: { ...ctx.state.polities },
    diplomaticPlays: { ...ctx.state.diplomaticPlays },
    aims: { ...ctx.state.aims },
    holdingOfficeAssignments: { ...ctx.state.holdingOfficeAssignments },
    holdingOfficeIndex: {
      ...ctx.state.holdingOfficeIndex,
      byHolding: { ...ctx.state.holdingOfficeIndex.byHolding },
      byHolderPerson: { ...ctx.state.holdingOfficeIndex.byHolderPerson },
      byAppointingPolity: { ...ctx.state.holdingOfficeIndex.byAppointingPolity },
    },
    projectIndex: {
      byOwner: { ...ctx.state.projectIndex.byOwner },
      byAim: { ...ctx.state.projectIndex.byAim },
      byParentProject: { ...ctx.state.projectIndex.byParentProject },
      byCreatorPerson: { ...ctx.state.projectIndex.byCreatorPerson },
      bySupervisorPerson: { ...ctx.state.projectIndex.bySupervisorPerson },
      byRelatedEntity: { ...ctx.state.projectIndex.byRelatedEntity },
    },
    pressures: { ...ctx.state.pressures },
    pressureIndex: {
      byTarget: { ...ctx.state.pressureIndex.byTarget },
      bySource: { ...ctx.state.pressureIndex.bySource },
      byDiplomaticPlay: { ...ctx.state.pressureIndex.byDiplomaticPlay },
      byProject: { ...ctx.state.pressureIndex.byProject },
    },
  }

  for (const [pid, project] of Object.entries(ws.projects)) {
    if (!project || project.status !== 'active') continue

    if (!project.currentStageKey || !isProjectStageValid(project)) {
      ws.projects[pid as ProjectId] = {
        ...project,
        currentStageKey: getInitialProjectStageKey(project.kind),
      }
    }

    resolveImmediateStages(ws, config, pid as ProjectId, absoluteWeek, emitEvent)
  }

  return {
    ...ctx,
    state: ws,
    events: [...ctx.events, ...newEvents],
    nextEventIndex,
  }
}

export function resolveImmediateStages(
  ws: WorldState,
  config: SimulationConfig,
  projectId: ProjectId,
  absoluteWeek: number,
  emitEvent?: (input: CreateSimEventInput) => void,
): void {
  // When called from taskSystem without emitEvent, use no-op
  const emit = emitEvent ?? (() => {})
  const maxIterations = 5
  for (let i = 0; i < maxIterations; i++) {
    const project = ws.projects[projectId]
    if (!project || project.status !== 'active') break

    const stageType = getProjectStageType(project.kind, project.currentStageKey)
    if (stageType !== 'immediate') break

    const resolved = resolveImmediateStage(ws, config, projectId, absoluteWeek, emit)
    if (!resolved) break
  }
}

function resolveImmediateStage(
  ws: WorldState,
  config: SimulationConfig,
  projectId: ProjectId,
  absoluteWeek: number,
  emitEvent: (input: CreateSimEventInput) => void,
): boolean {
  const project = ws.projects[projectId]
  if (!project || project.status !== 'active') return false

  if (project.kind === 'develop_holding') {
    if (project.currentStageKey === 'find_supervisor') {
      return resolveFindSupervisor(ws, config, project, projectId, absoluteWeek)
    }
    if (project.currentStageKey === 'secure_budget') {
      return resolveSecureBudget(ws, config, project, projectId, absoluteWeek)
    }
  }

  if (project.currentStageKey === 'open_diplomatic_play') {
    return resolveOpenDiplomaticPlay(ws, config, projectId, absoluteWeek, emitEvent)
  }

  if (project.kind === 'respond_to_pressure' && project.currentStageKey === 'choose_stance') {
    return resolveChooseStance(ws, config, project, projectId)
  }

  if (
    project.kind === 'respond_to_pressure' &&
    project.currentStageKey === 'propose_initial_offer'
  ) {
    return resolveProposalInitialOffer(ws, config, project, projectId)
  }

  return false
}

function resolveFindSupervisor(
  ws: WorldState,
  config: SimulationConfig,
  project: DevelopHoldingProject,
  projectId: ProjectId,
  absoluteWeek: number,
): boolean {
  const holdingId = project.holdingId
  const officeId = ws.holdingOfficeIndex.byHolding[holdingId]
  let supervisorId: PersonId | undefined

  if (officeId) {
    const assignment = ws.holdingOfficeAssignments[officeId]
    if (assignment?.active) {
      const holder = ws.persons[assignment.holderPersonId]
      if (isLivingPerson(holder)) {
        supervisorId = assignment.holderPersonId
      }
    }
  }

  if (!supervisorId) {
    supervisorId = findBailiffCandidateForProject(ws, project)
    if (!supervisorId) return false

    const tp = ws.holdingTerminalPolityCache[holdingId]
    if (!tp) return false

    const vacated = vacateHoldingBailiff(
      {
        ...ws,
        holdingOfficeAssignments: { ...ws.holdingOfficeAssignments },
        holdingOfficeIndex: {
          ...ws.holdingOfficeIndex,
          byHolding: { ...ws.holdingOfficeIndex.byHolding },
          byHolderPerson: { ...ws.holdingOfficeIndex.byHolderPerson },
          byAppointingPolity: { ...ws.holdingOfficeIndex.byAppointingPolity },
        },
      },
      holdingId,
    )
    const { state: appointed } = appointHoldingBailiff(vacated, {
      holdingId,
      holderPersonId: supervisorId,
      appointingPolityId: tp,
      week: absoluteWeek,
    })
    ws.holdingOfficeAssignments = appointed.holdingOfficeAssignments
    ws.holdingOfficeIndex = appointed.holdingOfficeIndex
    ws.nextHoldingOfficeAssignmentId = appointed.nextHoldingOfficeAssignmentId
  }

  const currentOfficeId = ws.holdingOfficeIndex.byHolding[holdingId]
  if (currentOfficeId) {
    const a = ws.holdingOfficeAssignments[currentOfficeId]
    if (a) {
      const protectedUntil = Math.max(
        a.termProtectedUntilWeek ?? 0,
        project.deadlineWeek ?? absoluteWeek,
      )
      ws.holdingOfficeAssignments = {
        ...ws.holdingOfficeAssignments,
        [currentOfficeId]: { ...a, termProtectedUntilWeek: protectedUntil },
      }
    }
  }

  const nextKey = getNextProjectStageKey(project)
  if (!nextKey) return false

  const log = createLogger(config.debug)
  log.log('PROJECT_STAGE', {
    projectId,
    kind: project.kind,
    from: project.currentStageKey,
    to: nextKey,
  })

  removeProjectFromIndexMut(ws, project)
  const updated: DevelopHoldingProject = {
    ...project,
    supervisorPersonId: supervisorId,
    currentStageKey: nextKey,
  }
  ws.projects[projectId] = updated
  addProjectToIndexMut(ws, updated)
  return true
}

function resolveSecureBudget(
  ws: WorldState,
  config: SimulationConfig,
  project: DevelopHoldingProject,
  projectId: ProjectId,
  absoluteWeek: number,
): boolean {
  if (project.owner.kind !== 'polity') return false
  const polityId = project.owner.id
  const polity = ws.polities[polityId]
  if (!polity || polity.treasury < project.budget.required) return false

  ws.polities = {
    ...ws.polities,
    [polityId]: { ...polity, treasury: polity.treasury - project.budget.required },
  }

  const executionDeadline =
    absoluteWeek + getProjectDeadlineWeeks(config, 'develop_holding', project.targetProgress)

  const nextKey = getNextProjectStageKey(project)
  if (!nextKey) return false

  const log = createLogger(config.debug)
  log.log('PROJECT_STAGE', {
    projectId,
    kind: project.kind,
    from: project.currentStageKey,
    to: nextKey,
  })

  ws.projects[projectId] = {
    ...project,
    budget: {
      ...project.budget,
      allocated: project.budget.required,
      remaining: project.budget.required,
    },
    currentStageKey: nextKey,
    deadlineWeek: executionDeadline,
  }
  return true
}

function resolveOpenDiplomaticPlay(
  ws: WorldState,
  config: SimulationConfig,
  projectId: ProjectId,
  _absoluteWeek: number,
  emitEvent: (input: CreateSimEventInput) => void,
): boolean {
  const project = ws.projects[projectId]
  if (!project || project.status !== 'active') return false

  const existingPlayKeys = buildExistingPlayKeys(ws)
  const result = createDiplomaticPlayFromProjectMut(
    ws,
    config,
    project,
    existingPlayKeys,
    emitEvent,
  )

  if (result.kind === 'created') {
    const play = ws.diplomaticPlays[result.playId]
    if (!play) return false

    const nextKey = getNextProjectStageKey(project)
    if (!nextKey) return false

    const log = createLogger(config.debug)
    log.log('PROJECT_STAGE', {
      projectId,
      kind: project.kind,
      from: project.currentStageKey,
      to: nextKey,
      action: 'open_diplomatic_play',
      playId: result.playId,
    })

    const updatedProject: LandClaimProject | ContractRevisionProject = {
      ...(project as LandClaimProject | ContractRevisionProject),
      currentStageKey: nextKey,
      diplomaticPlayId: result.playId,
      deadlineWeek: play.deadlineWeek,
    }
    ws.projects[projectId] = updatedProject

    const pressureKind: PressureKind =
      project.kind === 'acquire_land' || project.kind === 'sell_land'
        ? 'diplomatic_land_claim'
        : 'diplomatic_contract_revision'

    const sourceRef: DecisionSubjectRef =
      play.initiator.kind === 'polity'
        ? { kind: 'polity', id: play.initiator.id }
        : { kind: 'house', id: play.initiator.id }
    const targetRef: DecisionSubjectRef =
      play.target.kind === 'polity'
        ? { kind: 'polity', id: play.target.id }
        : { kind: 'house', id: play.target.id }

    createPressureMut(ws, {
      kind: pressureKind,
      source: sourceRef,
      target: targetRef,
      relatedDiplomaticPlayId: result.playId,
      relatedProjectId: projectId,
      priority: 1,
      createdWeek: ws.absoluteWeek,
      deadlineWeek: play.deadlineWeek,
      status: 'active',
      reasonIds: [],
    })

    const sourceNameKey = getOwnerNameKey(ws, sourceRef)
    const targetNameKey = getOwnerNameKey(ws, targetRef)
    emitEvent({
      type: 'PRESSURE_CREATED',
      importance: 'minor',
      messageKey: 'pressure.created',
      messageParams: {
        source: nameParam(sourceRef.kind, sourceNameKey),
        target: nameParam(targetRef.kind, targetNameKey),
      },
      entityRefs: [
        entityRef(sourceRef.kind, sourceRef.id, 'source', sourceNameKey),
        entityRef(targetRef.kind, targetRef.id, 'target', targetNameKey),
      ],
    })

    return true
  }

  if (result.kind === 'duplicate') {
    ws.projects[projectId] = { ...project, status: 'failed' as const }
    const ownerNameKey = getOwnerNameKey(ws, project.owner)
    emitEvent({
      type: 'PROJECT_FAILED',
      importance: 'minor',
      messageKey: 'project.failed.duplicate_play',
      messageParams: {
        owner: nameParam(project.owner.kind, ownerNameKey),
        kind: project.kind,
      },
      entityRefs: [],
    })
    return true
  }

  // invalid_inputs: retry next tick
  return false
}

function resolveChooseStance(
  ws: WorldState,
  config: SimulationConfig,
  project: RespondToPressureProject,
  projectId: ProjectId,
): boolean {
  const pressure = ws.pressures[project.pressureId]
  if (!pressure) return false

  if (pressure.target.kind === 'person') return false

  const targetActor: OrganizationRef =
    pressure.target.kind === 'polity'
      ? { kind: 'polity', id: pressure.target.id }
      : { kind: 'house', id: pressure.target.id }

  let stance: PressureResponseStance = 'negotiate'

  if (pressure.source.kind !== 'person') {
    const sourceActor: OrganizationRef =
      pressure.source.kind === 'polity'
        ? { kind: 'polity', id: pressure.source.id }
        : { kind: 'house', id: pressure.source.id }
    const targetPower = getActorMilitaryPower(ws, config, targetActor)
    const sourcePower = getActorMilitaryPower(ws, config, sourceActor)

    if (targetPower < sourcePower * 0.5) {
      stance = 'concede'
    } else if (targetPower >= sourcePower * 1.2) {
      stance = 'resist'
    }
  }

  const nextKey = getNextProjectStageKey(project)
  if (!nextKey) return false

  const log = createLogger(config.debug)
  log.log('PROJECT_STAGE', {
    projectId,
    kind: project.kind,
    from: project.currentStageKey,
    to: nextKey,
    action: 'choose_stance',
    stance,
  })

  removeProjectFromIndexMut(ws, project)
  const updated: RespondToPressureProject = {
    ...project,
    stance,
    currentStageKey: nextKey,
  }
  ws.projects[projectId] = updated
  addProjectToIndexMut(ws, updated)
  return true
}

function resolveProposalInitialOffer(
  ws: WorldState,
  config: SimulationConfig,
  project: RespondToPressureProject,
  projectId: ProjectId,
): boolean {
  if (!project.diplomaticPlayId) {
    const nextKey = getNextProjectStageKey(project)
    if (!nextKey) return false
    removeProjectFromIndexMut(ws, project)
    const updated1: RespondToPressureProject = { ...project, currentStageKey: nextKey }
    ws.projects[projectId] = updated1
    addProjectToIndexMut(ws, updated1)
    return true
  }

  const play = ws.diplomaticPlays[project.diplomaticPlayId]
  if (!play || play.status !== 'active' || !play.currentOfferId) {
    const nextKey = getNextProjectStageKey(project)
    if (!nextKey) return false
    removeProjectFromIndexMut(ws, project)
    const updated2: RespondToPressureProject = { ...project, currentStageKey: nextKey }
    ws.projects[projectId] = updated2
    addProjectToIndexMut(ws, updated2)
    return true
  }

  const stance: PressureResponseStance = project.stance ?? 'negotiate'
  const currentOffer = ws.diplomaticOffers[play.currentOfferId]
  const demands: DiplomaticDemand[] = []

  if (play.kind === 'land_claim') {
    if (stance === 'concede') {
      // Copy initiator's demands (transfer + same pay_wealth amount)
      if (currentOffer) {
        for (const d of currentOffer.demands) {
          demands.push(d)
        }
      }
    } else if (stance === 'negotiate') {
      if (currentOffer) {
        const payDemand = currentOffer.demands.find((d) => d.kind === 'pay_wealth')
        if (payDemand && payDemand.kind === 'pay_wealth') {
          // Copy transfer demands
          for (const d of currentOffer.demands) {
            if (d.kind === 'transfer_land_contract') {
              demands.push(d)
            }
          }
          // Demand higher price (x1.3)
          demands.push({
            kind: 'pay_wealth',
            from: payDemand.from,
            to: payDemand.to,
            amount: Math.round(payDemand.amount * 1.3),
          })
        } else {
          demands.push({ kind: 'status_quo' })
        }
      } else {
        demands.push({ kind: 'status_quo' })
      }
    } else {
      // resist
      demands.push({ kind: 'status_quo' })
    }
  } else if (play.kind === 'contract_tax_revision') {
    if (stance === 'concede') {
      // Copy the change_contract_tax_rate demand as-is
      if (currentOffer) {
        for (const d of currentOffer.demands) {
          demands.push(d)
        }
      }
    } else if (stance === 'negotiate') {
      // Create change_contract_tax_rate with halfway rate
      const issue = play.issue
      if (issue?.kind === 'contract_tax_revision') {
        const halfwayRate = (issue.baseTaxRateToGrantor + issue.desiredTaxRateToGrantor) / 2
        demands.push({
          kind: 'change_contract_tax_rate',
          holdingId: issue.holdingId,
          landContractId: issue.landContractId,
          newTaxRateToGrantor: halfwayRate,
        })
      } else {
        demands.push({ kind: 'status_quo' })
      }
    } else {
      // resist
      demands.push({ kind: 'status_quo' })
    }
  }

  if (demands.length === 0) {
    demands.push({ kind: 'status_quo' })
  }

  // Target creates a counter-offer
  createDiplomaticOfferMut(ws, play.id, play.target, demands, [])

  // Update play progress
  const updatedPlay = ws.diplomaticPlays[play.id]
  if (updatedPlay) {
    ws.diplomaticPlays[play.id] = {
      ...updatedPlay,
      progress: clamp(updatedPlay.progress + config.counterOfferProgressDelta, 0, 100),
    }
  }

  const nextKey = getNextProjectStageKey(project)
  if (!nextKey) return false

  const log = createLogger(config.debug)
  log.log('PROJECT_STAGE', {
    projectId,
    kind: project.kind,
    from: project.currentStageKey,
    to: nextKey,
    action: 'propose_initial_offer',
    stance,
  })

  removeProjectFromIndexMut(ws, project)
  const updated: RespondToPressureProject = {
    ...project,
    currentStageKey: nextKey,
  }
  ws.projects[projectId] = updated
  addProjectToIndexMut(ws, updated)
  return true
}
