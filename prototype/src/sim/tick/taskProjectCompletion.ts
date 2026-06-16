import type { CreateSimEventInput } from './context'
import { nameParam, entityRef } from '../types/event'
import type { Aim } from '../types/goal'
import type { TaskOutcomeKind } from '../types/task'
import type { WorldState } from '../types/world'
import { getOwnerNameKey, getOwnerNameRefForEmit } from '../utils/ownerNames'
import type { PersonId, HoldingId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProjectId, HouseId } from '../types/ids'
import type {
  Project,
  LandClaimProject,
  ContractRevisionProject,
  ProjectBudget,
  ProjectKind,
} from '../types/project'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { PopClass, PopOccupation } from '../types/popGroup'
import {
  getHoldingImprovementLevel,
  canBuildHoldingImprovement,
} from '../selectors/holdingImprovementSelectors'
import { getHoldingOccupationRemainingCapacity } from '../selectors/popSelectors'
import { IMPROVEMENT_DEFINITIONS } from '../config/improvementDefinitions'
import { createProjectId } from '../types/ids'
import {
  addProjectToIndexMut,
  aimKindToProjectKind,
  isDiplomaticProjectKind,
  getProjectDeadlineWeeks,
} from '../mutations/projectMutations'
import { getRightForTarget, getPolityIdForRightTarget } from '../selectors/politicalRightSelectors'
import { selectProjectSupervisor } from '../selectors/projectSelectors'
import { selectMovementBeneficiary } from '../selectors/goalSelectors'
import { getProvinceHoldings, getLandContractGrantor } from '../selectors/landContractSelectors'
import {
  politiesShareOwnerHouse,
  getHouseDomainConsolidationSinkPolityId,
  getHousePrimaryPolityId,
} from '../selectors/polityRelations'
import {
  resolveLandGrantDonor,
  resolveCadetBranchTransfer,
  resolveRepublicHouseFounding,
  canPromotePolityRank,
  selectRankPromotionApprover,
} from '../selectors/petitionSelectors'
import type { PolityRank } from '../types/polity'
import { getPolityLeader } from '../selectors/officeSelectors'
import { getInitialProjectStageKey, getNextProjectStageKey } from '../config/projectStageSequences'
import { resolveImmediateStages } from './projectStageSystem'

// --- prepare_project completion ---

export function handlePrepareProjectCompletionMut(
  ws: WorldState,
  config: SimulationConfig,
  aim: Aim,
  creatorPersonId: PersonId,
  absoluteWeek: number,
  emitEvent: (input: CreateSimEventInput) => void,
  outcome: TaskOutcomeKind,
): void {
  const projectKind = aimKindToProjectKind(aim.kind)
  if (!projectKind) {
    ws.aims[aim.id] = { ...aim, activeTaskId: undefined } as unknown as Aim
    return
  }

  if (outcome === 'failure') {
    ws.aims[aim.id] = { ...aim, activeTaskId: undefined } as unknown as Aim
    return
  }

  const fields = buildProjectFieldsForAim(ws, config, aim, projectKind)
  if (!fields) {
    ws.aims[aim.id] = { ...aim, activeTaskId: undefined } as unknown as Aim
    return
  }

  // v0.44 §6.4: personal_training は本人が owner/creator/supervisor を兼ねる (選定しない)
  // 影響力個人中心化 Phase 1b: 運動は sponsoredPersonId (推薦 member) を supervisor に固定する。
  //   auto 選定を bypass しないと評判が別人に付き dual-tag が誤ったキャリアに流入する (load-bearing)。
  const supervisorId =
    projectKind === 'personal_training'
      ? creatorPersonId
      : projectKind === 'movement_campaign'
        ? ((fields as { sponsoredPersonId?: PersonId }).sponsoredPersonId ?? creatorPersonId)
        : (selectProjectSupervisor(ws, config, aim.owner, projectKind, creatorPersonId) ??
          creatorPersonId)

  const projectId: ProjectId = createProjectId(ws.nextProjectId)
  const targetProgress =
    outcome === 'partial'
      ? config.projectDefaultTargetProgress + config.prepareProjectPartialTargetProgressPenalty
      : config.projectDefaultTargetProgress
  const deadlineWeeks = getProjectDeadlineWeeks(config, projectKind, targetProgress)
  const deadlineWeek = aim.deadlineWeek
    ? Math.min(aim.deadlineWeek, absoluteWeek + deadlineWeeks)
    : absoluteWeek + deadlineWeeks

  const project: Project = {
    id: projectId,
    owner: aim.owner,
    origin: { kind: 'aim', aimId: aim.id },
    kind: projectKind,
    creatorPersonId,
    supervisorPersonId: supervisorId,
    status: 'active',
    progress: 0,
    targetProgress,
    createdWeek: absoluteWeek,
    deadlineWeek,
    reasonIds: [...aim.reasonIds],
    ...fields,
  } as Project

  ws.projects[projectId] = project
  ws.nextProjectId++
  addProjectToIndexMut(ws, project)

  resolveImmediateStages(ws, config, projectId, absoluteWeek)

  ws.aims[aim.id] = { ...aim, activeTaskId: undefined } as unknown as Aim

  const ownerNameKey = getOwnerNameKey(ws, aim.owner)
  emitEvent({
    type: 'PROJECT_STARTED',
    importance: 'minor',
    messageKey: 'project.started',
    messageParams: {
      owner: nameParam(getOwnerNameRefForEmit(ws, aim.owner).category, ownerNameKey),
      kind: projectKind,
    },
    entityRefs: [entityRef(aim.owner.kind, aim.owner.id, 'owner', ownerNameKey)],
  })
}

const OCCUPATION_TO_CLASS: Partial<Record<PopOccupation, PopClass>> = {
  agriculture: 'peasants',
  urban_labor: 'townsmen',
  elite_service: 'nobles',
}

// v0.33 §11.2: IMPROVEMENT_DEFINITIONS 駆動。canBuildHoldingImprovement で候補を絞り
// （生 maxLevel の >= 比較は undefined を無制限と誤読するため使わない）、
// capacityRole='capacity' を優先、不足 occupation を増やせる kind を優先、同条件は level 最小。
function selectImprovementKind(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): HoldingImprovementKind | undefined {
  // 列挙順は IMPROVEMENT_DEFINITIONS のキー順で固定（決定性）。
  const buildable = (Object.keys(IMPROVEMENT_DEFINITIONS) as HoldingImprovementKind[]).filter((k) =>
    canBuildHoldingImprovement(ws, config, holdingId, k),
  )
  if (buildable.length === 0) return undefined

  // capacity 設備を優先。capacity 候補が無いときのみ production_quality（storage/transport）を許可。
  const capacityKinds = buildable.filter(
    (k) => IMPROVEMENT_DEFINITIONS[k].capacityRole === 'capacity',
  )
  const pool = capacityKinds.length > 0 ? capacityKinds : buildable

  // deficit = 対象 occupation の remaining capacity の最小値（小さいほど逼迫＝優先）。
  // production_quality は targetOccupations 無し → deficit = Infinity（level tiebreak のみ）。
  let bestKind: HoldingImprovementKind | undefined
  let bestDeficit = Infinity
  let bestLevel = Infinity
  for (const k of pool) {
    const def = IMPROVEMENT_DEFINITIONS[k]
    const curLevel = getHoldingImprovementLevel(ws, holdingId, k)
    let deficit = Infinity
    for (const occ of def.targetOccupations ?? []) {
      const popClass = OCCUPATION_TO_CLASS[occ]
      if (!popClass) continue
      const remaining = getHoldingOccupationRemainingCapacity(ws, config, holdingId, popClass, occ)
      if (remaining < deficit) deficit = remaining
    }
    if (deficit < bestDeficit || (deficit === bestDeficit && curLevel < bestLevel)) {
      bestDeficit = deficit
      bestLevel = curLevel
      bestKind = k
    }
  }
  return bestKind
}

// 調査 §1.6: 文化系 project (wealth コストを持つ) を作成して良いか。
// 作成時に house が払えなければ false → project を作らず aim を待機させ、完了時の
// silent no-op (PROJECT_COMPLETED は出るが効果ゼロ) を未然に防ぐ。
function canAffordCulturalProject(
  ws: WorldState,
  houseId: HouseId | undefined,
  cost: number,
): boolean {
  if (!houseId) return false
  const house = ws.houses[houseId]
  return house !== undefined && house.active && house.wealth >= cost
}

function buildProjectFieldsForAim(
  ws: WorldState,
  config: SimulationConfig,
  aim: Aim,
  projectKind: string,
): Record<string, unknown> | undefined {
  switch (projectKind) {
    case 'develop_holding': {
      const holdingId = aim.target?.kind === 'holding' ? aim.target.id : undefined
      if (!holdingId) return undefined
      const holding = ws.holdings[holdingId]
      if (!holding) return undefined

      // v0.27 §15 / v0.42: 同一 holding の active develop_holding は 1 件まで (§19.4 integrity)。
      // projectPreparationSystem の同ガードは prepare task 発行時のみで、複数の prepare task が
      // 並走すると completion 時に 2 件目が生成されるレースがあった (latent — RNG パスに依存)。
      // creation 側でも同じ判定を行いレースを閉じる。
      const refKey = `holding:${holdingId}`
      const existingPids = ws.projectIndex.byRelatedEntity[refKey] ?? []
      const hasActiveDev = existingPids.some((pid) => {
        const p = ws.projects[pid]
        return p && p.kind === 'develop_holding' && p.status === 'active'
      })
      if (hasActiveDev) return undefined

      const improvementKind = selectImprovementKind(ws, config, holdingId)
      if (!improvementKind) return undefined

      const currentLevel = getHoldingImprovementLevel(ws, holdingId, improvementKind)
      const targetLevel = currentLevel + 1

      const baseCost = config.developHoldingProjectBaseCostByImprovementKind[improvementKind]
      const costMult = config.improvementLevelCostMultiplier[targetLevel] ?? 1
      const required = baseCost * costMult * config.projectBudgetMarginMultiplier

      const baseProgress =
        config.developHoldingProjectBaseProgressByImprovementKind[improvementKind]
      const progMult = config.improvementLevelProgressMultiplier[targetLevel] ?? 1

      return {
        holdingId,
        improvementKind,
        targetImprovementLevel: targetLevel,
        currentStageKey: getInitialProjectStageKey('develop_holding'),
        budget: {
          required,
          allocated: 0,
          remaining: 0,
          spent: 0,
          source: { kind: 'owner' },
        } satisfies ProjectBudget,
        targetProgress: baseProgress * progMult,
      }
    }
    case 'personal_training': {
      // v0.44 §6.5-4: aim.target.ability を trainingAbilityKey にコピーする
      if (aim.owner.kind !== 'person') return undefined
      const abilityKey = aim.target?.kind === 'ability' ? aim.target.ability : undefined
      if (!abilityKey) return undefined
      return {
        traineePersonId: aim.owner.id,
        trainingAbilityKey: abilityKey,
        currentStageKey: getInitialProjectStageKey('personal_training'),
        targetProgress: config.personalTrainingTargetProgress,
      }
    }
    case 'promote_policy_shift': {
      const polityId = aim.target?.kind === 'polity' ? aim.target.id : undefined
      const houseId = aim.owner.kind === 'house' ? aim.owner.id : undefined
      return {
        polityId,
        houseId,
        currentStageKey: getInitialProjectStageKey('promote_policy_shift'),
      }
    }
    case 'acquire_political_right': {
      const houseId = aim.owner.kind === 'house' ? aim.owner.id : undefined
      const rightTarget =
        aim.target?.kind === 'political_right_target' ? aim.target.target : undefined
      if (!houseId || !rightTarget) return undefined
      // target から対象 polity を導出 (§13.3)
      const polityId = getPolityIdForRightTarget(ws, rightTarget)
      if (!polityId) return undefined
      // 既に right が付いたなら作らない (aim は待機後に失効する)
      if (getRightForTarget(ws, rightTarget)) return undefined
      if (!canAffordCulturalProject(ws, houseId, config.acquirePoliticalRightBaseCost))
        return undefined
      return {
        polityId,
        target: rightTarget,
        budget: config.acquirePoliticalRightBaseCost,
        spentBudget: 0,
        currentStageKey: getInitialProjectStageKey('acquire_political_right'),
      }
    }
    case 'movement_campaign': {
      // 影響力個人中心化 Phase 1b: 運動。owner=家・target=aim.target polity・
      // sponsoredPersonId=推薦 member (= supervisor = 受益者)。
      const houseId = aim.owner.kind === 'house' ? aim.owner.id : undefined
      const polityId = aim.target?.kind === 'polity' ? aim.target.id : undefined
      if (!houseId || !polityId) return undefined
      if (!canAffordCulturalProject(ws, houseId, config.movementProjectBaseCost)) return undefined
      const sponsoredPersonId = selectMovementBeneficiary(ws, config, houseId, polityId)
      if (!sponsoredPersonId) return undefined
      return {
        targetPolityId: polityId,
        sponsoredPersonId,
        budget: config.movementProjectBaseCost,
        spentBudget: 0,
        currentStageKey: getInitialProjectStageKey('movement_campaign'),
      }
    }
    case 'undermine_influence': {
      // v0.51 陰謀リファイン: owner=家・target=ライバル (家/人物)・polityId=自家の primary polity。
      // budget なし (v1 無料)。aim.target は covert aim 生成側 (pickHouseAim) が house/person で確定。
      const houseId = aim.owner.kind === 'house' ? aim.owner.id : undefined
      if (!houseId) return undefined
      const polityId = getHousePrimaryPolityId(ws, houseId)
      if (!polityId) return undefined
      const target =
        aim.target?.kind === 'house'
          ? ({ kind: 'house', id: aim.target.id } as const)
          : aim.target?.kind === 'person'
            ? ({ kind: 'person', id: aim.target.id } as const)
            : undefined
      if (!target) return undefined
      return {
        polityId,
        target,
        currentStageKey: getInitialProjectStageKey('undermine_influence'),
      }
    }
    case 'patronize_artist': {
      const houseId = aim.owner.kind === 'house' ? aim.owner.id : undefined
      // 調査 §1.6: 完了時の wealth 不足による silent no-op を防ぐため作成時に afford 判定。
      // 払えなければ project を作らず (!fields パスで aim は待機し wealth 回復後に再試行)。
      if (!canAffordCulturalProject(ws, houseId, config.patronizeArtistCost)) return undefined
      return {
        houseId,
        budget: config.patronizeArtistCost,
        spentBudget: 0,
        currentStageKey: getInitialProjectStageKey('patronize_artist'),
      }
    }
    case 'commission_chronicle': {
      const houseId = aim.owner.kind === 'house' ? aim.owner.id : undefined
      if (!canAffordCulturalProject(ws, houseId, config.commissionChronicleCost)) return undefined
      return {
        houseId,
        budget: config.commissionChronicleCost,
        spentBudget: 0,
        currentStageKey: getInitialProjectStageKey('commission_chronicle'),
      }
    }
    case 'acquire_land': {
      if (aim.owner.kind !== 'polity') return undefined
      const target = findAcquireTargetForProject(ws, aim)
      if (!target) return undefined
      return {
        holdingId: target.holdingId,
        provinceId: target.provinceId,
        counterpartyPolityId: target.targetPolityId,
        preparation: 0,
        leverage: 0,
        commitment: 0,
        currentStageKey: getInitialProjectStageKey('acquire_land'),
      }
    }
    case 'improve_contract_terms': {
      if (aim.owner.kind !== 'polity') return undefined
      const target = findImproveTargetForProject(ws, config, aim)
      if (!target) return undefined
      return {
        holdingId: target.holdingId,
        landContractId: target.contractId,
        counterpartyPolityId: target.targetPolityId,
        preparation: 0,
        leverage: 0,
        commitment: 0,
        currentStageKey: getInitialProjectStageKey('improve_contract_terms'),
      }
    }
    case 'demand_tax_increase': {
      if (aim.owner.kind !== 'polity') return undefined
      const target = findDemandTaxIncreaseTargetForProject(ws, config, aim)
      if (!target) return undefined
      return {
        holdingId: target.holdingId,
        landContractId: target.contractId,
        counterpartyPolityId: target.targetPolityId,
        preparation: 0,
        leverage: 0,
        commitment: 0,
        currentStageKey: getInitialProjectStageKey('demand_tax_increase'),
      }
    }
    // v0.47 §8-9 分封。donor Polity / grant 対象 holding を選定し petition project を組む。
    case 'request_land_grant': {
      if (aim.owner.kind !== 'person') return undefined
      const personId = aim.owner.id
      const person = ws.persons[personId]
      if (!person) return undefined
      const resolved = resolveLandGrantDonor(ws, config, personId)
      if (!resolved) return undefined
      const approver = getPolityLeader(ws, resolved.donorPolityId)
      return {
        petitionerPersonId: personId,
        donorPolityId: resolved.donorPolityId,
        targetHoldingId: resolved.holdingId,
        ...(person.houseId !== undefined && { parentHouseId: person.houseId }),
        ...(approver !== undefined && { approverPersonId: approver }),
        currentStageKey: getInitialProjectStageKey('request_land_grant'),
      }
    }
    // v0.47 §11 Polity 譲渡による分家。宗家の譲渡対象 Polity を選定する。
    case 'request_cadet_branch_title_transfer': {
      if (aim.owner.kind !== 'person') return undefined
      const personId = aim.owner.id
      const resolved = resolveCadetBranchTransfer(ws, config, personId)
      if (!resolved) return undefined
      return {
        petitionerPersonId: personId,
        parentHouseId: resolved.parentHouseId,
        targetPolityId: resolved.targetPolityId,
        currentStageKey: getInitialProjectStageKey('request_cadet_branch_title_transfer'),
      }
    }
    // v0.47 §13 共和国 House 創設。
    case 'republic_house_foundation': {
      if (aim.owner.kind !== 'person') return undefined
      const personId = aim.owner.id
      const resolved = resolveRepublicHouseFounding(ws, config, personId)
      if (!resolved) return undefined
      return {
        petitionerPersonId: personId,
        commonwealthPolityId: resolved.commonwealthPolityId,
        currentStageKey: getInitialProjectStageKey('republic_house_foundation'),
      }
    }
    // v0.47 §5 陞爵。owner Polity を 1 段上の rank へ昇格する petition。
    case 'request_rank_promotion': {
      if (aim.owner.kind !== 'polity') return undefined
      const polityId = aim.owner.id
      const polity = ws.polities[polityId]
      if (!polity) return undefined
      const newRank = (polity.rank - 1) as PolityRank
      if (!canPromotePolityRank(ws, config, polityId, newRank)) return undefined
      const approver = selectRankPromotionApprover(ws, polityId)
      return {
        polityId,
        newRank,
        ...(approver !== undefined && { approverPersonId: approver }),
        currentStageKey: getInitialProjectStageKey('request_rank_promotion'),
      }
    }
    // v0.47 §12 一円支配集約。集約先 sink Polity を選定する。
    case 'consolidate_internal_contracts': {
      if (aim.owner.kind !== 'house') return undefined
      const houseId = aim.owner.id
      const sink = getHouseDomainConsolidationSinkPolityId(ws, config, houseId)
      if (!sink) return undefined
      return {
        houseId,
        sinkPolityId: sink,
        currentStageKey: getInitialProjectStageKey('consolidate_internal_contracts'),
      }
    }
    default:
      return { currentStageKey: getInitialProjectStageKey(projectKind as ProjectKind) }
  }
}

function findAcquireTargetForProject(
  ws: WorldState,
  aim: Aim,
): { targetPolityId: string; provinceId: string; holdingId: string } | undefined {
  if (aim.owner.kind !== 'polity') return undefined
  const polityId = aim.owner.id
  if (aim.target && aim.target.kind === 'province') {
    const holdings = getProvinceHoldings(ws, aim.target.id)
    for (const h of holdings) {
      // v0.47.3 §6.69: land_claim grace 中の holding は acquire 対象から除外 (churn 抑制)
      if (h.landClaimProtectedUntilWeek && ws.absoluteWeek < h.landClaimProtectedUntilWeek) continue
      const tp = ws.holdingTerminalPolityCache[h.id]
      if (tp && (tp as string) !== (polityId as string)) {
        // v0.45.2: 同家 polity は対象にしない (同家戦争防止ゲート) — 次の holding 候補へ
        if (politiesShareOwnerHouse(ws, polityId, tp)) continue
        const targetPolity = ws.polities[tp]
        if (targetPolity && targetPolity.active) {
          return { targetPolityId: tp, provinceId: aim.target.id, holdingId: h.id }
        }
      }
    }
  }
  return undefined
}

function findImproveTargetForProject(
  ws: WorldState,
  _config: SimulationConfig,
  aim: Aim,
): { targetPolityId: string; holdingId?: string; contractId?: string } | undefined {
  if (aim.owner.kind !== 'polity') return undefined
  const polityId = aim.owner.id
  const contractIds = ws.landContractIndex.byGranteePolity[polityId] ?? []
  for (const cid of contractIds) {
    const contract = ws.landContracts[cid]
    if (!contract) continue
    if (contract.termsProtectedUntilWeek && ws.absoluteWeek < contract.termsProtectedUntilWeek)
      continue
    if (contract.terms.taxRateToGrantor <= 0.15) continue
    const grantor = getLandContractGrantor(ws, cid)
    if (!grantor || grantor.kind !== 'polity') continue
    // v0.45.2: 同家の宗主には減税要求を起こさない (同家戦争防止ゲート)
    if (politiesShareOwnerHouse(ws, polityId, grantor.id)) continue
    const grantorPolity = ws.polities[grantor.id]
    if (grantorPolity && grantorPolity.active) {
      const holdings = getProvinceHoldings(ws, contract.provinceId)
      const firstHolding = holdings[0]
      const base = { targetPolityId: grantor.id as string, contractId: cid as string }
      if (firstHolding) return { ...base, holdingId: firstHolding.id }
      return base
    }
  }
  return undefined
}

function findDemandTaxIncreaseTargetForProject(
  ws: WorldState,
  config: SimulationConfig,
  aim: Aim,
): { targetPolityId: string; holdingId?: string; contractId?: string } | undefined {
  if (aim.owner.kind !== 'polity') return undefined
  const polityId = aim.owner.id
  const contractIds = ws.landContractIndex.byGranteePolity[polityId] ?? []
  for (const cid of contractIds) {
    const contract = ws.landContracts[cid]
    if (!contract) continue
    const childContractId = ws.landContractIndex.byParent[contract.id]
    if (childContractId === undefined) continue
    const child = ws.landContracts[childContractId]
    if (!child) continue
    if (child.termsProtectedUntilWeek && ws.absoluteWeek < child.termsProtectedUntilWeek) continue
    if (child.terms.taxRateToGrantor >= config.taxRevisionMaxRateForIncrease) continue
    // v0.45.2: 同家の臣下には増税要求を起こさない (同家戦争防止ゲート)
    if (politiesShareOwnerHouse(ws, polityId, child.granteePolityId)) continue
    const vassalPolity = ws.polities[child.granteePolityId]
    if (vassalPolity && vassalPolity.active) {
      const holdings = getProvinceHoldings(ws, child.provinceId)
      const firstHolding = holdings[0]
      const base = {
        targetPolityId: child.granteePolityId as string,
        contractId: child.id as string,
      }
      if (firstHolding) return { ...base, holdingId: firstHolding.id }
      return base
    }
  }
  return undefined
}

// --- advance_project completion ---

export function handleAdvanceProjectCompletionMut(
  ws: WorldState,
  config: SimulationConfig,
  projectId: ProjectId,
  outcome: TaskOutcomeKind,
): void {
  const project = ws.projects[projectId]
  if (!project || project.status !== 'active') return

  const progressGain =
    outcome === 'success'
      ? config.projectAdvanceProgressSuccess
      : outcome === 'partial'
        ? config.projectAdvanceProgressPartial
        : config.projectAdvanceProgressFailure
  const newProgress = Math.min(project.progress + progressGain, project.targetProgress)

  if (project.kind === 'develop_holding') {
    const expectedTasks = Math.max(
      1,
      Math.ceil(project.targetProgress / config.projectAdvanceProgressSuccess),
    )
    const consumption =
      project.budget.required / (expectedTasks * config.projectBudgetMarginMultiplier)
    const actualConsumption = Math.min(consumption, project.budget.remaining)
    const newBudget: ProjectBudget = {
      ...project.budget,
      remaining: project.budget.remaining - actualConsumption,
      spent: project.budget.spent + actualConsumption,
    }
    ws.projects[projectId] = { ...project, progress: newProgress, budget: newBudget }
    return
  }

  ws.projects[projectId] = { ...project, progress: newProgress }
}

// --- preparatory stage completion ---

export function handlePreparatoryStageCompletionMut(
  ws: WorldState,
  config: SimulationConfig,
  projectId: ProjectId,
  outcome: TaskOutcomeKind,
): void {
  const project = ws.projects[projectId]
  if (!project || project.status !== 'active') return

  if (outcome === 'success') {
    const updated = applyPreparatoryGainMut(project, config, 'full')
    const nextKey = getNextProjectStageKey(updated)
    if (nextKey) {
      const nextProject = { ...updated, currentStageKey: nextKey }
      delete nextProject.stageAttemptCount
      ws.projects[projectId] = nextProject
    } else {
      ws.projects[projectId] = updated
    }
  } else if (outcome === 'partial') {
    ws.projects[projectId] = applyPreparatoryGainMut(project, config, 'partial')
  } else {
    const newCount = (project.stageAttemptCount ?? 0) + 1
    if (newCount >= config.projectStageMaxAttempts) {
      ws.projects[projectId] = {
        ...project,
        status: 'failed',
        terminalReason: 'stage_attempts_exceeded',
      }
    } else {
      ws.projects[projectId] = { ...project, stageAttemptCount: newCount }
    }
  }
}

function applyPreparatoryGainMut(
  project: Project,
  config: SimulationConfig,
  level: 'full' | 'partial',
): Project {
  if (!isDiplomaticProjectKind(project.kind)) return project
  if (project.kind === 'respond_to_pressure') return project

  const lcp = project as LandClaimProject | ContractRevisionProject
  const prepGain =
    level === 'full'
      ? config.diplomaticProjectPreparationGainSuccess
      : config.diplomaticProjectPreparationGainPartial
  const levGain =
    level === 'full'
      ? config.diplomaticProjectLeverageGainSuccess
      : config.diplomaticProjectLeverageGainPartial
  const comGain =
    level === 'full'
      ? config.diplomaticProjectCommitmentGainSuccess
      : config.diplomaticProjectCommitmentGainPartial

  return {
    ...lcp,
    preparation: Math.min(lcp.preparation + prepGain, 100),
    leverage: Math.min(lcp.leverage + levGain, 100),
    commitment: Math.min(lcp.commitment + comGain, 100),
  }
}
