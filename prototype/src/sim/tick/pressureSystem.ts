import type { TickContext, CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import type { RespondToPressureProject } from '../types/project'
import type { EventId, ProjectId } from '../types/ids'
import { createProjectId } from '../types/ids'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import { setPressureResponseProjectMut } from '../mutations/pressureMutations'
import { getPolityLeader } from '../selectors/officeSelectors'
import { selectProjectSupervisor } from '../selectors/projectSelectors'
import { getInitialProjectStageKey } from '../config/projectStageSequences'

export function runPressureSystem(ctx: TickContext): TickContext {
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
    pressures: { ...ctx.state.pressures },
    pressureIndex: {
      byTarget: { ...ctx.state.pressureIndex.byTarget },
      bySource: { ...ctx.state.pressureIndex.bySource },
      byDiplomaticPlay: { ...ctx.state.pressureIndex.byDiplomaticPlay },
      byProject: { ...ctx.state.pressureIndex.byProject },
    },
    projects: { ...ctx.state.projects },
    projectIndex: {
      byOwner: { ...ctx.state.projectIndex.byOwner },
      byAim: { ...ctx.state.projectIndex.byAim },
      byParentProject: { ...ctx.state.projectIndex.byParentProject },
      byCreatorPerson: { ...ctx.state.projectIndex.byCreatorPerson },
      bySupervisorPerson: { ...ctx.state.projectIndex.bySupervisorPerson },
      byRelatedEntity: { ...ctx.state.projectIndex.byRelatedEntity },
    },
  }

  for (const [, pressure] of Object.entries(ws.pressures)) {
    if (!pressure || pressure.status !== 'active') continue
    if (pressure.responseProjectId) continue

    if (pressure.target.kind !== 'polity') continue
    const polityId = pressure.target.id
    const leaderId = getPolityLeader(ws, polityId)
    if (!leaderId) continue
    const leader = ws.persons[leaderId]
    if (!leader || !leader.alive || leader.kind === 'placeholder') continue

    const supervisorId =
      selectProjectSupervisor(ws, config, pressure.target, 'respond_to_pressure', leaderId) ??
      leaderId

    let deadlineWeek: number | undefined
    if (pressure.relatedDiplomaticPlayId) {
      const play = ws.diplomaticPlays[pressure.relatedDiplomaticPlayId]
      if (play) deadlineWeek = play.deadlineWeek
    }
    if (deadlineWeek === undefined) {
      deadlineWeek = absoluteWeek + config.pressureResponseDefaultDeadlineWeeks
    }

    const projectId: ProjectId = createProjectId(ws.nextProjectId)
    ws.nextProjectId++

    const project: RespondToPressureProject = {
      id: projectId,
      owner: pressure.target,
      origin: { kind: 'system', reasonKey: 'pressure_response' },
      kind: 'respond_to_pressure',
      creatorPersonId: leaderId,
      supervisorPersonId: supervisorId,
      pressureId: pressure.id,
      ...(pressure.relatedDiplomaticPlayId !== undefined && {
        diplomaticPlayId: pressure.relatedDiplomaticPlayId,
      }),
      ...(pressure.relatedProjectId !== undefined && {
        parentProjectId: pressure.relatedProjectId,
      }),
      status: 'active',
      progress: 0,
      targetProgress: config.projectDefaultTargetProgress,
      currentStageKey: getInitialProjectStageKey('respond_to_pressure'),
      createdWeek: absoluteWeek,
      deadlineWeek,
      reasonIds: [],
    }

    ws.projects[projectId] = project
    addProjectToIndexMut(ws, project)
    setPressureResponseProjectMut(ws, pressure.id, projectId)

    const ownerNameKey = ws.polities[polityId]?.nameKey ?? polityId
    emitEvent({
      type: 'PROJECT_STARTED',
      importance: 'minor',
      messageKey: 'project.started',
      messageParams: {
        owner: nameParam('polity', ownerNameKey),
        kind: 'respond_to_pressure',
      },
      entityRefs: [entityRef('polity', polityId, 'owner', ownerNameKey)],
    })
  }

  if (newEvents.length === 0 && ws.nextProjectId === ctx.state.nextProjectId) return ctx

  return {
    ...ctx,
    state: ws,
    events: [...ctx.events, ...newEvents],
    nextEventIndex,
  }
}
