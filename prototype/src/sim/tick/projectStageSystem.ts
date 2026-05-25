import type { TickContext, CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type {
  DevelopHoldingProject,
  LandClaimProject,
  ContractRevisionProject,
} from '../types/project'
import type { DecisionSubjectRef } from '../types/goal'
import type { EventId, PersonId, ProjectId } from '../types/ids'
import {
  removeProjectFromIndexMut,
  addProjectToIndexMut,
  getProjectDeadlineWeeks,
} from '../mutations/projectMutations'
import {
  buildExistingPlayKeys,
  createDiplomaticPlayFromProjectMut,
} from '../mutations/diplomaticPlayCreation'
import { vacateHoldingBailiff, appointHoldingBailiff } from '../mutations/provinceOfficeMutations'
import {
  getProjectStageType,
  getNextProjectStageKey,
  getInitialProjectStageKey,
  isProjectStageValid,
} from '../config/projectStageSequences'
import { findBailiffCandidateForProject } from './projectStageHelpers'

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

  // Phase C: choose_stance handler will be implemented here
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
      if (holder?.alive && holder.kind !== 'placeholder') {
        supervisorId = assignment.holderPersonId
      }
    }
  }

  if (!supervisorId) {
    supervisorId = findBailiffCandidateForProject(ws, config, project)
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

    // Set diplomaticPlayId and sync deadline with play
    const updatedProject: LandClaimProject | ContractRevisionProject = {
      ...(project as LandClaimProject | ContractRevisionProject),
      currentStageKey: nextKey,
      diplomaticPlayId: result.playId,
      deadlineWeek: play.deadlineWeek,
    }
    ws.projects[projectId] = updatedProject
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

function getOwnerNameKey(ws: WorldState, owner: DecisionSubjectRef): string {
  if (owner.kind === 'polity') return ws.polities[owner.id]?.nameKey ?? owner.id
  if (owner.kind === 'house') return ws.houses[owner.id]?.nameKey ?? owner.id
  return ws.persons[owner.id]?.nameKey ?? owner.id
}
