import type { TickContext, CreateSimEventInput } from './context'
import type { SimEvent } from '../types/event'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import { isLivingPerson } from '../types/person'
import { getOwnerNameKey, getOwnerNameRefForEmit } from '../utils/ownerNames'
import type { SimulationConfig } from '../config/defaultConfig'
import type {
  Project,
  ProjectKind,
  ProjectStageKey,
  ProjectContributorRecord,
  DevelopHoldingProject,
  DevelopRealEstateProject,
  AcquireRealEstateProject,
  UpgradeOwnedRealEstateProject,
  HandleCrisisProject,
  LandClaimProject,
  ContractRevisionProject,
  RespondToPressureProject,
  RequestLandGrantProject,
  RequestCadetBranchTitleTransferProject,
  RepublicHouseFoundationProject,
  RequestRankPromotionProject,
  ConsolidateInternalContractsProject,
} from '../types/project'
import type { ResourceKind } from '../types/resource'
import {
  getProjectFundingStakeholders,
  computeContributorPledge,
  type FundingContributor,
} from '../selectors/projectFundingSelectors'
import { getProjectMarketKey } from '../selectors/projectMaterialSelectors'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import { getSmoothedPriceOrBase } from '../config/resourceEconomyDefinitions'
import { applyLandGrantMut } from '../mutations/landGrantMutations'
import { applyCadetBranchTitleTransferMut } from '../mutations/titleTransferMutations'
import { applyRepublicHouseFoundationMut } from '../mutations/republicHouseMutations'
import { applyConsolidationMut } from '../mutations/consolidationMutations'
import {
  resolveLandGrantDonor,
  computeLandGrantAcceptScore,
  resolveCadetBranchTransfer,
  resolveRepublicHouseFounding,
  canPromotePolityRank,
} from '../selectors/petitionSelectors'
import { getHouseConsentSupportScore } from '../selectors/influenceSelectors'
import { getHouseDomainConsolidationSinkPolityId } from '../selectors/polityRelations'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'
import { getHouseNameRefForEmit, getPolityNameRefForEmit } from '../selectors/nameRefSelectors'
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
import {
  PROJECT_STAGE_SEQUENCES,
  getProjectStageType,
  getNextProjectStageKey,
  getInitialProjectStageKey,
  isProjectStageValid,
} from '../config/projectStageSequences'
import { selectProjectSupervisor } from '../selectors/projectSelectors'
import { predictPressureResponseStance } from '../selectors/pressureStanceSelectors'
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
    // v0.47: finalize_* ハンドラが House/Polity を作るため ctx の採番カウンタを ws に seed する
    //   (createTickContext が正本として保持。返却時に ctx へ書き戻す)。
    nextHouseIndex: ctx.nextHouseIndex,
    nextPolityIndex: ctx.nextPolityIndex,
    projects: { ...ctx.state.projects },
    polities: { ...ctx.state.polities },
    houses: { ...ctx.state.houses },
    persons: { ...ctx.state.persons },
    // v0.60: raise_funds の applyPledgeDrains が popGroups.money を書き戻すため draft slice する
    //   (漏れると元 state を破壊し determinism/integrity 違反 — mutable draft write-back slices)。
    popGroups: { ...ctx.state.popGroups },
    officeAssignments: { ...ctx.state.officeAssignments },
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
    // v0.47: finalize_* ハンドラが進めた採番カウンタを ctx へ書き戻す (toResult が state へ永続化)。
    nextHouseIndex: ws.nextHouseIndex ?? ctx.nextHouseIndex,
    nextPolityIndex: ws.nextPolityIndex ?? ctx.nextPolityIndex,
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

  // v0.48 Crisis: handle_crisis は develop_holding と同じ find_supervisor → secure_budget を共有する。
  //   これを書かないとステージが永久 stall する (§3.1【新規必須 1】)。
  if (
    project.kind === 'develop_holding' ||
    project.kind === 'develop_real_estate' ||
    project.kind === 'handle_crisis'
  ) {
    if (project.currentStageKey === 'find_supervisor') {
      return resolveFindSupervisor(ws, config, project, projectId, absoluteWeek)
    }
    if (project.currentStageKey === 'secure_budget') {
      return resolveSecureBudget(ws, config, project, projectId, absoluteWeek)
    }
  }

  if (project.kind === 'acquire_real_estate') {
    if (project.currentStageKey === 'find_supervisor') {
      return resolveFindSupervisor(ws, config, project, projectId, absoluteWeek)
    }
    if (project.currentStageKey === 'secure_budget') {
      return resolveAcquireRealEstateSecureBudget(ws, config, project, projectId, absoluteWeek)
    }
  }

  if (project.kind === 'upgrade_owned_real_estate') {
    if (project.currentStageKey === 'find_supervisor') {
      return resolveUpgradeOwnedFindSupervisor(ws, config, project, projectId)
    }
    if (project.currentStageKey === 'secure_budget') {
      return resolveUpgradeOwnedSecureBudget(ws, config, project, projectId, absoluteWeek)
    }
  }

  // v0.60: budget 持ち 5 種の資金集めラウンド (back-edge ステージ)。projectMaintenanceSystem が
  //   budget 枯渇時に currentStageKey='raise_funds' へ遷移させ、ここで決定的に集金して final へ戻す。
  if (
    (project.kind === 'develop_holding' ||
      project.kind === 'develop_real_estate' ||
      project.kind === 'acquire_real_estate' ||
      project.kind === 'upgrade_owned_real_estate' ||
      project.kind === 'handle_crisis') &&
    project.currentStageKey === 'raise_funds'
  ) {
    return resolveRaiseFunds(ws, config, projectId, absoluteWeek, emitEvent)
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

  // v0.47 §9.7: 分封 petition の解決。
  if (project.kind === 'request_land_grant' && project.currentStageKey === 'finalize_land_grant') {
    return resolveFinalizeLandGrant(ws, config, project, projectId, emitEvent)
  }

  // v0.47 §11.9: Polity 譲渡による分家の解決。
  if (
    project.kind === 'request_cadet_branch_title_transfer' &&
    project.currentStageKey === 'finalize_cadet_branch'
  ) {
    return resolveFinalizeCadetBranch(ws, config, project, projectId, emitEvent)
  }

  // v0.47 §13.5: 共和国 House 創設の解決。
  if (
    project.kind === 'republic_house_foundation' &&
    project.currentStageKey === 'register_house'
  ) {
    return resolveRegisterHouse(ws, config, project, projectId, emitEvent)
  }

  // v0.47 §5.7: 陞爵の解決。
  if (
    project.kind === 'request_rank_promotion' &&
    project.currentStageKey === 'finalize_promotion'
  ) {
    return resolveFinalizePromotion(ws, config, project, projectId, emitEvent)
  }

  // v0.47 §12.7: 一円支配集約の解決。
  if (
    project.kind === 'consolidate_internal_contracts' &&
    project.currentStageKey === 'finalize_consolidation'
  ) {
    return resolveFinalizeConsolidation(ws, config, project, projectId, emitEvent)
  }

  return false
}

// v0.47 §12.7: 自家内 LandContract collapse。sink〜terminal 間の同家 contract を畳む。
function resolveFinalizeConsolidation(
  ws: WorldState,
  config: SimulationConfig,
  project: ConsolidateInternalContractsProject,
  projectId: ProjectId,
  emitEvent: (input: CreateSimEventInput) => void,
): boolean {
  const houseId = project.houseId
  // sink を fresh に再解決 (project 作成後に状態が変わり得る)。
  const sinkPolityId = getHouseDomainConsolidationSinkPolityId(ws, config, houseId)

  function failProject(): boolean {
    ws.projects[projectId] = { ...project, status: 'failed', terminalReason: 'opponent_too_strong' }
    if (project.origin.kind === 'aim') {
      const aim = ws.aims[project.origin.aimId]
      if (aim) {
        ws.aims[project.origin.aimId] = {
          ...aim,
          nextProjectAllowedWeek:
            ws.absoluteWeek + config.houseDomainConsolidationRetryCooldownWeeks,
        }
      }
    }
    return true
  }

  if (!sinkPolityId) return failProject()

  const result = applyConsolidationMut(ws, houseId, sinkPolityId)
  Object.assign(ws, result.ws)

  // collapse できなかった (benefit 0) 場合は失敗扱い (cooldown)。
  if (result.consolidatedCount < config.houseDomainConsolidationMinBenefit) {
    return failProject()
  }

  ws.projects[projectId] = { ...project, status: 'completed', terminalReason: 'completed' }

  const house = ws.houses[houseId]
  const polityRef = getPolityNameRefForEmit(ws, sinkPolityId)
  const houseRef = getHouseNameRefForEmit(ws, houseId)
  emitEvent({
    type: 'LAND_CONTRACT_CONSOLIDATED',
    importance: 'minor',
    messageKey: 'polity.consolidated',
    messageParams: {
      house: nameParam(houseRef.category, houseRef.nameKey),
      polity: nameParam(polityRef.category, polityRef.nameKey),
    },
    entityRefs: [
      entityRef('house', houseId, 'house', house?.nameKey),
      entityRef('polity', sinkPolityId, 'polity', polityRef.nameKey),
    ],
  })
  return true
}

// v0.47 §5.6/§5.7: 陞爵の SOFT 同意判定と rank 昇格 mutation。
function resolveFinalizePromotion(
  ws: WorldState,
  config: SimulationConfig,
  project: RequestRankPromotionProject,
  projectId: ProjectId,
  emitEvent: (input: CreateSimEventInput) => void,
): boolean {
  const polityId = project.polityId
  const newRank = project.newRank

  function failProject(): boolean {
    ws.projects[projectId] = { ...project, status: 'failed', terminalReason: 'opponent_too_strong' }
    if (project.origin.kind === 'aim') {
      const aim = ws.aims[project.origin.aimId]
      if (aim) {
        ws.aims[project.origin.aimId] = {
          ...aim,
          nextProjectAllowedWeek: ws.absoluteWeek + config.rankPromotionRetryCooldownWeeks,
        }
      }
    }
    const ownerNameKey = getOwnerNameKey(ws, project.owner)
    emitEvent({
      type: 'PROJECT_FAILED',
      importance: 'minor',
      messageKey: 'project.failed.no_supervisor',
      messageParams: {
        owner: nameParam(getOwnerNameRefForEmit(ws, project.owner).category, ownerNameKey),
        kind: project.kind,
      },
      entityRefs: [],
    })
    return true
  }

  // rank 変更前に canPromotePolityRank を再検査する (§5.7・LandContract rank 不変を保つ)。
  if (!canPromotePolityRank(ws, config, polityId, newRank)) return failProject()

  // SOFT accept: approver (宗主 leader) の petitioner polity への attitude を主項に判定。
  // approver 不在 (全 grantor が root) は auto-grant (§5.6)。
  const approverId = project.approverPersonId
  if (approverId !== undefined) {
    const approver = ws.persons[approverId]
    const polity = ws.polities[polityId]
    let attitudeScore = 0
    if (approver && polity) {
      const att = getAttitudeOrDefault(ws, approver, { kind: 'polity', id: polityId })
      attitudeScore = 0.7 * att.affection + 0.3 * att.respect
    }
    const prestigeScore = polity?.legacyPrestige ?? 0
    const powerScore = polity?.adminPower ?? 0
    const acceptScore =
      attitudeScore * config.rankPromotionApproverAttitudeWeight +
      prestigeScore * config.rankPromotionPrestigeWeight +
      powerScore * config.rankPromotionPowerWeight +
      project.progress * config.rankPromotionProjectProgressWeight
    if (acceptScore < config.rankPromotionAcceptThreshold) return failProject()
  }

  // 成功: rank 昇格。
  ws.polities = { ...ws.polities, [polityId]: { ...ws.polities[polityId]!, rank: newRank } }
  ws.projects[projectId] = { ...project, status: 'completed', terminalReason: 'completed' }

  const polityRef = getPolityNameRefForEmit(ws, polityId)
  emitEvent({
    type: 'POLITY_RANK_PROMOTED',
    importance: 'major',
    messageKey: 'polity.rank_promoted',
    messageParams: {
      polity: nameParam(polityRef.category, polityRef.nameKey),
      rank: String(newRank),
    },
    entityRefs: [entityRef('polity', polityId, 'polity', polityRef.nameKey)],
  })
  return true
}

// v0.47 §13.5: 共和国 House 創設の HARD 再検査と成功 mutation。
function resolveRegisterHouse(
  ws: WorldState,
  config: SimulationConfig,
  project: RepublicHouseFoundationProject,
  projectId: ProjectId,
  emitEvent: (input: CreateSimEventInput) => void,
): boolean {
  const petitionerId = project.petitionerPersonId

  function failProject(): boolean {
    ws.projects[projectId] = { ...project, status: 'failed', terminalReason: 'opponent_too_strong' }
    if (project.origin.kind === 'aim') {
      const aim = ws.aims[project.origin.aimId]
      if (aim) {
        ws.aims[project.origin.aimId] = {
          ...aim,
          nextProjectAllowedWeek: ws.absoluteWeek + config.republicHouseFoundingRetryCooldownWeeks,
        }
      }
    }
    const ownerNameKey = getOwnerNameKey(ws, project.owner)
    emitEvent({
      type: 'PROJECT_FAILED',
      importance: 'minor',
      messageKey: 'project.failed.no_supervisor',
      messageParams: {
        owner: nameParam(getOwnerNameRefForEmit(ws, project.owner).category, ownerNameKey),
        kind: project.kind,
      },
      entityRefs: [],
    })
    return true
  }

  // HARD gate 再検査 (共和国役職・無家・wealth)。
  const resolved = resolveRepublicHouseFounding(ws, config, petitionerId)
  if (!resolved) return failProject()

  const result = applyRepublicHouseFoundationMut(ws, {
    petitionerPersonId: petitionerId,
    commonwealthPolityId: resolved.commonwealthPolityId,
  })
  if (!result) return failProject()
  Object.assign(ws, result.ws)

  ws.projects[projectId] = { ...project, status: 'completed', terminalReason: 'completed' }

  const newHouse = ws.houses[result.newHouseId]
  const houseRef = getHouseNameRefForEmit(ws, result.newHouseId)
  const petitionerNameKey = ws.persons[petitionerId]?.nameKey ?? petitionerId
  emitEvent({
    type: 'HOUSE_FOUNDED_IN_REPUBLIC',
    importance: 'normal',
    messageKey: 'house.founded_in_republic',
    messageParams: {
      person: nameParam('person', petitionerNameKey),
      house: nameParam(houseRef.category, houseRef.nameKey),
    },
    entityRefs: [
      entityRef('person', petitionerId, 'founder', petitionerNameKey),
      entityRef('house', result.newHouseId, 'house', newHouse?.nameKey),
    ],
  })
  return true
}

// v0.47 §11.7/§11.9: Polity 譲渡による分家の HouseShare 支持判定と成功 mutation。
function resolveFinalizeCadetBranch(
  ws: WorldState,
  config: SimulationConfig,
  project: RequestCadetBranchTitleTransferProject,
  projectId: ProjectId,
  emitEvent: (input: CreateSimEventInput) => void,
): boolean {
  const petitionerId = project.petitionerPersonId

  function failProject(): boolean {
    ws.projects[projectId] = { ...project, status: 'failed', terminalReason: 'opponent_too_strong' }
    if (project.origin.kind === 'aim') {
      const aim = ws.aims[project.origin.aimId]
      if (aim) {
        ws.aims[project.origin.aimId] = {
          ...aim,
          nextProjectAllowedWeek: ws.absoluteWeek + config.cadetBranchRetryCooldownWeeks,
        }
      }
    }
    const ownerNameKey = getOwnerNameKey(ws, project.owner)
    emitEvent({
      type: 'PROJECT_FAILED',
      importance: 'minor',
      messageKey: 'project.failed.no_supervisor',
      messageParams: {
        owner: nameParam(getOwnerNameRefForEmit(ws, project.owner).category, ownerNameKey),
        kind: project.kind,
      },
      entityRefs: [],
    })
    return true
  }

  // HARD gate 再検査 (譲渡対象を fresh に解決)。
  const resolved = resolveCadetBranchTransfer(ws, config, petitionerId)
  if (!resolved) return failProject()

  // SOFT: HouseShare holder の加重支持 + Project progress 補正 (§11.7)。
  const supportScore = getHouseConsentSupportScore(
    ws,
    resolved.parentHouseId,
    petitionerId,
    project.progress,
  )
  if (supportScore < config.cadetBranchTitleTransferSupportThreshold) return failProject()

  const result = applyCadetBranchTitleTransferMut(ws, {
    petitionerPersonId: petitionerId,
    parentHouseId: resolved.parentHouseId,
    targetPolityId: resolved.targetPolityId,
  })
  if (!result) return failProject()
  Object.assign(ws, result.ws)

  ws.projects[projectId] = { ...project, status: 'completed', terminalReason: 'completed' }

  const cadetHouse = ws.houses[result.cadetHouseId]
  const polityRef = getPolityNameRefForEmit(ws, resolved.targetPolityId)
  const houseRef = getHouseNameRefForEmit(ws, result.cadetHouseId)
  const petitionerNameKey = ws.persons[petitionerId]?.nameKey ?? petitionerId
  emitEvent({
    type: 'CADET_BRANCH_FOUNDED_BY_TITLE_TRANSFER',
    importance: 'normal',
    messageKey: 'house.cadet_founded_by_title_transfer',
    messageParams: {
      person: nameParam('person', petitionerNameKey),
      house: nameParam(houseRef.category, houseRef.nameKey),
    },
    entityRefs: [
      entityRef('person', petitionerId, 'founder', petitionerNameKey),
      entityRef('house', result.cadetHouseId, 'house', cadetHouse?.nameKey),
    ],
  })
  emitEvent({
    type: 'POLITY_TITLE_TRANSFERRED',
    importance: 'normal',
    messageKey: 'polity.title_transferred',
    messageParams: {
      polity: nameParam(polityRef.category, polityRef.nameKey),
    },
    entityRefs: [
      entityRef('polity', resolved.targetPolityId, 'polity', polityRef.nameKey),
      entityRef('house', result.cadetHouseId, 'house', cadetHouse?.nameKey),
    ],
  })
  return true
}

// v0.47 §9.7: 分封 petition の accept/reject 判定と成功 mutation。
function resolveFinalizeLandGrant(
  ws: WorldState,
  config: SimulationConfig,
  project: RequestLandGrantProject,
  projectId: ProjectId,
  emitEvent: (input: CreateSimEventInput) => void,
): boolean {
  const petitionerId = project.petitionerPersonId

  function failProject(reason: 'no_supervisor' | 'opponent_too_strong'): boolean {
    ws.projects[projectId] = { ...project, status: 'failed', terminalReason: reason }
    // aim cooldown 設定 (再請願までの間隔)。
    if (project.origin.kind === 'aim') {
      const aim = ws.aims[project.origin.aimId]
      if (aim) {
        ws.aims[project.origin.aimId] = {
          ...aim,
          nextProjectAllowedWeek: ws.absoluteWeek + config.landGrantRetryCooldownWeeks,
        }
      }
    }
    const ownerNameKey = getOwnerNameKey(ws, project.owner)
    emitEvent({
      type: 'PROJECT_FAILED',
      importance: 'minor',
      messageKey: 'project.failed.no_supervisor',
      messageParams: {
        owner: nameParam(getOwnerNameRefForEmit(ws, project.owner).category, ownerNameKey),
        kind: project.kind,
      },
      entityRefs: [],
    })
    return true
  }

  // HARD gate 再検査 (donor / holding を fresh に解決)。
  const resolved = resolveLandGrantDonor(ws, config, petitionerId)
  if (!resolved) return failProject('opponent_too_strong')

  // SOFT accept。有家分封は「家の土地を手放すには家の同意が要る」とし、cadet branch (§11.7) と同じ
  //   家 share 加重意見 + progress で判定する (本拠を割れる/割れないは家の権力分散度で Layer1 が決め、
  //   この petitioner に実際に渡すかを share holder の加重意見で決める)。
  //   無家分封は donor 領主単独 attitude の従来パスを維持 (所属家が無く family cohesion が無関係)。
  const petitionerHouseId = ws.persons[petitionerId]?.houseId
  let accepted: boolean
  if (petitionerHouseId !== undefined) {
    const support = getHouseConsentSupportScore(
      ws,
      petitionerHouseId,
      petitionerId,
      project.progress,
    )
    accepted = support >= config.landGrantHouseSupportThreshold
  } else {
    const approverId = project.approverPersonId
    let attitudeScore = 0
    if (approverId !== undefined) {
      const approver = ws.persons[approverId]
      if (approver) {
        const att = getAttitudeOrDefault(ws, approver, { kind: 'person', id: petitionerId })
        attitudeScore = 0.7 * att.affection + 0.3 * att.respect
      }
    }
    const acceptScore = computeLandGrantAcceptScore(
      ws,
      config,
      petitionerId,
      approverId,
      project.progress,
      attitudeScore,
    )
    // approver 不在は auto-grant、それ以外は閾値比較。
    accepted = approverId === undefined || acceptScore >= config.landGrantAcceptThreshold
  }
  if (!accepted) return failProject('opponent_too_strong')

  // 成功 mutation。
  const petitioner = ws.persons[petitionerId]
  const result = applyLandGrantMut(ws, config, {
    petitionerPersonId: petitionerId,
    donorPolityId: resolved.donorPolityId,
    holdingId: resolved.holdingId,
    ...(petitioner?.houseId !== undefined && { parentHouseId: petitioner.houseId }),
  })
  if (!result) return failProject('opponent_too_strong')

  // applyLandGrantMut が返した state を ws へ反映 (mutable draft なので各 field を写す)。
  Object.assign(ws, result.ws)

  ws.projects[projectId] = { ...project, status: 'completed', terminalReason: 'completed' }

  const isCadet = petitioner?.houseId !== undefined
  const newHouse = ws.houses[result.newHouseId]
  const houseRef = getHouseNameRefForEmit(ws, result.newHouseId)
  const newPolityRef = getPolityNameRefForEmit(ws, result.newPolityId)
  const petitionerNameKey = ws.persons[petitionerId]?.nameKey ?? petitionerId
  emitEvent({
    type: isCadet ? 'CADET_BRANCH_FOUNDED_BY_LAND_GRANT' : 'HOUSE_FOUNDED_BY_LAND_GRANT',
    importance: 'normal',
    messageKey: isCadet ? 'house.cadet_founded_by_land_grant' : 'house.founded_by_land_grant',
    messageParams: {
      person: nameParam('person', petitionerNameKey),
      house: nameParam(houseRef.category, houseRef.nameKey),
    },
    entityRefs: [
      entityRef('person', petitionerId, 'founder', petitionerNameKey),
      entityRef('house', result.newHouseId, 'house', newHouse?.nameKey),
    ],
  })
  emitEvent({
    type: 'POLITY_GRANTED',
    importance: 'normal',
    messageKey: 'polity.granted',
    messageParams: {
      person: nameParam('person', petitionerNameKey),
      polity: nameParam(newPolityRef.category, newPolityRef.nameKey),
    },
    entityRefs: [
      entityRef('polity', result.newPolityId, 'polity', newPolityRef.nameKey),
      entityRef('person', petitionerId, 'founder', petitionerNameKey),
    ],
  })
  return true
}

function resolveFindSupervisor(
  ws: WorldState,
  config: SimulationConfig,
  project:
    | DevelopHoldingProject
    | DevelopRealEstateProject
    | AcquireRealEstateProject
    | HandleCrisisProject,
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

  // bailiff 不在時は通常の supervisor 選定 (workload 考慮) にフォールバックする。
  // 旧仕様 (担当者をそのまま代官に直接任命) の名残だった bailiff 候補探索
  // (findBailiffCandidateForProject) は廃止 — influence 家の派閥メンバーまで届く
  // 無関係な人物を負荷を見ずに引き込んでいた。候補母集合は owner (polity なら
  // owner 家 + 土地チェーン上の家、house なら member) に限り、負荷ペナルティ込みで選ぶ。
  // 候補ゼロでも creator に倒して必ず stage を進める (旧実装は候補ゼロで
  // find_supervisor に永久 stall し deadline 失敗していた)。
  if (!supervisorId) {
    supervisorId =
      selectProjectSupervisor(ws, config, project.owner, project.kind, project.creatorPersonId) ??
      project.creatorPersonId
  }

  // 既存 bailiff を supervisor に使う場合のみ、project 期間中の任期交代から保護する
  // (直接任命経路の廃止後も、現職 bailiff 経路の termProtect は従来どおり残す — §10.3)。
  const currentOfficeId = ws.holdingOfficeIndex.byHolding[holdingId]
  if (currentOfficeId) {
    const a = ws.holdingOfficeAssignments[currentOfficeId]
    if (a && a.holderPersonId === supervisorId) {
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
  const updated = { ...project, supervisorPersonId: supervisorId, currentStageKey: nextKey }
  ws.projects[projectId] = updated
  addProjectToIndexMut(ws, updated)
  return true
}

function resolveSecureBudget(
  ws: WorldState,
  config: SimulationConfig,
  project: DevelopHoldingProject | DevelopRealEstateProject | HandleCrisisProject,
  projectId: ProjectId,
  absoluteWeek: number,
): boolean {
  if (project.owner.kind !== 'polity') return false
  const polityId = project.owner.id
  const polity = ws.polities[polityId]
  if (!polity) return false

  // v0.60: 初期確保は required の一部のみ (stock 不足でもハード失敗せず確保分で開始)。
  //   不足分は budget 枯渇時の raise_funds ラウンドで集める (開始ハードルの引き下げ)。
  const target = Math.min(
    Math.ceil(project.budget.required * config.projectInitialReserveFraction),
    project.budget.required,
  )
  const take = Math.max(0, Math.min(target, polity.treasury))
  ws.polities = {
    ...ws.polities,
    [polityId]: { ...polity, treasury: polity.treasury - take },
  }

  // v0.48 Crisis: handle_crisis の実行 deadline は Crisis.deadlineWeek を単一の真実とする
  //   (Crisis 有効期間内に対処を終える必要があるため。crisisDeadlineWeeksByKind は spawn 時に
  //   Crisis.deadlineWeek へ反映済み)。develop_holding は従来どおり targetProgress 連動。
  // v0.48.1 §4.2: disrepair の修理 Project は deadline を立てない (undefined)。終端は repaired/destroyed
  //   のみで残存タイマーを断つ (crisisDeadlineWeeksByKind=999 に頼ると ~20年で Project deadline が発火する)。
  const isDisrepair =
    project.kind === 'handle_crisis' && ws.crises[project.crisisId]?.kind === 'disrepair'
  const executionDeadline: number | undefined =
    project.kind === 'handle_crisis'
      ? isDisrepair
        ? undefined
        : (ws.crises[project.crisisId]?.deadlineWeek ??
          absoluteWeek + config.crisisDeadlineWeeksByKind.famine)
      : absoluteWeek + getProjectDeadlineWeeks(config, project.kind, project.targetProgress)

  const nextKey = getNextProjectStageKey(project)
  if (!nextKey) return false

  const log = createLogger(config.debug)
  log.log('PROJECT_STAGE', {
    projectId,
    kind: project.kind,
    from: project.currentStageKey,
    to: nextKey,
  })

  const updated = {
    ...project,
    budget: {
      ...project.budget,
      allocated: take,
      remaining: take,
    },
    currentStageKey: nextKey,
  }
  // exactOptionalPropertyTypes: undefined を直接代入できないため条件分岐で set/delete する。
  if (executionDeadline !== undefined) {
    updated.deadlineWeek = executionDeadline
  } else {
    delete updated.deadlineWeek
  }
  ws.projects[projectId] = updated
  return true
}

function resolveAcquireRealEstateSecureBudget(
  ws: WorldState,
  config: SimulationConfig,
  project: AcquireRealEstateProject,
  projectId: ProjectId,
  absoluteWeek: number,
): boolean {
  if (project.owner.kind !== 'house') return false
  const house = ws.houses[project.owner.id]
  if (!house || !house.active) return false

  // v0.60: 初期確保は salePrice (= budget.required) の一部のみ。stock 不足でもハード失敗せず開始し、
  //   不足分は raise_funds で集める。完了時の seller 支払いは budget.allocated (実集金額) に依拠する
  //   ため、保存則は funded 量と一致する (projectOutcomeSystem の seller 決済を参照)。
  const target = Math.min(
    Math.ceil(project.budget.required * config.projectInitialReserveFraction),
    project.budget.required,
  )
  const take = Math.max(0, Math.min(target, house.wealth))
  ws.houses = {
    ...ws.houses,
    [project.owner.id]: { ...house, wealth: house.wealth - take },
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

  const deadlineWeek =
    absoluteWeek + getProjectDeadlineWeeks(config, project.kind, project.targetProgress)

  removeProjectFromIndexMut(ws, project)
  const updated = {
    ...project,
    currentStageKey: nextKey,
    deadlineWeek,
    budget: { ...project.budget, allocated: take, remaining: take },
  }
  ws.projects[projectId] = updated
  addProjectToIndexMut(ws, updated)
  return true
}

function resolveUpgradeOwnedFindSupervisor(
  ws: WorldState,
  config: SimulationConfig,
  project: UpgradeOwnedRealEstateProject,
  projectId: ProjectId,
): boolean {
  const supervisorId =
    selectProjectSupervisor(ws, config, project.owner, project.kind, project.creatorPersonId) ??
    project.creatorPersonId

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
  const updated = { ...project, supervisorPersonId: supervisorId, currentStageKey: nextKey }
  ws.projects[projectId] = updated
  addProjectToIndexMut(ws, updated)
  return true
}

function resolveUpgradeOwnedSecureBudget(
  ws: WorldState,
  config: SimulationConfig,
  project: UpgradeOwnedRealEstateProject,
  projectId: ProjectId,
  absoluteWeek: number,
): boolean {
  if (project.owner.kind !== 'house') return false
  const house = ws.houses[project.owner.id]
  if (!house || !house.active) return false

  // v0.60: 初期確保は required の一部のみ。stock 不足でもハード失敗せず開始し raise_funds で補う。
  const target = Math.min(
    Math.ceil(project.budget.required * config.projectInitialReserveFraction),
    project.budget.required,
  )
  const take = Math.max(0, Math.min(target, house.wealth))
  ws.houses = {
    ...ws.houses,
    [project.owner.id]: { ...house, wealth: house.wealth - take },
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

  const deadlineWeek =
    absoluteWeek + getProjectDeadlineWeeks(config, project.kind, project.targetProgress)

  removeProjectFromIndexMut(ws, project)
  const updated = {
    ...project,
    currentStageKey: nextKey,
    deadlineWeek,
    budget: {
      ...project.budget,
      allocated: take,
      remaining: take,
    },
  }
  ws.projects[projectId] = updated
  addProjectToIndexMut(ws, updated)
  return true
}

// ─── v0.60 raise_funds (資金集めラウンド) ──────────────────────────────────────

type Pledge = { contributor: FundingContributor; amount: number }

// ProjectBudget (構造体予算) を持つ funding 対象 5 種。budget:number の petition 系と区別する。
type FundingBudgetProject =
  | DevelopHoldingProject
  | DevelopRealEstateProject
  | AcquireRealEstateProject
  | UpgradeOwnedRealEstateProject
  | HandleCrisisProject

function isFundingBudgetProject(project: Project): project is FundingBudgetProject {
  return (
    project.kind === 'develop_holding' ||
    project.kind === 'develop_real_estate' ||
    project.kind === 'acquire_real_estate' ||
    project.kind === 'upgrade_owned_real_estate' ||
    project.kind === 'handle_crisis'
  )
}

// 対象 kind の final stage key を返す (handle_crisis→mitigate、他→execute_project)。
function getFinalStageKey(kind: ProjectKind): ProjectStageKey {
  return PROJECT_STAGE_SEQUENCES[kind].find((e) => e.type === 'final')!.key
}

// holding→province→stateId を marketKey として smoothedPrice を引く (resourceEconomySystem と統一)。
function makeProjectPriceLookup(ws: WorldState, project: Project): (r: ResourceKind) => number {
  const marketKey = getProjectMarketKey(ws, project)
  return (resource: ResourceKind) => {
    if (marketKey === null) return getSmoothedPriceOrBase(undefined, resource)
    const ps = ws.marketResourcePrices[marketResourcePriceKey(marketKey, resource)]
    return getSmoothedPriceOrBase(ps?.smoothedPrice, resource)
  }
}

// pledge を出し手の stock から実減算し、**実際に引いた合計額**を返す。
//   各 stock の現在値で clamp し (delta = min(amount, stock))、その delta を加算する。
//   返り値を budget の加算額に使うことで「drain 合計 == budget 増加」を構造的に保証する
//   (pledge が stock を超えても貨幣創造にならない・保存則の防御層)。
function applyPledgeDrains(ws: WorldState, pledges: Pledge[]): number {
  let drained = 0
  for (const { contributor, amount } of pledges) {
    if (contributor.kind === 'polity') {
      const p = ws.polities[contributor.id]
      if (!p) continue
      const d = Math.min(amount, p.treasury)
      ws.polities[contributor.id] = { ...p, treasury: p.treasury - d }
      drained += d
    } else if (contributor.kind === 'house') {
      const h = ws.houses[contributor.id]
      if (!h) continue
      const d = Math.min(amount, h.wealth)
      ws.houses[contributor.id] = { ...h, wealth: h.wealth - d }
      drained += d
    } else if (contributor.kind === 'person') {
      const pe = ws.persons[contributor.id]
      if (!pe) continue
      const d = Math.min(amount, pe.wealth)
      ws.persons[contributor.id] = { ...pe, wealth: pe.wealth - d }
      drained += d
    } else {
      const pop = ws.popGroups[contributor.id]
      if (!pop) continue
      const d = Math.min(amount, pop.money)
      ws.popGroups[contributor.id] = { ...pop, money: pop.money - d }
      drained += d
    }
  }
  return drained
}

// cumulative 主要拠出記録を更新する (pop は DecisionSubjectRef に載らないため除外・amount 降順上位 limit)。
function mergeMajorContributors(
  existing: ProjectContributorRecord[],
  pledges: Pledge[],
  limit: number,
): ProjectContributorRecord[] {
  const map = new Map<string, ProjectContributorRecord>()
  for (const r of existing) map.set(`${r.subject.kind}:${r.subject.id}`, { ...r })
  for (const { contributor, amount } of pledges) {
    if (contributor.kind === 'pop') continue
    let subject: DecisionSubjectRef
    if (contributor.kind === 'polity') subject = { kind: 'polity', id: contributor.id }
    else if (contributor.kind === 'house') subject = { kind: 'house', id: contributor.id }
    else subject = { kind: 'person', id: contributor.id }
    const key = `${subject.kind}:${subject.id}`
    const prev = map.get(key)
    map.set(key, { subject, amount: (prev?.amount ?? 0) + amount })
  }
  return [...map.values()]
    .sort(
      (a, b) =>
        b.amount - a.amount ||
        `${a.subject.kind}:${a.subject.id}`.localeCompare(`${b.subject.kind}:${b.subject.id}`),
    )
    .slice(0, limit)
}

function emitProjectFunded(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  const ownerRef = getOwnerNameRefForEmit(ws, project.owner)
  const supervisorNameKey = ws.persons[project.supervisorPersonId]?.nameKey ?? ''
  emitEvent({
    type: 'PROJECT_FUNDED',
    importance: 'minor',
    messageKey: 'project.funded',
    messageParams: {
      owner: nameParam(ownerRef.category, ownerRef.nameKey),
      supervisor: nameParam('person', supervisorNameKey),
      kind: project.kind,
    },
    entityRefs: [],
  })
}

function emitProjectFundingFailed(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  const ownerRef = getOwnerNameRefForEmit(ws, project.owner)
  emitEvent({
    type: 'PROJECT_FAILED',
    importance: 'minor',
    messageKey: 'project.failed.funding',
    messageParams: {
      owner: nameParam(ownerRef.category, ownerRef.nameKey),
      kind: project.kind,
    },
    entityRefs: [],
  })
}

// v0.60: 資金集めラウンド本体。ステークホルダーから決定的に pledge を集め、最小回収未満なら
//   funding_failed、十分なら budget へ上乗せ (required を超えないよう比例 cap)・deadline 延長・
//   final stage へ復帰する。RNG 不使用・保存則維持。
function resolveRaiseFunds(
  ws: WorldState,
  config: SimulationConfig,
  projectId: ProjectId,
  absoluteWeek: number,
  emitEvent: (input: CreateSimEventInput) => void,
): boolean {
  const project = ws.projects[projectId]
  if (!project || project.status !== 'active') return false
  if (!isFundingBudgetProject(project)) return false

  const priceLookup = makeProjectPriceLookup(ws, project)
  const stakeholders = getProjectFundingStakeholders(ws, config, project)
  const requiredRemaining = Math.max(0, project.budget.required - project.budget.allocated)
  const minNeeded = requiredRemaining * config.projectFundingRoundMinCollectionFraction

  const pledges: Pledge[] = []
  let rawRaised = 0
  for (const c of stakeholders) {
    const amt = computeContributorPledge(ws, config, project, c, priceLookup)
    if (amt > 0) {
      pledges.push({ contributor: c, amount: amt })
      rawRaised += amt
    }
  }

  // 失敗: 最小回収に満たない → funding_failed (Project 頓挫・終了保証 1)。
  if (rawRaised <= 0 || rawRaised < minNeeded) {
    ws.projects[projectId] = {
      ...project,
      status: 'failed',
      terminalReason: 'funding_failed',
    }
    emitProjectFundingFailed(ws, project, emitEvent)
    return true
  }

  // over-collection cap: acquire_real_estate のみ allocated が required を超えないよう各 pledge を
  //   比例縮小する (seller 決済が budget.allocated に依拠するため、超過は seller 過払い=貨幣創造)。
  //   v0.60.1: material-sink 4 種 (develop_holding/develop_real_estate/upgrade_owned_real_estate/
  //   handle_crisis) は余剰 budget が建築資材消費 or 完了時還付に回り保存則安全なため cap しない。
  //   建設資材の品薄で真の所要額が required (margin 2 倍) を超え、cap が required で頭打ちにして
  //   budget_exhausted を量産していた構造を解消する (required は smoothedPrice 非依存の見積りで、
  //   実消費は smoothedPrice 評価ゆえ価格上昇分だけ不足する)。
  const capToRequired = project.kind === 'acquire_real_estate'
  const scale = capToRequired && rawRaised > requiredRemaining ? requiredRemaining / rawRaised : 1
  if (scale !== 1) {
    for (const p of pledges) {
      p.amount = p.amount * scale
    }
  }

  // budget へ加算するのは「実際に stock から引いた合計」(applyPledgeDrains の返り値)。
  //   こうすることで pledge が stock を超えるケースでも「drain 合計 == budget 増加」が構造的に成立する。
  const raised = applyPledgeDrains(ws, pledges)

  const finalKey = getFinalStageKey(project.kind)
  // v0.60: deadline の延長は非 crisis kind のみ。handle_crisis は Crisis.deadlineWeek を単一の真実とし
  //   (非 disrepair)、disrepair は deadline 無し (v0.48.1)。raise_funds で上書きするとそれらを壊すため
  //   project の既存 deadlineWeek を保持する (spread で維持)。
  const updated = {
    ...project,
    budget: {
      ...project.budget,
      allocated: project.budget.allocated + raised,
      remaining: project.budget.remaining + raised,
    },
    fundingRoundCount: (project.fundingRoundCount ?? 0) + 1,
    majorContributors: mergeMajorContributors(
      project.majorContributors ?? [],
      pledges,
      config.projectMajorContributorTrackLimit,
    ),
    currentStageKey: finalKey,
  }
  if (project.kind !== 'handle_crisis') {
    const baseDeadline = Math.max(absoluteWeek, project.deadlineWeek ?? absoluteWeek)
    updated.deadlineWeek = baseDeadline + config.projectFundingDeadlineExtensionWeeks
  }
  ws.projects[projectId] = updated

  const log = createLogger(config.debug)
  // insider/external 内訳 (debug 専用診断・ability 依存が実際に効いているかの計測用)。
  let insiderRaised = 0
  for (const p of pledges) {
    if (p.contributor.kind !== 'pop' && p.contributor.insider) insiderRaised += p.amount
  }
  log.log('PROJECT_RAISE_FUNDS', {
    projectId,
    kind: project.kind,
    round: updated.fundingRoundCount,
    raised,
    insiderRaised,
    externalRaised: raised - insiderRaised,
    allocated: updated.budget.allocated,
    required: updated.budget.required,
  })

  // raised が実質ゼロ (allocated が既に required に到達済みで requiredRemaining=0 等) のラウンドでは
  //   「資金を集めた」イベントは誤解を招くため出さない (round 加算は終了保証のため継続する)。
  if (raised > 0) emitProjectFunded(ws, updated, emitEvent)
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

    // OrganizationRef (polity/house/merchant) は DecisionSubjectRef の部分集合なので直接代入できる。
    const sourceRef: DecisionSubjectRef = play.initiator
    const targetRef: DecisionSubjectRef = play.target

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
        source: nameParam(getOwnerNameRefForEmit(ws, sourceRef).category, sourceNameKey),
        target: nameParam(getOwnerNameRefForEmit(ws, targetRef).category, targetNameKey),
      },
      entityRefs: [
        entityRef(sourceRef.kind, sourceRef.id, 'source', sourceNameKey),
        entityRef(targetRef.kind, targetRef.id, 'target', targetNameKey),
      ],
    })

    return true
  }

  if (result.kind === 'duplicate') {
    ws.projects[projectId] = {
      ...project,
      status: 'failed' as const,
      terminalReason: 'duplicate_play' as const,
    }
    const ownerNameKey = getOwnerNameKey(ws, project.owner)
    emitEvent({
      type: 'PROJECT_FAILED',
      importance: 'minor',
      messageKey: 'project.failed.duplicate_play',
      messageParams: {
        owner: nameParam(getOwnerNameRefForEmit(ws, project.owner).category, ownerNameKey),
        kind: project.kind,
      },
      entityRefs: [],
    })
    return true
  }

  if (result.kind === 'infeasible') {
    // 相手が応じる見込みがない外交劇。プロジェクトを失敗させ、actor を別の行動へ解放する
    // (invalid_inputs と違い毎 tick retry しない)。
    ws.projects[projectId] = {
      ...project,
      status: 'failed' as const,
      terminalReason: 'opponent_too_strong' as const,
    }
    const ownerNameKey = getOwnerNameKey(ws, project.owner)
    emitEvent({
      type: 'PROJECT_FAILED',
      importance: 'minor',
      messageKey: 'project.failed.opponent_too_strong',
      messageParams: {
        owner: nameParam(getOwnerNameRefForEmit(ws, project.owner).category, ownerNameKey),
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

  // person を除いた DecisionSubjectRef は OrganizationRef (polity/house/merchant) に等しい。
  const targetActor: OrganizationRef = pressure.target

  let stance: PressureResponseStance = 'negotiate'

  if (pressure.source.kind !== 'person') {
    const sourceActor: OrganizationRef = pressure.source
    // 開始ゲート (diplomaticPlayCreation) と同一式を共有する単一の真実。
    stance = predictPressureResponseStance(ws, config, sourceActor, targetActor)
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
