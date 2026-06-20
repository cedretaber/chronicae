import type { TickContext, CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import type {
  RespondToPressureProject,
  EnforceObligationProject,
  EnforceObligationTarget,
} from '../types/project'
import type { Pressure } from '../types/pressure'
import type { EventId, ProjectId, PersonId } from '../types/ids'
import { createProjectId } from '../types/ids'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import { setPressureResponseProjectMut } from '../mutations/pressureMutations'
import { setRealEstateSeizureEnforceMut } from '../mutations/realEstateSeizureMutations'
import { getPolityLeader, getHouseDecisionMaker } from '../selectors/officeSelectors'
import { getPolityNameRefForEmit } from '../selectors/nameRefSelectors'
import { getOwnerNameRefForEmit } from '../utils/ownerNames'
import { selectProjectSupervisor } from '../selectors/projectSelectors'
import { computeOwnerHouseResistance } from '../selectors/realEstateSeizureSelectors'
import { getInitialProjectStageKey } from '../config/projectStageSequences'
import { createLogger } from '../debug/logger'

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
    // v0.53: enforce 起案で activeEnforceProjectId / nextEnforceAllowedWeek を書くため
    //   RealEstateSeizure slice を draft に含める ([[project_mutable_draft_writeback_slices]])。
    realEstateSeizures: { ...ctx.state.realEstateSeizures },
  }

  const log = createLogger(config.debug)

  for (const [, pressure] of Object.entries(ws.pressures)) {
    if (!pressure || pressure.status !== 'active') continue

    // v0.53 §9.2: kind 別 routing。diplomatic_* は既存 respond_to_pressure、obligation 系は
    //   enforce_obligation を起案する (respond_to_pressure に流さない)。
    if (pressure.kind === 'real_estate_seizure' || pressure.kind === 'land_contract_default') {
      maybeCreateEnforceProjectMut(ws, config, pressure, absoluteWeek, emitEvent, log)
      continue
    }

    // --- diplomatic_* (既存経路) ---
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

    log.log('PRESSURE', {
      pressureId: pressure.id,
      responseProjectId: projectId,
      target: `${pressure.target.kind}:${pressure.target.id}`,
    })

    const ownerRef = getPolityNameRefForEmit(ws, polityId)
    const ownerNameKey = ownerRef.nameKey
    emitEvent({
      type: 'PROJECT_STARTED',
      importance: 'minor',
      messageKey: 'project.started',
      messageParams: {
        owner: nameParam(ownerRef.category, ownerNameKey),
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

// v0.53 §9.2/§10: obligation 系 Pressure から enforce_obligation を起案する。
//   strength gate を生成段に置き (B1)、勝ち目が無いなら作らない。再起案 cooldown は
//   entity 側 nextEnforceAllowedWeek (B6)。Phase 1 は real_estate_seizure のみ対応。
function maybeCreateEnforceProjectMut(
  ws: WorldState,
  config: import('../config/defaultConfig').SimulationConfig,
  pressure: Pressure,
  absoluteWeek: number,
  emitEvent: (input: CreateSimEventInput) => void,
  log: ReturnType<typeof createLogger>,
): void {
  const obligation = pressure.relatedObligation
  if (!obligation) return

  if (obligation.kind === 'real_estate_seizure') {
    const seizure = ws.realEstateSeizures[obligation.id]
    if (!seizure || seizure.status !== 'active') return
    // 既に active enforce があるなら作らない (B6)
    if (seizure.activeEnforceProjectId) return
    // cooldown 中なら作らない (B6)
    if (
      seizure.nextEnforceAllowedWeek !== undefined &&
      absoluteWeek < seizure.nextEnforceAllowedWeek
    )
      return
    // 権利者 House (Phase 1 では house のみ)
    if (seizure.rightfulOwner.kind !== 'house') return
    const ownerHouseId = seizure.rightfulOwner.id
    const ownerHouse = ws.houses[ownerHouseId]
    if (!ownerHouse || !ownerHouse.active) return

    // strength gate (B1, §10.2): owner House の独立抵抗力が seizer に対して閾値以上のときのみ生成。
    //   弱い House は enforce を起案できず、seizure は無係争で時効へ向かう。
    const resistance = computeOwnerHouseResistance(ws, config, ownerHouseId, seizure.seizerPolityId)
    if (resistance < config.realEstateSeizureEnforceResistanceThreshold) return

    // House decision maker を creator に
    const decisionMakerId = getHouseDecisionMaker(ws, ownerHouseId)
    if (!decisionMakerId) return
    const decisionMaker = ws.persons[decisionMakerId]
    if (!decisionMaker || !decisionMaker.alive || decisionMaker.kind === 'placeholder') return

    const owner = { kind: 'house', id: ownerHouseId } as const
    const supervisorId =
      selectProjectSupervisor(ws, config, owner, 'enforce_obligation', decisionMakerId) ??
      decisionMakerId
    const target: EnforceObligationTarget = { kind: 'real_estate_seizure', id: seizure.id }

    const projectId = createEnforceProjectMut(
      ws,
      config,
      owner,
      decisionMakerId,
      supervisorId,
      target,
      absoluteWeek,
    )
    setRealEstateSeizureEnforceMut(ws, seizure.id, { activeEnforceProjectId: projectId })

    log.log('PRESSURE', {
      pressureId: pressure.id,
      enforceProjectId: projectId,
      target: `real_estate_seizure:${seizure.id}`,
    })

    emitEnforceStartedEvent(ws, owner, emitEvent)
  }
  // land_contract_default は Phase 2 で対応
}

function createEnforceProjectMut(
  ws: WorldState,
  config: import('../config/defaultConfig').SimulationConfig,
  owner:
    | { kind: 'house'; id: import('../types/ids').HouseId }
    | { kind: 'polity'; id: import('../types/ids').PolityId },
  creatorPersonId: PersonId,
  supervisorPersonId: PersonId,
  target: EnforceObligationTarget,
  absoluteWeek: number,
): ProjectId {
  const projectId: ProjectId = createProjectId(ws.nextProjectId)
  ws.nextProjectId++
  const project: EnforceObligationProject = {
    id: projectId,
    owner,
    origin: { kind: 'system', reasonKey: 'enforce_obligation' },
    kind: 'enforce_obligation',
    creatorPersonId,
    supervisorPersonId,
    target,
    status: 'active',
    progress: 0,
    targetProgress: config.projectDefaultTargetProgress,
    currentStageKey: getInitialProjectStageKey('enforce_obligation'),
    createdWeek: absoluteWeek,
    deadlineWeek: absoluteWeek + config.projectDeadlineWeeksDevelopment,
    reasonIds: [],
  }
  ws.projects[projectId] = project
  addProjectToIndexMut(ws, project)
  return projectId
}

function emitEnforceStartedEvent(
  ws: WorldState,
  owner:
    | { kind: 'house'; id: import('../types/ids').HouseId }
    | { kind: 'polity'; id: import('../types/ids').PolityId },
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  const ownerRef = getOwnerNameRefForEmit(ws, owner)
  emitEvent({
    type: 'PROJECT_STARTED',
    importance: 'minor',
    messageKey: 'project.started',
    messageParams: {
      owner: nameParam(ownerRef.category, ownerRef.nameKey),
      kind: 'enforce_obligation',
    },
    entityRefs: [entityRef(owner.kind, owner.id, 'owner', ownerRef.nameKey)],
  })
}
