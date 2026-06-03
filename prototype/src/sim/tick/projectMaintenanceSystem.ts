import type { TickContext } from './context'
import type { CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { DecisionSubjectRef } from '../types/goal'
import type { WorldState } from '../types/world'
import type { EventId } from '../types/ids'
import type {
  LandClaimProject,
  ContractRevisionProject,
  RespondToPressureProject,
} from '../types/project'
import { selectProjectSupervisor } from '../selectors/projectSelectors'
import { getOwnerNameKey, getOwnerNameRefForEmit } from '../utils/ownerNames'
import {
  removeProjectFromIndexMut,
  addProjectToIndexMut,
  isDiplomaticProjectKind,
} from '../mutations/projectMutations'
import { getProjectStageType } from '../config/projectStageSequences'
import { TERMINAL_DIPLOMATIC_PLAY_STATUSES } from '../types/diplomaticPlay'

const TERMINAL_PLAY_SET = new Set(TERMINAL_DIPLOMATIC_PLAY_STATUSES)

export function runProjectMaintenanceSystem(ctx: TickContext): TickContext {
  const absoluteWeek = ctx.state.absoluteWeek
  const config = ctx.config

  const ws: WorldState = {
    ...ctx.state,
    projects: { ...ctx.state.projects },
    projectIndex: {
      byOwner: { ...ctx.state.projectIndex.byOwner },
      byAim: { ...ctx.state.projectIndex.byAim },
      byParentProject: { ...ctx.state.projectIndex.byParentProject },
      byCreatorPerson: { ...ctx.state.projectIndex.byCreatorPerson },
      bySupervisorPerson: { ...ctx.state.projectIndex.bySupervisorPerson },
      byRelatedEntity: { ...ctx.state.projectIndex.byRelatedEntity },
    },
    aims: { ...ctx.state.aims },
    polities: { ...ctx.state.polities },
    holdingOfficeAssignments: { ...ctx.state.holdingOfficeAssignments },
    holdingOfficeIndex: {
      byHolding: { ...ctx.state.holdingOfficeIndex.byHolding },
      byHolderPerson: { ...ctx.state.holdingOfficeIndex.byHolderPerson },
      byAppointingPolity: { ...ctx.state.holdingOfficeIndex.byAppointingPolity },
    },
  }

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

  for (const [, origProject] of Object.entries(ws.projects)) {
    if (!origProject || origProject.status !== 'active') continue
    const project = origProject

    // 1. Owner disappeared → cancelled
    if (!isOwnerActive(ws, project.owner)) {
      ws.projects[project.id] = { ...project, status: 'cancelled' }
      emitProjectEvent(
        ws,
        project.owner,
        'PROJECT_CANCELLED',
        'project.cancelled.owner_inactive',
        project.kind,
        emitEvent,
      )
      continue
    }

    // 2. Origin aim non-active → cancelled
    if (project.origin.kind === 'aim') {
      const aim = ws.aims[project.origin.aimId]
      if (!aim || aim.status !== 'active') {
        ws.projects[project.id] = { ...project, status: 'cancelled' }
        emitProjectEvent(
          ws,
          project.owner,
          'PROJECT_CANCELLED',
          'project.cancelled.aim_terminal',
          project.kind,
          emitEvent,
        )
        continue
      }
    }

    // 3. Supervisor dead → re-select, fail if can't
    const supervisor = ws.persons[project.supervisorPersonId]
    if (!supervisor || !supervisor.alive || supervisor.kind === 'placeholder') {
      const newSupervisor = selectProjectSupervisor(
        ws,
        config,
        project.owner,
        project.kind,
        project.creatorPersonId,
      )
      if (newSupervisor) {
        removeProjectFromIndexMut(ws, project)
        const updated = { ...project, supervisorPersonId: newSupervisor }
        ws.projects[project.id] = updated
        addProjectToIndexMut(ws, updated)
        continue
      }
      ws.projects[project.id] = { ...project, status: 'failed' }
      emitProjectEvent(
        ws,
        project.owner,
        'PROJECT_FAILED',
        'project.failed.no_supervisor',
        project.kind,
        emitEvent,
      )
      continue
    }

    // 3b. Budget exhausted (develop_holding)
    if (
      project.kind === 'develop_holding' &&
      project.currentStageKey === 'execute_project' &&
      project.budget.remaining <= 0 &&
      project.progress < project.targetProgress
    ) {
      ws.projects[project.id] = { ...project, status: 'failed' }
      emitProjectEvent(
        ws,
        project.owner,
        'PROJECT_FAILED',
        'project.failed.budget',
        project.kind,
        emitEvent,
      )
      continue
    }

    // 3c. Diplomatic project in negotiate stage: play must exist and be active
    if (isDiplomaticProjectKind(project.kind) && project.currentStageKey === 'negotiate') {
      const dpProject = project as
        | LandClaimProject
        | ContractRevisionProject
        | RespondToPressureProject
      const dpPlayId = dpProject.diplomaticPlayId
      if (dpPlayId) {
        const play = ws.diplomaticPlays[dpPlayId]
        if (
          !play ||
          TERMINAL_PLAY_SET.has(play.status as (typeof TERMINAL_DIPLOMATIC_PLAY_STATUSES)[number])
        ) {
          ws.projects[project.id] = { ...project, status: 'cancelled' }
          emitProjectEvent(
            ws,
            project.owner,
            'PROJECT_CANCELLED',
            'project.cancelled.play_terminal',
            project.kind,
            emitEvent,
          )
          continue
        }
      }
    }

    // 4. Deadline exceeded (only applies to final stages)
    const stageType = getProjectStageType(project.kind, project.currentStageKey)
    const deadlineApplies = stageType === 'final'
    if (
      deadlineApplies &&
      project.deadlineWeek &&
      absoluteWeek > project.deadlineWeek &&
      project.progress < project.targetProgress
    ) {
      ws.projects[project.id] = { ...project, status: 'failed' }
      emitProjectEvent(
        ws,
        project.owner,
        'PROJECT_FAILED',
        'project.failed.deadline',
        project.kind,
        emitEvent,
      )
      continue
    }

    // 5. Progress reached
    if (project.progress >= project.targetProgress) {
      ws.projects[project.id] = { ...project, status: 'completed' }
      emitProjectEvent(
        ws,
        project.owner,
        'PROJECT_COMPLETED',
        'project.completed',
        project.kind,
        emitEvent,
      )
      continue
    }
  }

  return {
    ...ctx,
    state: ws,
    events: [...ctx.events, ...newEvents],
    nextEventIndex,
  }
}

function isOwnerActive(ws: WorldState, owner: DecisionSubjectRef): boolean {
  if (owner.kind === 'polity') {
    return ws.polities[owner.id]?.active === true
  }
  if (owner.kind === 'house') {
    const house = ws.houses[owner.id]
    return house !== undefined && house.active
  }
  if (owner.kind === 'person') {
    const person = ws.persons[owner.id]
    return person !== undefined && person.alive
  }
  return false
}

function emitProjectEvent(
  ws: WorldState,
  owner: DecisionSubjectRef,
  type: 'PROJECT_COMPLETED' | 'PROJECT_FAILED' | 'PROJECT_CANCELLED',
  messageKey: string,
  projectKind: string,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  const ownerNameKey = getOwnerNameKey(ws, owner)
  emitEvent({
    type,
    importance: 'minor',
    messageKey,
    messageParams: {
      owner: nameParam(getOwnerNameRefForEmit(ws, owner).category, ownerNameKey),
      kind: projectKind,
    },
    entityRefs: [entityRef(owner.kind, owner.id, 'owner', ownerNameKey)],
  })
}
