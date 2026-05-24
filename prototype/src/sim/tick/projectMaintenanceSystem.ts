import type { TickContext } from './context'
import type { CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { DecisionSubjectRef } from '../types/goal'
import type { WorldState } from '../types/world'
import type { EventId } from '../types/ids'
import { selectProjectSupervisor } from '../selectors/projectSelectors'
import { removeProjectFromIndexMut, addProjectToIndexMut } from '../mutations/projectMutations'

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

  for (const [, project] of Object.entries(ws.projects)) {
    if (!project || project.status !== 'active') continue

    // 1. Supervisor dead → re-select, fail if can't
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

    // 2. Owner disappeared → cancelled
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

    // 3. Origin aim non-active → cancelled
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

    // 4. Deadline exceeded
    if (
      project.deadlineWeek &&
      absoluteWeek >= project.deadlineWeek &&
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
      owner: nameParam(owner.kind, ownerNameKey),
      kind: projectKind,
    },
    entityRefs: [entityRef(owner.kind, owner.id, 'owner', ownerNameKey)],
  })
}

function getOwnerNameKey(ws: WorldState, owner: DecisionSubjectRef): string {
  if (owner.kind === 'polity') return ws.polities[owner.id]?.nameKey ?? owner.id
  if (owner.kind === 'house') return ws.houses[owner.id]?.nameKey ?? owner.id
  return ws.persons[owner.id]?.nameKey ?? owner.id
}
