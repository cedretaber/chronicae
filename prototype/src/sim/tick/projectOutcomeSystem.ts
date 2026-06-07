import type { TickContext } from './context'
import type { CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import type { Project } from '../types/project'
import type { PersonActivityLog } from '../types/task'
import type { HoldingImprovementId } from '../types/ids'
import { createHoldingImprovementId, createPersonActivityLogId } from '../types/ids'
import { adjustPersonAttitude } from '../mutations/attitudeMutations'
import { getPolityLeader } from '../selectors/officeSelectors'
import {
  getPolityNameRefForEmit,
  getPolityNameRefForEmitFromPolity,
} from '../selectors/nameRefSelectors'
import type { EventId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import { clamp } from '../utils/math'
import { removeProjectFromIndexMut, isDiplomaticProjectKind } from '../mutations/projectMutations'
import { createPoliticalRight } from '../mutations/politicalRightMutations'
import type { RngState } from '../rng/rng'
import {
  applyImmediateAbilityGrowthMut,
  awardPersonReputationMut,
  getProjectExperienceWeights,
  PROJECT_REPUTATION_CATEGORY_MAP,
} from '../helpers/awardHelpers'
import { getPoliticalRightKindFromTarget } from '../types/politicalRight'
import {
  politicalRightTargetNameParam,
  buildPoliticalRightEntityRefs,
} from './politicalRightEvents'
import { createLogger } from '../debug/logger'

export function runProjectOutcomeSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  let rng = ctx.rng

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
    houses: { ...ctx.state.houses },
    holdings: { ...ctx.state.holdings },
    houseShares: { ...ctx.state.houseShares },
    houseShareIndex: {
      byHouse: { ...ctx.state.houseShareIndex.byHouse },
      byHolderPerson: { ...ctx.state.houseShareIndex.byHolderPerson },
    },
    diplomaticPlays: { ...ctx.state.diplomaticPlays },
    pressures: { ...ctx.state.pressures },
    holdingImprovements: { ...ctx.state.holdingImprovements },
    holdingImprovementIndex: {
      byHolding: { ...ctx.state.holdingImprovementIndex.byHolding },
    },
    persons: { ...ctx.state.persons },
    personActivityLogs: { ...ctx.state.personActivityLogs },
    personActivityLogIndex: {
      byPerson: { ...ctx.state.personActivityLogIndex.byPerson },
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

  const terminalProjects: Project[] = []
  for (const [, project] of Object.entries(ws.projects)) {
    if (!project) continue
    if (
      project.status === 'completed' ||
      project.status === 'failed' ||
      project.status === 'cancelled'
    ) {
      terminalProjects.push(project)
    }
  }

  const log = createLogger(config.debug)
  for (const project of terminalProjects) {
    log.log('PROJECT_OUTCOME', {
      projectId: project.id,
      kind: project.kind,
      status: project.status,
    })
    if (project.status === 'completed') {
      if (!isDiplomaticProjectKind(project.kind)) {
        applyNonDiplomaticEffectMut(ws, config, project, emitEvent)
        addAimProgressForCompletedProjectMut(ws, config, project)
      }
      if (project.kind === 'respond_to_pressure') {
        const pressure = ws.pressures[project.pressureId]
        if (pressure && pressure.status === 'active') {
          ws.pressures[project.pressureId] = { ...pressure, status: 'responded' }
          log.log('PROJECT_OUTCOME', {
            pressureId: project.pressureId,
            action: 'responded',
          })
        }
      }
      if (project.origin.kind === 'aim') {
        const aim = ws.aims[project.origin.aimId]
        if (aim) {
          ws.aims[aim.id] = { ...aim, successfulProjectCount: aim.successfulProjectCount + 1 }
        }
      }
    } else if (project.status === 'failed' || project.status === 'cancelled') {
      if (project.status === 'failed' && project.origin.kind === 'aim') {
        const aim = ws.aims[project.origin.aimId]
        if (aim) {
          ws.aims[aim.id] = { ...aim, failedProjectCount: aim.failedProjectCount + 1 }
        }
      }
      // Budget refund for develop_holding
      if (project.kind === 'develop_holding' && project.budget.remaining > 0) {
        if (project.owner.kind === 'polity') {
          const polity = ws.polities[project.owner.id]
          if (polity) {
            ws.polities[project.owner.id] = {
              ...polity,
              treasury: polity.treasury + project.budget.remaining,
            }
          }
        }
        // ProjectActivityLog for failed
        if (project.status === 'failed') {
          const supervisor = ws.persons[project.supervisorPersonId]
          if (supervisor?.alive) {
            const logId = createPersonActivityLogId(ws.nextPersonActivityLogId)
            ws.nextPersonActivityLogId++
            const actLog: PersonActivityLog = {
              id: logId,
              personId: project.supervisorPersonId,
              week: ws.absoluteWeek,
              kind: 'project_failed',
              projectKind: 'develop_holding',
              sourceRef: { kind: 'project', id: project.id },
              relatedRefs: [{ kind: 'holding', id: project.holdingId }],
              summaryKey: 'activity.project_failed',
              params: {
                improvementKind: project.improvementKind,
                targetLevel: project.targetImprovementLevel,
                holdingId: project.holdingId,
              },
              importance: 10,
            }
            ws.personActivityLogs[logId] = actLog
            const pKey = project.supervisorPersonId as string
            ws.personActivityLogIndex.byPerson[pKey] = [
              ...(ws.personActivityLogIndex.byPerson[pKey] ?? []),
              logId,
            ]
          }
        }
      }
    }

    // v0.44 §5: 削除直前に成果経験・評判を付与する (非外交 Project のみ — 外交系は
    //   DiplomaticPlay 側 (cleanupTerminalDiplomacy) で delegate に付与する §5.2)。
    if (!isDiplomaticProjectKind(project.kind)) {
      rng = awardProjectOutcomeMut(ws, config, project, rng, emitEvent)
    }

    removeProjectFromIndexMut(ws, project)
    delete ws.projects[project.id]
  }

  return {
    ...ctx,
    rng,
    state: ws,
    events: [...ctx.events, ...newEvents],
    nextEventIndex,
  }
}

// v0.44 §5.4-5.5: 非外交 Project の terminal 時に supervisor へ経験・評判を付与する。
function awardProjectOutcomeMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  rng: RngState,
  emitEvent: (input: CreateSimEventInput) => void,
): RngState {
  // fail-fast (§5.3): terminalReason のセット漏れは年末 integrity では検出できない
  //   (flushTerminalEntities が直前に削除するため)。ここで顕在化させる。
  if (project.terminalReason === undefined) {
    throw new Error(
      `projectOutcomeSystem: terminal project ${project.id as string} ` +
        `(kind=${project.kind}, status=${project.status}) without terminalReason — ` +
        `terminal サイトのセット漏れ (v0.44 §5.3)`,
    )
  }

  const supervisor = ws.persons[project.supervisorPersonId]
  if (!supervisor || !supervisor.alive || supervisor.kind === 'placeholder') return rng

  // 経験 (§5.4)
  let experience: number
  if (project.status === 'completed') {
    experience = config.projectExperienceGainCompleted
  } else if (project.status === 'failed') {
    experience = config.projectExperienceGainFailed
  } else {
    const progressRatio = clamp(
      project.targetProgress > 0 ? project.progress / project.targetProgress : 0,
      0,
      1,
    )
    experience =
      config.projectExperienceGainCompleted *
      progressRatio *
      config.projectExperienceGainCancelledMultiplier
  }

  const weights = getProjectExperienceWeights(project)
  const nextRng = applyImmediateAbilityGrowthMut(
    ws,
    config,
    project.supervisorPersonId,
    experience,
    weights,
    'project',
    rng,
    emitEvent,
  )

  // 評判 (§5.5): completed=正 / failed は本人帰責 reason のみ負 / cancelled=なし
  const category = PROJECT_REPUTATION_CATEGORY_MAP[project.kind]
  if (category !== undefined) {
    let baseScore: number | undefined
    if (project.status === 'completed') {
      baseScore = config.personReputationProjectSuccessBase
    } else if (
      project.status === 'failed' &&
      (project.terminalReason === 'deadline_expired' ||
        project.terminalReason === 'stage_attempts_exceeded')
    ) {
      baseScore = config.personReputationProjectFailureBase
    }
    if (baseScore !== undefined) {
      awardPersonReputationMut(
        ws,
        config,
        {
          personId: project.supervisorPersonId,
          source: { kind: 'project', projectKind: project.kind, projectId: project.id },
          category,
          baseScore,
          ...(project.owner.kind === 'polity' || project.owner.kind === 'house'
            ? { relatedOrganization: project.owner }
            : {}),
        },
        emitEvent,
      )
    }
  }
  return nextRng
}

// --- Non-diplomatic effect application ---

function applyNonDiplomaticEffectMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  switch (project.kind) {
    case 'develop_holding':
      applyDevelopHoldingMut(ws, config, project, emitEvent)
      break
    case 'acquire_political_right':
      applyAcquirePoliticalRightMut(ws, config, project, emitEvent)
      break
    case 'promote_policy_shift':
      applyPromotePolicyShiftMut(ws, project, emitEvent)
      break
    case 'patronize_artist':
      applyPatronizeArtistMut(ws, config, project, emitEvent)
      break
    case 'commission_chronicle':
      applyCommissionChronicleMut(ws, config, project, emitEvent)
      break
  }
}

function applyDevelopHoldingMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'develop_holding') return
  const holdingId = project.holdingId
  const holding = ws.holdings[holdingId]
  if (!holding) return

  // HoldingImprovement 作成 or level up
  const existingImpIds = ws.holdingImprovementIndex.byHolding[holdingId as string] ?? []
  let existingImpId: HoldingImprovementId | undefined
  for (const impId of existingImpIds) {
    const imp = ws.holdingImprovements[impId]
    if (imp?.kind === project.improvementKind) {
      existingImpId = impId
      break
    }
  }

  if (existingImpId) {
    const existing = ws.holdingImprovements[existingImpId]!
    ws.holdingImprovements[existingImpId] = {
      ...existing,
      level: project.targetImprovementLevel,
    }
  } else {
    const newId = createHoldingImprovementId(ws.nextHoldingImprovementId)
    ws.holdingImprovements[newId] = {
      id: newId,
      holdingId,
      kind: project.improvementKind,
      level: project.targetImprovementLevel,
      condition: 100,
      createdWeek: ws.absoluteWeek,
    }
    ws.holdingImprovementIndex.byHolding[holdingId as string] = [...existingImpIds, newId]
    ws.nextHoldingImprovementId++
  }

  // Budget remaining → supervisor.wealth
  if (project.budget.remaining > 0) {
    const supervisor = ws.persons[project.supervisorPersonId]
    if (supervisor) {
      ws.persons[project.supervisorPersonId] = {
        ...supervisor,
        wealth: supervisor.wealth + project.budget.remaining,
      }
    }
  }

  // Respect: creator → supervisor
  if ((project.creatorPersonId as string) !== (project.supervisorPersonId as string)) {
    const result = adjustPersonAttitude(
      ws,
      project.creatorPersonId,
      {
        kind: 'person',
        id: project.supervisorPersonId,
      },
      { respect: config.projectCompletedRespectGain },
    )
    if (result.ok) {
      ws.persons = result.value.persons
    }
  }

  // Respect: owner leader → supervisor
  if (project.owner.kind === 'polity') {
    const leaderId = getPolityLeader(ws, project.owner.id)
    if (leaderId && (leaderId as string) !== (project.supervisorPersonId as string)) {
      const result = adjustPersonAttitude(
        ws,
        leaderId,
        {
          kind: 'person',
          id: project.supervisorPersonId,
        },
        { respect: config.projectCompletedRespectGain },
      )
      if (result.ok) {
        ws.persons = result.value.persons
      }
    }
  }

  // ProjectActivityLog for supervisor
  const logId = createPersonActivityLogId(ws.nextPersonActivityLogId)
  ws.nextPersonActivityLogId++
  const actLog: PersonActivityLog = {
    id: logId,
    personId: project.supervisorPersonId,
    week: ws.absoluteWeek,
    kind: 'project_completed',
    projectKind: 'develop_holding',
    sourceRef: { kind: 'project', id: project.id },
    relatedRefs: [{ kind: 'holding', id: holdingId }],
    summaryKey: 'activity.project_completed',
    params: {
      improvementKind: project.improvementKind,
      targetLevel: project.targetImprovementLevel,
      holdingId,
    },
    importance: 20,
  }
  ws.personActivityLogs[logId] = actLog
  const pKey = project.supervisorPersonId as string
  ws.personActivityLogIndex.byPerson[pKey] = [
    ...(ws.personActivityLogIndex.byPerson[pKey] ?? []),
    logId,
  ]

  // Event
  const polityRef =
    project.owner.kind === 'polity' ? getPolityNameRefForEmit(ws, project.owner.id) : undefined
  const polityNameKey = polityRef?.nameKey ?? ''
  const provinceNameKey = ws.provinces[holding.provinceId]?.nameKey ?? holding.provinceId
  emitEvent({
    type: 'COUNTRY_LAND_DEVELOPED',
    importance: 'minor',
    messageKey: 'polity.land_developed',
    messageParams: {
      polity: nameParam(polityRef?.category ?? 'polity', polityNameKey),
      province: nameParam('province', provinceNameKey),
    },
    entityRefs: [
      entityRef('polity', project.owner.id, 'polity', polityNameKey),
      entityRef('province', holding.provinceId, 'province', provinceNameKey),
      // v0.38 §6.3: Holding 開発史を byHolding に乗せるため holding ref を additive 追加。
      entityRef('holding', holdingId, 'holding'),
    ],
  })
}

// v0.42 §13.4: acquire_political_right の outcome。
// 成功条件 (target 実在 / polityId 整合 / 既存 right なし / owner House active) は
// createPoliticalRight の検査に集約されている。コストは House wealth から対象 Polity の
// treasury への transfer (wealth sink ではない — §13.4)。
function applyAcquirePoliticalRightMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'acquire_political_right') return
  if (project.owner.kind !== 'house') return
  const houseId = project.owner.id
  const house = ws.houses[houseId]
  if (!house || !house.active) return
  const cost = config.acquirePoliticalRightBaseCost
  if (house.wealth < cost) return
  const polity = ws.polities[project.polityId]
  if (!polity || !polity.active) return

  const created = createPoliticalRight(ws, {
    polityId: project.polityId,
    target: project.target,
    holder: { kind: 'house', id: houseId },
    grantedWeek: ws.absoluteWeek,
  })
  if (!created.ok) return

  // createPoliticalRight は immutable に新 state を返すため draft に書き戻す
  ws.politicalRights = created.value.state.politicalRights
  ws.politicalRightIndex = created.value.state.politicalRightIndex
  ws.nextPoliticalRightId = created.value.state.nextPoliticalRightId

  // cost transfer (§13.4)
  ws.houses[houseId] = { ...house, wealth: house.wealth - cost }
  ws.polities[project.polityId] = { ...polity, treasury: polity.treasury + cost }

  const right = created.value.right
  const polityNameRef = getPolityNameRefForEmitFromPolity(ws, polity)
  emitEvent({
    type: 'POLITICAL_RIGHT_GRANTED',
    importance: 'normal',
    messageKey: 'political_right.granted',
    messageParams: {
      rightKind: getPoliticalRightKindFromTarget(right.target),
      target: politicalRightTargetNameParam(ws, right.target),
      holder: nameParam('house', house.nameKey),
      polity: nameParam(polityNameRef.category, polityNameRef.nameKey),
    },
    entityRefs: buildPoliticalRightEntityRefs(ws, right),
  })
}

function applyPromotePolicyShiftMut(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.owner.kind !== 'house') return
  const houseId = project.owner.id
  const house = ws.houses[houseId]
  if (!house || !house.active) return

  const polityId = 'polityId' in project ? project.polityId : undefined
  if (!polityId) return
  const polity = ws.polities[polityId]
  if (!polity || !polity.active) return

  const polityNameRef = getPolityNameRefForEmitFromPolity(ws, polity)
  emitEvent({
    type: 'HOUSE_POLICY_INFLUENCE',
    importance: 'minor',
    messageKey: 'house.policy_influence',
    messageParams: {
      house: nameParam('house', house.nameKey),
      polity: nameParam(polityNameRef.category, polityNameRef.nameKey),
    },
    entityRefs: [
      entityRef('house', houseId, 'house', house.nameKey),
      entityRef('polity', polityId, 'polity', polityNameRef.nameKey),
    ],
  })
}

function applyPatronizeArtistMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.owner.kind !== 'house') return
  const houseId = project.owner.id
  const house = ws.houses[houseId]
  if (!house || !house.active) return
  if (house.wealth < config.patronizeArtistCost) return

  ws.houses[houseId] = {
    ...house,
    wealth: house.wealth - config.patronizeArtistCost,
    legacyPrestige: house.legacyPrestige + config.patronizeArtistPrestigeGain,
  }

  emitEvent({
    type: 'HOUSE_PATRONIZED_ARTIST',
    importance: 'minor',
    messageKey: 'house.patronized_artist',
    messageParams: { house: nameParam('house', house.nameKey) },
    entityRefs: [entityRef('house', houseId, 'house', house.nameKey)],
  })
}

function applyCommissionChronicleMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.owner.kind !== 'house') return
  const houseId = project.owner.id
  const house = ws.houses[houseId]
  if (!house || !house.active) return
  if (house.wealth < config.commissionChronicleCost) return

  ws.houses[houseId] = {
    ...house,
    wealth: house.wealth - config.commissionChronicleCost,
    legacyPrestige: house.legacyPrestige + config.commissionChroniclePrestigeGain,
  }

  emitEvent({
    type: 'HOUSE_COMMISSIONED_CHRONICLE',
    importance: 'minor',
    messageKey: 'house.commissioned_chronicle',
    messageParams: { house: nameParam('house', house.nameKey) },
    entityRefs: [entityRef('house', houseId, 'house', house.nameKey)],
  })
}

// --- Aim progress for non-diplomatic projects ---

function addAimProgressForCompletedProjectMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
): void {
  if (project.origin.kind !== 'aim') return
  const aim = ws.aims[project.origin.aimId]
  if (!aim || aim.status !== 'active') return

  let progressGain: number
  switch (aim.kind) {
    case 'develop_owned_holding':
      progressGain = config.aimProgressGainDevelopmentProject
      break
    case 'acquire_political_right':
    case 'steer_polity_external_expansion':
    case 'steer_polity_internal_development':
      progressGain = config.aimProgressGainPowerProject
      break
    case 'patronize_artist':
    case 'commission_chronicle':
      progressGain = config.aimProgressGainCultureProject
      break
    default:
      progressGain = config.aimProgressGainCultureProject
      break
  }

  let newProgress = clamp(aim.progress + progressGain, 0, aim.targetProgress)
  if (newProgress >= aim.targetProgress - config.aimProgressCompletionTolerance) {
    newProgress = aim.targetProgress
    ws.aims[aim.id] = { ...aim, progress: newProgress, status: 'succeeded' }
  } else {
    ws.aims[aim.id] = { ...aim, progress: newProgress }
  }
}
