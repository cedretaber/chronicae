import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { DevelopHoldingProject } from '../types/project'
import type { PersonId, ProjectId } from '../types/ids'
import {
  removeProjectFromIndexMut,
  addProjectToIndexMut,
  getProjectDeadlineWeeks,
} from '../mutations/projectMutations'
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

  const ws: WorldState = {
    ...ctx.state,
    projects: { ...ctx.state.projects },
    polities: { ...ctx.state.polities },
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

    resolveImmediateStages(ws, config, pid as ProjectId, absoluteWeek)
  }

  return {
    ...ctx,
    state: ws,
  }
}

export function resolveImmediateStages(
  ws: WorldState,
  config: SimulationConfig,
  projectId: ProjectId,
  absoluteWeek: number,
): void {
  const maxIterations = 5
  for (let i = 0; i < maxIterations; i++) {
    const project = ws.projects[projectId]
    if (!project || project.status !== 'active') break

    const stageType = getProjectStageType(project.kind, project.currentStageKey)
    if (stageType !== 'immediate') break

    const resolved = resolveImmediateStage(ws, config, projectId, absoluteWeek)
    if (!resolved) break
  }
}

function resolveImmediateStage(
  ws: WorldState,
  config: SimulationConfig,
  projectId: ProjectId,
  absoluteWeek: number,
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

  // Phase A: other immediate stages (open_diplomatic_play, choose_stance) are no-op stubs
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
