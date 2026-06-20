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
import {
  createRealEstateAssetMut,
  upgradeRealEstateAssetLevelMut,
  changeRealEstateAssetOwnerMut,
} from '../mutations/realEstateAssetMutations'
import { adjustPersonAttitude, adjustHouseMembersAttitude } from '../mutations/attitudeMutations'
import {
  createRealEstateSeizureMut,
  changeRealEstateSeizureStatusMut,
} from '../mutations/realEstateSeizureMutations'
import {
  createLandContractDefaultMut,
  changeLandContractDefaultStatusMut,
} from '../mutations/landContractDefaultMutations'
import { getLandContractGrantor } from '../selectors/landContractSelectors'
import { createPressureMut, removeObligationPressuresMut } from '../mutations/pressureMutations'
import { removeCrisisMut, setCrisisStatusMut } from '../mutations/crisisMutations'
import { cancelActiveResponseProjectMut } from './crisisSystem'
import { getHoldingTerminalPolityId } from '../selectors/landContractSelectors'
import { REAL_ESTATE_DEFINITIONS } from '../config/realEstateDefinitions'
import { getPolityLeader, getHouseLeader } from '../selectors/officeSelectors'
import { createOfficeAssignment, revokeOfficesByOrganization } from '../mutations/officeMutations'
import { adjustPersonLegacyPrestige } from '../helpers/attitudeHelpers'
import { isLifeStageAtLeast } from '../types/person'
import {
  getPolityNameRefForEmit,
  getPolityNameRefForEmitFromPolity,
  houseNameParam,
  holdingNameParam,
} from '../selectors/nameRefSelectors'
import type { EventId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import { clamp } from '../utils/math'
import { removeProjectFromIndexMut, isDiplomaticProjectKind } from '../mutations/projectMutations'
import { createPoliticalRight, removePoliticalRight } from '../mutations/politicalRightMutations'
import { getRightForTarget } from '../selectors/politicalRightSelectors'
import { addInfluenceModifier } from '../mutations/influenceModifierMutations'
import { isLivingPerson } from '../types/person'
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
    // v0.53: seize/enforce outcome が createPressureMut → addPressureToIndexMut を呼ぶため
    //   pressureIndex を draft に含める (共有 state in-place 破壊防止, [[project_mutable_draft_writeback_slices]])。
    pressureIndex: {
      byTarget: { ...ctx.state.pressureIndex.byTarget },
      bySource: { ...ctx.state.pressureIndex.bySource },
      byDiplomaticPlay: { ...ctx.state.pressureIndex.byDiplomaticPlay },
      byProject: { ...ctx.state.pressureIndex.byProject },
    },
    // v0.53: seize outcome が RealEstateSeizure を作成するため slice を含める。
    realEstateSeizures: { ...ctx.state.realEstateSeizures },
    realEstateSeizureIndex: {
      byHolding: { ...ctx.state.realEstateSeizureIndex.byHolding },
      byAsset: { ...ctx.state.realEstateSeizureIndex.byAsset },
      byRightfulOwnerHouse: { ...ctx.state.realEstateSeizureIndex.byRightfulOwnerHouse },
    },
    // v0.53: withhold outcome が LandContractDefault を作成するため slice を含める。
    landContractDefaults: { ...ctx.state.landContractDefaults },
    landContractDefaultIndex: {
      byHolding: { ...ctx.state.landContractDefaultIndex.byHolding },
      byContract: { ...ctx.state.landContractDefaultIndex.byContract },
      byClaimantPolity: { ...ctx.state.landContractDefaultIndex.byClaimantPolity },
      byOccupierPolity: { ...ctx.state.landContractDefaultIndex.byOccupierPolity },
    },
    // v0.48 Crisis: handle_crisis 完了時に Crisis を resolved 化・purge するため slice を draft に含める
    //   (含めないと removeCrisisMut が共有 state を破壊する)。popGroups は spread しないので
    //   この system では Crisis のデバフ適用は行わない (= crisisSystem の責務)。
    crises: { ...ctx.state.crises },
    crisisIndex: {
      byHolding: { ...ctx.state.crisisIndex.byHolding },
      byProject: { ...ctx.state.crisisIndex.byProject },
    },
    holdingImprovements: { ...ctx.state.holdingImprovements },
    holdingImprovementIndex: {
      byHolding: { ...ctx.state.holdingImprovementIndex.byHolding },
    },
    realEstateAssets: { ...ctx.state.realEstateAssets },
    realEstateAssetIndex: {
      byHolding: { ...ctx.state.realEstateAssetIndex.byHolding },
      byOwner: { ...ctx.state.realEstateAssetIndex.byOwner },
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
      if (
        (project.kind === 'develop_holding' ||
          project.kind === 'develop_real_estate' ||
          project.kind === 'acquire_real_estate' ||
          project.kind === 'upgrade_owned_real_estate' ||
          project.kind === 'handle_crisis') &&
        project.budget.remaining > 0
      ) {
        if (project.owner.kind === 'polity') {
          const polity = ws.polities[project.owner.id]
          if (polity) {
            ws.polities[project.owner.id] = {
              ...polity,
              treasury: polity.treasury + project.budget.remaining,
            }
          }
        } else if (project.owner.kind === 'house') {
          const house = ws.houses[project.owner.id]
          if (house) {
            ws.houses[project.owner.id] = {
              ...house,
              wealth: house.wealth + project.budget.remaining,
            }
          }
        }
        // ProjectActivityLog for failed (develop_holding 固有フィールドを使うため kind ガード)
        if (project.status === 'failed' && project.kind === 'develop_holding') {
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

    // v0.51 陰謀リファイン: 陰謀 Project が terminal 化したら owner 家に cooldown を記録する
    //   (completed/failed どちらも)。旧 Klaus ループ (完了直後の即再立案) を防ぐ (§4.3)。
    recordConspiracyCooldownMut(ws, project)

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
    case 'undermine_influence':
      applyUndermineInfluenceMut(ws, config, project, emitEvent)
      break
    case 'revoke_political_right':
      applyRevokePoliticalRightMut(ws, project, emitEvent)
      break
    case 'replace_house_leader':
      applyReplaceHouseLeaderMut(ws, project, emitEvent)
      break
    // v0.48 Crisis: 対処完了 → Crisis 解消 (§3.1【新規必須 2】)
    case 'handle_crisis':
      applyHandleCrisisMut(ws, config, project, emitEvent)
      break
    // v0.52 不動産開発
    case 'develop_real_estate':
      applyDevelopRealEstateMut(ws, project, emitEvent)
      break
    // v0.52 不動産取得
    case 'acquire_real_estate':
      applyAcquireRealEstateMut(ws, project, emitEvent)
      break
    // v0.52 所有不動産増築
    case 'upgrade_owned_real_estate':
      applyUpgradeOwnedRealEstateMut(ws, project, emitEvent)
      break
    // v0.53 押領: RealEstateSeizure 作成 + 権利者 House へ Pressure
    case 'seize_real_estate_income':
      applySeizeRealEstateIncomeMut(ws, project, emitEvent)
      break
    // v0.53 上納拒否: LandContractDefault.tax_default 作成 + claimant Polity へ Pressure
    case 'withhold_land_contract_tax':
      applyWithholdLandContractTaxMut(ws, project, emitEvent)
      break
    // v0.53 義務強制 (Phase 1-2 簡易版): 対象 seizure/default を resolved 化
    case 'enforce_obligation':
      applyEnforceObligationMut(ws, project, emitEvent)
      break
  }
}

// v0.53 上納拒否 outcome (§7.2/§11.2)。owner Polity が自身の terminal contract の上納を拒否。
//   LandContractDefault.origin='tax_default' を作成し、claimant (grantor) Polity へ Pressure を立てる。
function applyWithholdLandContractTaxMut(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'withhold_land_contract_tax') return
  const contract = ws.landContracts[project.targetLandContractId]
  if (!contract || contract.rootAuthorityId) return
  // 二重不履行防止
  if (ws.landContractDefaultIndex.byContract[contract.id as string]) return
  const grantor = getLandContractGrantor(ws, contract.id)
  if (!grantor || grantor.kind !== 'polity') return
  const claimantPolityId = grantor.id
  if (!ws.polities[claimantPolityId]?.active) return
  const occupiedByPolityId = project.owner.id

  const d = createLandContractDefaultMut(ws, {
    origin: 'tax_default',
    holdingId: project.holdingId,
    occupiedByPolityId,
    claimantPolityId,
    targetLandContractId: contract.id,
    originalGrantorPolityId: claimantPolityId,
    originalGranteePolityId: occupiedByPolityId,
    originalTaxRateToGrantor: contract.terms.taxRateToGrantor,
    startedWeek: ws.absoluteWeek,
    reasonIds: [...project.reasonIds],
  })

  createPressureMut(ws, {
    kind: 'land_contract_default',
    source: { kind: 'polity', id: occupiedByPolityId },
    target: { kind: 'polity', id: claimantPolityId },
    relatedObligation: { kind: 'land_contract_default', id: d.id },
    priority: 1,
    createdWeek: ws.absoluteWeek,
    status: 'active',
    reasonIds: [],
  })

  const occupierRef = getPolityNameRefForEmit(ws, occupiedByPolityId)
  const claimantRef = getPolityNameRefForEmit(ws, claimantPolityId)
  const holding = ws.holdings[project.holdingId]
  const provinceNameKey = holding ? (ws.provinces[holding.provinceId]?.nameKey ?? '') : ''
  emitEvent({
    type: 'LAND_CONTRACT_DEFAULT_STARTED',
    importance: 'minor',
    messageKey: 'land_contract_default.started',
    messageParams: {
      occupier: nameParam(occupierRef.category, occupierRef.nameKey),
      claimant: nameParam(claimantRef.category, claimantRef.nameKey),
      province: nameParam('province', provinceNameKey),
    },
    entityRefs: [
      entityRef('polity', occupiedByPolityId, 'occupier', occupierRef.nameKey),
      entityRef('polity', claimantPolityId, 'claimant', claimantRef.nameKey),
      entityRef('holding', project.holdingId, 'holding'),
    ],
  })
}

// v0.53 押領 outcome (§7.2/§11.1)。owner Polity が holding 内の脆弱 House-owned asset を押領。
//   RealEstateSeizure を作成し、rightfulOwner House へ real_estate_seizure Pressure を立てる。
//   asset.owner は保持したまま (LandRevenue 上だけ owner income を止める, §25)。
function applySeizeRealEstateIncomeMut(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'seize_real_estate_income') return
  const asset = ws.realEstateAssets[project.targetRealEstateAssetId]
  if (!asset) return
  if (asset.owner?.kind !== 'house') return
  // 二重押領防止 (同一 asset に active seizure は最大 1)
  if (ws.realEstateSeizureIndex.byAsset[asset.id as string]) return
  const rightfulOwner = asset.owner
  const ownerHouse = ws.houses[rightfulOwner.id]
  if (!ownerHouse || !ownerHouse.active) return
  const seizerPolityId = project.owner.id

  const seizure = createRealEstateSeizureMut(ws, {
    holdingId: project.holdingId,
    assetId: asset.id,
    seizerPolityId,
    rightfulOwner,
    startedWeek: ws.absoluteWeek,
    reasonIds: [...project.reasonIds],
  })

  // 権利者 House へ Pressure (B1: pressureSystem が enforce を起案する)
  createPressureMut(ws, {
    kind: 'real_estate_seizure',
    source: { kind: 'polity', id: seizerPolityId },
    target: { kind: 'house', id: rightfulOwner.id },
    relatedObligation: { kind: 'real_estate_seizure', id: seizure.id },
    priority: 1,
    createdWeek: ws.absoluteWeek,
    status: 'active',
    reasonIds: [],
  })

  const holding = ws.holdings[project.holdingId]
  const polityRef = getPolityNameRefForEmit(ws, seizerPolityId)
  const houseNameKey = ownerHouse.nameKey
  const provinceNameKey = holding ? (ws.provinces[holding.provinceId]?.nameKey ?? '') : ''
  emitEvent({
    type: 'REAL_ESTATE_SEIZURE_STARTED',
    importance: 'minor',
    messageKey: 'real_estate_seizure.started',
    messageParams: {
      polity: nameParam(polityRef.category, polityRef.nameKey),
      house: nameParam('house', houseNameKey),
      province: nameParam('province', provinceNameKey),
    },
    entityRefs: [
      entityRef('polity', seizerPolityId, 'polity', polityRef.nameKey),
      entityRef('house', rightfulOwner.id, 'owner', houseNameKey),
      entityRef('holding', project.holdingId, 'holding'),
      ...(holding ? [entityRef('province', holding.provinceId, 'province', provinceNameKey)] : []),
    ],
  })
}

// v0.53 義務強制 outcome (Phase 1-2 簡易版, §10.1)。成功した enforce は対象 seizure/default を
//   resolved にし、関連 Pressure を削除する。
function applyEnforceObligationMut(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'enforce_obligation') return

  if (project.target.kind === 'land_contract_default') {
    const d = ws.landContractDefaults[project.target.id]
    if (!d || d.status !== 'active') return
    changeLandContractDefaultStatusMut(ws, d.id, 'resolved')
    removeObligationPressuresMut(ws, { kind: 'land_contract_default', id: d.id })
    const claimantRef = getPolityNameRefForEmit(ws, d.claimantPolityId)
    const occupierRef = getPolityNameRefForEmit(ws, d.occupiedByPolityId)
    const holding = ws.holdings[d.holdingId]
    const provinceNameKey = holding ? (ws.provinces[holding.provinceId]?.nameKey ?? '') : ''
    emitEvent({
      type: 'LAND_CONTRACT_DEFAULT_RESOLVED',
      importance: 'minor',
      messageKey: 'land_contract_default.resolved',
      messageParams: {
        claimant: nameParam(claimantRef.category, claimantRef.nameKey),
        occupier: nameParam(occupierRef.category, occupierRef.nameKey),
        province: nameParam('province', provinceNameKey),
      },
      entityRefs: [
        entityRef('polity', d.claimantPolityId, 'claimant', claimantRef.nameKey),
        entityRef('polity', d.occupiedByPolityId, 'occupier', occupierRef.nameKey),
        entityRef('holding', d.holdingId, 'holding'),
      ],
    })
    return
  }

  if (project.target.kind !== 'real_estate_seizure') return
  const seizure = ws.realEstateSeizures[project.target.id]
  if (!seizure || seizure.status !== 'active') return

  changeRealEstateSeizureStatusMut(ws, seizure.id, 'resolved')

  // この seizure に紐づく Pressure (relatedObligation 一致) を削除する
  removeObligationPressuresMut(ws, { kind: 'real_estate_seizure', id: seizure.id })

  const holding = ws.holdings[seizure.holdingId]
  const ownerHouse =
    seizure.rightfulOwner.kind === 'house' ? ws.houses[seizure.rightfulOwner.id] : undefined
  const houseNameKey = ownerHouse?.nameKey ?? ''
  const provinceNameKey = holding ? (ws.provinces[holding.provinceId]?.nameKey ?? '') : ''
  emitEvent({
    type: 'REAL_ESTATE_SEIZURE_RESOLVED',
    importance: 'minor',
    messageKey: 'real_estate_seizure.resolved',
    messageParams: {
      house: nameParam('house', houseNameKey),
      province: nameParam('province', provinceNameKey),
    },
    entityRefs: [
      ...(seizure.rightfulOwner.kind === 'house'
        ? [entityRef('house', seizure.rightfulOwner.id, 'owner', houseNameKey)]
        : []),
      entityRef('holding', seizure.holdingId, 'holding'),
    ],
  })
}

// v0.48 Crisis: handle_crisis 完了の効果。対処 Project が targetProgress に到達 = Crisis 解消。
//   CRISIS_RESOLVED を emit してから即 purge する (terminal Crisis を年末 integrity §6 C3 に残さない。
//   完了 Project は同 tick で削除されるのと対称, §2.4)。
function applyHandleCrisisMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'handle_crisis') return
  const crisis = ws.crises[project.crisisId]
  if (!crisis) return
  // §5.3 案 A: unrest は purge せず resolved を mark するだけ。譲歩/鎮静 (commonwealth/play なしの
  //   concession) は ctx ベースの unrestCrisisSystem が同 tick で適用する (Decision 1)。
  if (crisis.kind === 'unrest') {
    setCrisisStatusMut(ws, project.crisisId, 'resolved')
    return
  }
  // v0.48.1 §4.2: disrepair の修理完了 → 対象 improvement の condition を回復してから (下の) 汎用 purge へ。
  //   load-bearing: 回復を省くと condition が閾値以下のまま翌サイクルで再 spawn される無限 churn になる。
  //   improvement が既に消滅 (全壊) していたら回復 no-op で purge のみ。回復後は generic emit+purge に fall-through。
  if (crisis.kind === 'disrepair') {
    const impId = crisis.targetImprovementId
    const imp = impId ? ws.holdingImprovements[impId] : undefined
    if (imp) {
      // per-object spread (Record clone だけでは本体が共有参照のまま → cross-tick 汚染)
      ws.holdingImprovements[imp.id] = { ...imp, condition: config.facilityRepairConditionRestore }
    }
  }
  emitEvent({
    type: 'CRISIS_RESOLVED',
    importance: 'normal',
    messageKey: 'crisis.resolved',
    messageParams: {
      crisisKind: crisis.kind,
      holding: holdingNameParam(ws, crisis.holdingId),
    },
    entityRefs: [entityRef('holding', crisis.holdingId, 'holding')],
  })
  removeCrisisMut(ws, project.crisisId)
}

// v0.51 陰謀リファイン: 陰謀 Project の kind 集合 (cooldown 記録対象)。
const CONSPIRACY_PROJECT_KINDS: ReadonlySet<Project['kind']> = new Set([
  'undermine_influence',
  'revoke_political_right',
  'replace_house_leader',
])

// v0.51 陰謀リファイン: 分家当主交代完遂の効果 (旧 plotSystem applyPlotSuccess replace_house_leader 移植)。
// 対象分家の当主を prestige 最上位の生存成人に交代し、役職移譲・respect 調整・首謀者 prestige+5。
// 成否は Task が判定済み (この handler は completed 前提)。対象分家消滅 / 後継不在なら no-op。
function applyReplaceHouseLeaderMut(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'replace_house_leader') return
  if (project.owner.kind !== 'house') return
  const targetHouse = ws.houses[project.targetHouseId]
  if (!targetHouse || !targetHouse.active) return

  const currentHeadId = getHouseLeader(ws, targetHouse.id)
  // 対象分家の生存成人 (現当主以外) から prestige 最上位を後継に選ぶ
  const newHead = targetHouse.memberIds
    .map((id) => ws.persons[id])
    .filter(
      (p): p is NonNullable<typeof p> =>
        p !== undefined &&
        p.alive &&
        isLifeStageAtLeast(p.lifeStage, 'young_adulthood') &&
        (p.id as string) !== (currentHeadId ?? ''),
    )
    .sort((a, b) => b.legacyPrestige - a.legacyPrestige)[0]
  if (!newHead) return // 後継候補なし → no-op

  // 役職移譲: leader を revoke してから新当主に付与 (immutable helper → draft 書き戻し)
  const targetOrgRef: OrganizationRef = { kind: 'house', id: targetHouse.id }
  let s = revokeOfficesByOrganization(ws, targetOrgRef, 'leader')
  s = createOfficeAssignment(s, targetOrgRef, 'leader', newHead.id)
  // adjustHouseMembersAttitude / adjustPersonLegacyPrestige も immutable helper
  if (currentHeadId) {
    const r = adjustHouseMembersAttitude(
      s,
      targetHouse.id,
      { kind: 'person', id: currentHeadId },
      { respect: -10 },
    )
    if (r.ok) s = r.value
  }
  const r2 = adjustHouseMembersAttitude(
    s,
    targetHouse.id,
    { kind: 'person', id: newHead.id },
    { respect: 8 },
  )
  if (r2.ok) s = r2.value
  // 首謀者 (supervisor) の prestige +5
  s = adjustPersonLegacyPrestige(s, project.supervisorPersonId, 5)

  // draft へ全面書き戻し。createOfficeAssignment は nextOfficeAssignmentId も進めるため必ず含める
  // (落とすと OfficeAssignmentId 衝突 → leader office が別 house を指す等の破損を生む)。
  ws.persons = s.persons
  ws.houses = s.houses
  ws.officeAssignments = s.officeAssignments
  ws.officeIndex = s.officeIndex
  ws.nextOfficeAssignmentId = s.nextOfficeAssignmentId

  const instigator = ws.persons[project.supervisorPersonId]
  emitEvent({
    type: 'HOUSE_LEADER_REPLACED',
    importance: 'major',
    messageKey: 'house_conspiracy.leader_replaced',
    messageParams: {
      instigator: nameParam('person', instigator?.nameKey ?? project.supervisorPersonId),
      house: houseNameParam(targetHouse, targetHouse.id),
      newHead: nameParam('person', newHead.nameKey),
    },
    entityRefs: [
      entityRef('person', project.supervisorPersonId, 'instigator', instigator?.nameKey),
      entityRef('house', targetHouse.id, 'target'),
      entityRef('person', newHead.id, 'new_head', newHead.nameKey),
    ],
  })
}

// 陰謀 Project が terminal 化したとき owner 家に lastConspiracyResolvedWeek を記録する (連発防止 §4.3)。
function recordConspiracyCooldownMut(ws: WorldState, project: Project): void {
  if (!CONSPIRACY_PROJECT_KINDS.has(project.kind)) return
  if (project.owner.kind !== 'house') return
  const house = ws.houses[project.owner.id]
  if (!house) return
  ws.houses[project.owner.id] = { ...house, lastConspiracyResolvedWeek: ws.absoluteWeek }
}

// v0.51 陰謀リファイン: 影響力毀損完遂の効果。対象 (家/人物) に負の InfluenceModifier を生成する。
// 削除前提でなく加法 (modifier を 1 件足す)。失敗/中断時は呼ばれない (handler は completed 前提)。
// budget なし (v1 無料)。supervisor の insight 経験は awardProjectOutcomeMut が別途付与する。
function applyUndermineInfluenceMut(
  ws: WorldState,
  config: SimulationConfig,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'undermine_influence') return
  const polity = ws.polities[project.polityId]
  if (!polity || !polity.active) return
  const supervisor = ws.persons[project.supervisorPersonId]
  if (!supervisor || !supervisor.alive || supervisor.kind === 'placeholder') return

  // target の生存/有効を outcome 時点で再検証 (aim 生成〜完了の間に消滅しうる)。
  let targetParam: ReturnType<typeof nameParam>
  if (project.target.kind === 'house') {
    const targetHouse = ws.houses[project.target.id]
    if (!targetHouse || !targetHouse.active) return
    targetParam = houseNameParam(targetHouse, project.target.id)
  } else {
    const targetPerson = ws.persons[project.target.id]
    if (!isLivingPerson(targetPerson)) return
    targetParam = nameParam('person', targetPerson.nameKey)
  }

  const created = addInfluenceModifier(ws, {
    polityId: project.polityId,
    target: project.target,
    delta: -config.conspiracyUndermineInfluenceAmount,
    causeKind: 'conspiracy_undermine',
    sourcePersonId: project.supervisorPersonId,
    grantedWeek: ws.absoluteWeek,
    expiryWeek: ws.absoluteWeek + config.conspiracyUndermineInfluenceDurationWeeks,
  })
  if (!created.ok) return
  // addInfluenceModifier は immutable に新 state を返すため draft に書き戻す
  ws.influenceModifiers = created.value.state.influenceModifiers
  ws.influenceModifierIndex = created.value.state.influenceModifierIndex
  ws.nextInfluenceModifierId = created.value.state.nextInfluenceModifierId

  const polityNameRef = getPolityNameRefForEmitFromPolity(ws, polity)
  const targetRef =
    project.target.kind === 'house'
      ? entityRef('house', project.target.id, 'target')
      : entityRef('person', project.target.id, 'target')
  emitEvent({
    type: 'INFLUENCE_UNDERMINED',
    importance: 'normal',
    messageKey: 'influence.undermined',
    messageParams: {
      source: nameParam('person', supervisor.nameKey),
      target: targetParam,
      polity: nameParam(polityNameRef.category, polityNameRef.nameKey),
    },
    entityRefs: [
      entityRef('person', project.supervisorPersonId, 'source', supervisor.nameKey),
      targetRef,
      entityRef('polity', project.polityId, 'polity', polityNameRef.nameKey),
    ],
  })
}

// v0.51 陰謀リファイン: 任命権失効完遂の効果。対象 right を removePoliticalRight で国に戻す。
// 現職 OfficeAssignment は触らない (任命権の削除のみ)。削除前に「その right が今もライバル
// (自家以外) 保有か」を再検証する (aim 生成〜完了の間に holder が変わる可能性への保険・§3.3)。
function applyRevokePoliticalRightMut(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'revoke_political_right') return
  if (project.owner.kind !== 'house') return
  const conspiringHouseId = project.owner.id
  const right = getRightForTarget(ws, project.target)
  if (!right) return // 既に失効済 / holder 交代で消滅 → no-op

  // holder がライバル (自家・自家メンバー以外) であることを再検証する。
  const conspiringHouse = ws.houses[conspiringHouseId]
  const memberSet = new Set<string>(
    conspiringHouse ? conspiringHouse.memberIds.map((id) => id as string) : [],
  )
  if (right.holder.kind === 'house') {
    if (right.holder.id === conspiringHouseId) return // 自家の right は剥奪しない
  } else if (memberSet.has(right.holder.id)) {
    return // 自家メンバーの right は剥奪しない
  }

  // emit 用に削除前の right snapshot を使う (削除後は state から引けない)。
  const eventRefs = buildPoliticalRightEntityRefs(ws, right)
  const polityRef = getPolityNameRefForEmit(ws, right.polityId)
  const holderParam =
    right.holder.kind === 'person'
      ? nameParam('person', ws.persons[right.holder.id]?.nameKey ?? right.holder.id)
      : houseNameParam(ws.houses[right.holder.id], right.holder.id)

  // removePoliticalRight は immutable に新 state を返すため draft に書き戻す
  const next = removePoliticalRight(ws, right.id)
  ws.politicalRights = next.politicalRights
  ws.politicalRightIndex = next.politicalRightIndex

  emitEvent({
    type: 'POLITICAL_RIGHT_REVOKED',
    importance: 'normal',
    messageKey: 'political_right.revoked',
    messageParams: {
      rightKind: getPoliticalRightKindFromTarget(right.target),
      target: politicalRightTargetNameParam(ws, right.target),
      holder: holderParam,
      polity: nameParam(polityRef.category, polityRef.nameKey),
      revokeReason: 'revoked_by_conspiracy',
    },
    entityRefs: eventRefs,
  })
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
    // v0.48.1: 開発完了で condition をリセット (新規生成 condition:100 と対称)。
    //   機能不全中の設備を develop すると修繕も完了したとみなし、対象の active disrepair Crisis を
    //   purge + 修理 Project を cancel する (condition だけ戻して Crisis を残すと健全な設備に
    //   active disrepair Crisis がぶら下がる不整合になるため)。
    ws.holdingImprovements[existingImpId] = {
      ...existing,
      level: project.targetImprovementLevel,
      condition: config.facilityRepairConditionRestore,
    }
    const crisisIds = [...(ws.crisisIndex.byHolding[holdingId as string] ?? [])]
    for (const cid of crisisIds) {
      const c = ws.crises[cid]
      if (
        c &&
        c.kind === 'disrepair' &&
        (c.targetImprovementId as string) === (existingImpId as string)
      ) {
        cancelActiveResponseProjectMut(ws, c.id, 'target_repaired')
        removeCrisisMut(ws, c.id)
      }
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

function applyDevelopRealEstateMut(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'develop_real_estate') return
  const holdingId = project.holdingId
  const holding = ws.holdings[holdingId]
  if (!holding) return

  if (project.targetRealEstateAssetId) {
    upgradeRealEstateAssetLevelMut(
      ws,
      project.targetRealEstateAssetId,
      project.targetRealEstateLevel,
    )
  } else {
    createRealEstateAssetMut(ws, {
      holdingId,
      realEstateKind: project.realEstateKind,
      level: project.targetRealEstateLevel,
      createdWeek: ws.absoluteWeek,
    })
  }

  if (project.budget.remaining > 0) {
    const supervisor = ws.persons[project.supervisorPersonId]
    if (supervisor) {
      ws.persons[project.supervisorPersonId] = {
        ...supervisor,
        wealth: supervisor.wealth + project.budget.remaining,
      }
    }
  }

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
      entityRef('holding', holdingId, 'holding'),
    ],
  })
}

function applyAcquireRealEstateMut(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'acquire_real_estate') return
  const asset = ws.realEstateAssets[project.targetRealEstateAssetId]
  if (!asset) return
  if (asset.owner) return

  const terminalPolityId = getHoldingTerminalPolityId(ws, project.holdingId)
  if (terminalPolityId) {
    const polity = ws.polities[terminalPolityId]
    if (polity) {
      ws.polities[terminalPolityId] = {
        ...polity,
        treasury: polity.treasury + project.salePrice,
      }
    }
  }

  changeRealEstateAssetOwnerMut(ws, project.targetRealEstateAssetId, {
    kind: 'house',
    id: project.owner.id,
  })

  const holding = ws.holdings[project.holdingId]
  const houseNameKey = ws.houses[project.owner.id]?.nameKey ?? ''
  const provinceNameKey = holding ? (ws.provinces[holding.provinceId]?.nameKey ?? '') : ''
  emitEvent({
    type: 'COUNTRY_LAND_DEVELOPED',
    importance: 'minor',
    messageKey: 'polity.land_developed',
    messageParams: {
      polity: nameParam('house', houseNameKey),
      province: nameParam('province', provinceNameKey),
    },
    entityRefs: [
      entityRef('house', project.owner.id, 'owner', houseNameKey),
      entityRef('holding', project.holdingId, 'holding'),
    ],
  })
}

function applyUpgradeOwnedRealEstateMut(
  ws: WorldState,
  project: Project,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  if (project.kind !== 'upgrade_owned_real_estate') return
  const asset = ws.realEstateAssets[project.targetRealEstateAssetId]
  if (!asset) return
  if (!asset.owner) return
  if (
    asset.owner.kind !== project.owner.kind ||
    (asset.owner.id as string) !== (project.owner.id as string)
  )
    return
  const def = REAL_ESTATE_DEFINITIONS[asset.realEstateKind]
  const holding = ws.holdings[project.holdingId]
  const maxLevel = def.maxLevelByHoldingKind[holding?.kind ?? 'manor'] ?? 3
  if (asset.level >= maxLevel) return

  upgradeRealEstateAssetLevelMut(ws, project.targetRealEstateAssetId, project.targetRealEstateLevel)

  if (project.budget.remaining > 0 && project.owner.kind === 'house') {
    const house = ws.houses[project.owner.id]
    if (house) {
      ws.houses[project.owner.id] = {
        ...house,
        wealth: house.wealth + project.budget.remaining,
      }
    }
  }

  const ownerNameKey =
    project.owner.kind === 'house' ? (ws.houses[project.owner.id]?.nameKey ?? '') : ''
  const provinceNameKey = holding ? (ws.provinces[holding.provinceId]?.nameKey ?? '') : ''
  emitEvent({
    type: 'COUNTRY_LAND_DEVELOPED',
    importance: 'minor',
    messageKey: 'polity.land_developed',
    messageParams: {
      polity: nameParam('house', ownerNameKey),
      province: nameParam('province', provinceNameKey),
    },
    entityRefs: [
      entityRef('house', project.owner.id, 'owner', ownerNameKey),
      entityRef('holding', project.holdingId, 'holding'),
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
      house: houseNameParam(house, houseId),
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
    messageParams: { house: houseNameParam(house, houseId) },
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
    messageParams: { house: houseNameParam(house, houseId) },
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
