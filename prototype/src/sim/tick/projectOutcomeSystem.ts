import type { TickContext } from './context'
import type { CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import type { Project } from '../types/project'
import type { OrganizationRef } from '../types/office'
import { personReputationOrganizationKey } from '../types/personReputation'
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
            const pKey = project.supervisorPersonId as string
            // perf (v0.47): 当人バケットだけ copy-on-write (PAL 2 層構造)。
            ws.personActivityLogs[pKey] = {
              ...(ws.personActivityLogs[pKey] ?? {}),
              [logId]: actLog,
            }
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
      // 影響力個人中心化 Phase 1b: 運動は投入額に比例した評判 (baseScore = budget × perCost)。
      // 他 project は固定 success base。
      baseScore =
        project.kind === 'movement_campaign'
          ? project.budget * config.movementReputationPerCost
          : config.personReputationProjectSuccessBase
    } else if (
      project.status === 'failed' &&
      (project.terminalReason === 'deadline_expired' ||
        project.terminalReason === 'stage_attempts_exceeded')
    ) {
      baseScore = config.personReputationProjectFailureBase
    }
    if (baseScore !== undefined) {
      // 影響力個人中心化 Phase 1a: dual-tag。owner organization (家/政体) と
      // target organization (対象 polity) の両方に評判レコードを生成する (owner==target なら 1 個)。
      // これにより家活動でも対象 polity の influence を生み、同時に owner 側 (家=Share / 政体=influence)
      // にも効く。tag 先が 1 つも無い (person owner かつ target 無し) 場合は tag 無し評判 1 個。
      const orgs = collectProjectReputationOrganizations(ws, project)
      const source = {
        kind: 'project' as const,
        projectKind: project.kind,
        projectId: project.id,
      }
      if (orgs.length === 0) {
        awardPersonReputationMut(
          ws,
          config,
          { personId: project.supervisorPersonId, source, category, baseScore },
          emitEvent,
        )
      } else {
        for (const org of orgs) {
          awardPersonReputationMut(
            ws,
            config,
            {
              personId: project.supervisorPersonId,
              source,
              category,
              baseScore,
              relatedOrganization: org,
            },
            emitEvent,
          )
        }
      }
    }
  }
  return nextRng
}

// 影響力個人中心化 Phase 1a (dual-tag): Project 完遂評判の tag 先 organization を集める。
// owner organization (polity/house — person owner は tag しない) + target polity を dedupe して返す。
export function collectProjectReputationOrganizations(
  ws: WorldState,
  project: Project,
): OrganizationRef[] {
  const orgs: OrganizationRef[] = []
  const seen = new Set<string>()
  const push = (org: OrganizationRef | undefined): void => {
    if (!org) return
    const key = personReputationOrganizationKey(org)
    if (seen.has(key)) return
    seen.add(key)
    orgs.push(org)
  }
  if (project.owner.kind === 'polity' || project.owner.kind === 'house') {
    push(project.owner)
  }
  push(deriveProjectTargetPolity(ws, project))
  return orgs
}

// 対象 polity の導出 (kind 別)。reputation を付与する非外交 project のうち、
// 政体に紐づくものだけ target を返す (patronize/commission は owner のみで完結 → undefined)。
function deriveProjectTargetPolity(ws: WorldState, project: Project): OrganizationRef | undefined {
  switch (project.kind) {
    case 'acquire_political_right':
    case 'promote_policy_shift':
      return { kind: 'polity', id: project.polityId }
    case 'movement_campaign':
      // 影響力個人中心化 Phase 1b: owner=家 (Share へ) + target=対象 polity (influence へ) の dual-tag
      return { kind: 'polity', id: project.targetPolityId }
    case 'develop_holding': {
      const polityId = ws.holdingTerminalPolityCache[project.holdingId]
      return polityId !== undefined ? { kind: 'polity', id: polityId } : undefined
    }
    default:
      return undefined
  }
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
    case 'movement_campaign':
      applyMovementCampaignMut(ws, config, project)
      break
  }
}

// 影響力個人中心化 Phase 1b: 運動完遂の効果。投入額を家 wealth から消費する (wealth sink・
// campaign 支出として消える)。influence/Share 上昇は award (dual-tag 評判) が担うのでここでは
// 状態変更は wealth 控除のみ。失敗/中断時は呼ばれない (= budget 没収・追加処理なし)。
function applyMovementCampaignMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
): void {
  if (project.kind !== 'movement_campaign') return
  const house = ws.houses[project.owner.id]
  if (!house || !house.active) return
  const cost = config.movementProjectBaseCost
  if (house.wealth < cost) return
  ws.houses[project.owner.id] = { ...house, wealth: house.wealth - cost }
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
  const pKey = project.supervisorPersonId as string
  // perf (v0.47): 当人バケットだけ copy-on-write (PAL 2 層構造)。
  ws.personActivityLogs[pKey] = { ...(ws.personActivityLogs[pKey] ?? {}), [logId]: actLog }
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

// v0.42 §13.4 / 影響力個人中心化 Phase 4: acquire_political_right の outcome。
// holder = 遂行者個人 (supervisor) に変更 (任命権を個人保有に・死亡時に §10 で条件付き継承)。
// コストは引き続き owner House wealth から対象 Polity treasury への transfer (簡素版・§13.4)。
// supervisor が死亡/placeholder なら作らない (no-op で aim は待機)。
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
  const supervisor = ws.persons[project.supervisorPersonId]
  if (!supervisor || !supervisor.alive || supervisor.kind === 'placeholder') return

  const created = createPoliticalRight(ws, {
    polityId: project.polityId,
    target: project.target,
    holder: { kind: 'person', id: project.supervisorPersonId },
    grantedWeek: ws.absoluteWeek,
  })
  if (!created.ok) return

  // createPoliticalRight は immutable に新 state を返すため draft に書き戻す
  ws.politicalRights = created.value.state.politicalRights
  ws.politicalRightIndex = created.value.state.politicalRightIndex
  ws.nextPoliticalRightId = created.value.state.nextPoliticalRightId

  // cost transfer (§13.4 — 簡素版: 取得者個人でなく owner House が資金を出す)
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
      holder: nameParam('person', supervisor.nameKey),
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
