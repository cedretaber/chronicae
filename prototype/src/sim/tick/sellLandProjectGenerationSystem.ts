import type { TickContext } from './context'
import type { CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import { decisionSubjectKey } from '../types/goal'
import type { WorldState } from '../types/world'
import type { Project } from '../types/project'
import type { EventId, ProjectId } from '../types/ids'
import { createProjectId } from '../types/ids'
import { getPolityLeader } from '../selectors/officeSelectors'
import { selectProjectSupervisor } from '../selectors/projectSelectors'
import { findSellLandCandidates } from '../selectors/landPurchaseCandidates'
import { addProjectToIndexMut, getProjectDeadlineWeeks } from '../mutations/projectMutations'
import { selectTargetHoldingInProvince } from '../selectors/landContractSelectors'

export function runSellLandProjectGenerationSystem(ctx: TickContext): TickContext {
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

  const candidates = findSellLandCandidates(ws)

  const existingKeys = new Set<string>()
  for (const [, project] of Object.entries(ws.projects)) {
    if (!project || project.status !== 'active') continue
    if (project.kind !== 'sell_land') continue
    const ownerKey = decisionSubjectKey(project.owner)
    const counterpartyId = project.counterpartyPolityId
    const holdingId = project.holdingId
    if (counterpartyId && holdingId) {
      existingKeys.add(`${ownerKey}|${counterpartyId}|${holdingId}`)
    }
  }

  for (const candidate of candidates) {
    const sellerPolityId = candidate.sellerPolityId
    const buyerPolityId = candidate.buyerPolityId
    const provinceId = candidate.provinceId

    const holdingId = selectTargetHoldingInProvince(ws, provinceId)
    if (!holdingId) continue

    const dedupeKey = `polity:${sellerPolityId}|${buyerPolityId}|${holdingId}`
    if (existingKeys.has(dedupeKey)) continue

    const creatorId = getPolityLeader(ws, sellerPolityId)
    if (!creatorId) continue

    const owner = { kind: 'polity' as const, id: sellerPolityId }
    const supervisorId =
      selectProjectSupervisor(ws, config, owner, 'sell_land', creatorId) ?? creatorId

    const projectId: ProjectId = createProjectId(ws.nextProjectId)
    const deadlineWeeks = getProjectDeadlineWeeks(
      config,
      'sell_land',
      config.projectDefaultTargetProgress,
    )

    const project: Project = {
      id: projectId,
      owner,
      origin: { kind: 'system', reasonKey: 'fiscal_pressure' },
      kind: 'sell_land',
      creatorPersonId: creatorId,
      supervisorPersonId: supervisorId,
      status: 'active',
      progress: 0,
      targetProgress: config.projectDefaultTargetProgress,
      createdWeek: absoluteWeek,
      deadlineWeek: absoluteWeek + deadlineWeeks,
      reasonIds: [],
      holdingId,
      provinceId,
      counterpartyPolityId: buyerPolityId,
      preparation: 0,
      leverage: 0,
      commitment: 0,
    }

    ws.projects[projectId] = project
    ws.nextProjectId++
    addProjectToIndexMut(ws, project)
    existingKeys.add(dedupeKey)

    const sellerNameKey = ws.polities[sellerPolityId]?.nameKey ?? sellerPolityId
    const buyerNameKey = ws.polities[buyerPolityId]?.nameKey ?? buyerPolityId
    emitEvent({
      type: 'PROJECT_STARTED',
      importance: 'minor',
      messageKey: 'project.sell_land.started',
      messageParams: {
        seller: nameParam('polity', sellerNameKey),
        buyer: nameParam('polity', buyerNameKey),
        kind: 'sell_land',
      },
      entityRefs: [
        entityRef('polity', sellerPolityId, 'seller', sellerNameKey),
        entityRef('polity', buyerPolityId, 'buyer', buyerNameKey),
      ],
    })
  }

  return {
    ...ctx,
    state: ws,
    events: [...ctx.events, ...newEvents],
    nextEventIndex,
  }
}
