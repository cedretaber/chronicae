import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { FactionId, PersonId } from '../types/ids'
import { isLifeStageAtLeast, isLivingPerson } from '../types/person'
import { getFactionActiveMemberIds } from './factionSelectors'
import type { EntityRef, Aim, DecisionSubjectRef } from '../types/goal'
import type { Project, ProjectKind } from '../types/project'
import type { AppliedRoleKey } from './abilitySelectors'
import { getRoleScore } from './abilitySelectors'
import { getPolityLeader } from './officeSelectors'
import { getHouseDecisionMaker } from './officeSelectors'
import { getPolityPersonIds } from './polityRelations'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'
import { isRoleEligibleBySex } from './roleEligibilitySelectors'

export function getProjectRelatedRefs(project: Project): EntityRef[] {
  switch (project.kind) {
    case 'develop_holding':
      return [{ kind: 'holding', id: project.holdingId }]

    case 'acquire_political_right':
      return [
        { kind: 'polity', id: project.polityId },
        ...(project.target.kind === 'holding_office_role'
          ? [{ kind: 'holding' as const, id: project.target.holdingId }]
          : []),
      ]

    case 'promote_policy_shift':
      return [
        { kind: 'polity', id: project.polityId },
        { kind: 'house', id: project.houseId },
      ]

    case 'patronize_artist':
      return [
        { kind: 'house', id: project.houseId },
        ...(project.artistPersonId
          ? [{ kind: 'person' as const, id: project.artistPersonId }]
          : []),
      ]

    case 'commission_chronicle':
      return [
        { kind: 'house', id: project.houseId },
        ...(project.subjectRef ? [project.subjectRef] : []),
      ]

    case 'acquire_land':
    case 'sell_land':
      return [
        ...(project.holdingId ? [{ kind: 'holding' as const, id: project.holdingId }] : []),
        ...(project.provinceId ? [{ kind: 'province' as const, id: project.provinceId }] : []),
        ...(project.counterpartyPolityId
          ? [{ kind: 'polity' as const, id: project.counterpartyPolityId }]
          : []),
      ]

    case 'improve_contract_terms':
    case 'demand_tax_increase':
      return [
        ...(project.holdingId ? [{ kind: 'holding' as const, id: project.holdingId }] : []),
        ...(project.counterpartyPolityId
          ? [{ kind: 'polity' as const, id: project.counterpartyPolityId }]
          : []),
      ]

    case 'respond_to_pressure':
      return []

    // v0.44: 本人完結のため related entity index には載せない (person は byOwner/byCreator/
    // bySupervisor で引ける)
    case 'personal_training':
      return []

    // 影響力個人中心化 Phase 1b: 運動。対象 polity と推薦個人を related に載せる
    case 'movement_campaign':
      return [
        { kind: 'polity', id: project.targetPolityId },
        { kind: 'person', id: project.sponsoredPersonId },
      ]

    // v0.47 称号・分封・領邦再編
    case 'request_rank_promotion':
      return [{ kind: 'polity', id: project.polityId }]

    case 'request_land_grant':
      return [
        { kind: 'polity', id: project.donorPolityId },
        { kind: 'holding', id: project.targetHoldingId },
      ]

    case 'request_cadet_branch_title_transfer':
      return [
        { kind: 'polity', id: project.targetPolityId },
        { kind: 'house', id: project.parentHouseId },
      ]

    case 'republic_house_foundation':
      return [{ kind: 'polity', id: project.commonwealthPolityId }]

    case 'consolidate_internal_contracts':
      return [
        { kind: 'house', id: project.houseId },
        { kind: 'polity', id: project.sinkPolityId },
      ]

    // v0.51 陰謀リファイン: 対象 polity と rival (家/人物) を related に載せる
    case 'undermine_influence':
      return [
        { kind: 'polity', id: project.polityId },
        project.target.kind === 'house'
          ? { kind: 'house', id: project.target.id }
          : { kind: 'person', id: project.target.id },
      ]

    // v0.51 陰謀リファイン: 対象 polity と (holding_office_role なら) 対象 holding を related に
    case 'revoke_political_right':
      return [
        { kind: 'polity', id: project.polityId },
        ...(project.target.kind === 'holding_office_role'
          ? [{ kind: 'holding' as const, id: project.target.holdingId }]
          : []),
      ]

    // v0.51 陰謀リファイン: 対象分家を related に
    case 'replace_house_leader':
      return [{ kind: 'house', id: project.targetHouseId }]
  }
}

export const PROJECT_KIND_ROLE_MAP: Record<ProjectKind, AppliedRoleKey> = {
  develop_holding: 'stewardship',
  acquire_political_right: 'diplomacy',
  promote_policy_shift: 'diplomacy',
  patronize_artist: 'diplomacy',
  commission_chronicle: 'governance',
  acquire_land: 'warCommand',
  sell_land: 'stewardship',
  improve_contract_terms: 'stewardship',
  demand_tax_increase: 'stewardship',
  respond_to_pressure: 'diplomacy',
  // v0.44: nominal — personal_training は supervisor 選定を通らず (本人固定 §6.4)、
  // 経験 weight も getProjectExperienceWeights が trainingAbilityKey 単独に分岐する (§3.1)
  personal_training: 'governance',
  // 影響力個人中心化 Phase 1b: 運動 = 政治的キャンペーン (charisma/diplomacy)
  movement_campaign: 'diplomacy',
  // v0.47 称号・分封・領邦再編: petition は外交、集約・共和国 House 創設は統治系
  request_rank_promotion: 'diplomacy',
  request_land_grant: 'diplomacy',
  request_cadet_branch_title_transfer: 'diplomacy',
  republic_house_foundation: 'governance',
  consolidate_internal_contracts: 'stewardship',
  // v0.51 陰謀リファイン: 策謀は intrigue
  undermine_influence: 'intrigue',
  revoke_political_right: 'intrigue',
  replace_house_leader: 'intrigue',
}

export function getPersonProjectWorkload(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): number {
  const pKey = personId as string
  const taskIds = state.taskIndex.byAssignee[pKey] ?? []
  let activeTasks = 0
  for (const tid of taskIds) {
    const t = state.tasks[tid]
    if (t && t.status === 'active') activeTasks++
  }

  const supervisedIds = state.projectIndex.bySupervisorPerson[pKey] ?? []
  let activeProjects = 0
  for (const pid of supervisedIds) {
    const p = state.projects[pid]
    if (p && p.status === 'active') activeProjects++
  }

  const officeIds = state.officeIndex.byHolderPerson[pKey] ?? []
  let activeOffices = 0
  for (const oaId of officeIds) {
    const oa = state.officeAssignments[oaId]
    if (oa && oa.active) activeOffices++
  }

  return (
    activeTasks * config.activeTaskWorkloadWeight +
    activeProjects * config.supervisedProjectWorkloadWeight +
    activeOffices * config.officeWorkloadWeight
  )
}

function getCandidatePersonIds(state: WorldState, owner: DecisionSubjectRef): PersonId[] {
  if (owner.kind === 'polity') {
    return getPolityPersonIds(state, owner.id)
  }
  if (owner.kind === 'house') {
    const house = state.houses[owner.id]
    if (!house || !house.active) return []
    return [...house.memberIds]
  }
  return [owner.id]
}

// supervisor 候補の母集合。creator 用 (getCandidatePersonIds) との違いは、owner の
// 宮廷に出入りする派閥のメンバー (客分・食客) まで含めること。派閥が介入できるのは
// anchor Polity のみ (§12.4) なので、無関係な国の派閥メンバーは届かない:
// - polity: owner polity に anchor された active 派閥のメンバー
// - house: 家の生存メンバーが率いる active 派閥のメンバー (家の食客)
// Project の発案 (creator) は組織内部の人間に限り、派閥は実務の担い手としてのみ参加する。
function getSupervisorCandidatePersonIds(state: WorldState, owner: DecisionSubjectRef): PersonId[] {
  const base = getCandidatePersonIds(state, owner)
  const seen = new Set<string>(base as string[])
  const extra: PersonId[] = []

  function addFactionMembers(factionId: FactionId): void {
    const faction = state.factions[factionId]
    if (!faction || !faction.active) return
    for (const pid of getFactionActiveMemberIds(state, factionId)) {
      if (!seen.has(pid)) {
        seen.add(pid)
        extra.push(pid)
      }
    }
  }

  if (owner.kind === 'polity') {
    const factionIds = [...(state.factionIndex.byPolity[owner.id] ?? [])].sort()
    for (const fid of factionIds) addFactionMembers(fid)
  } else if (owner.kind === 'house') {
    const house = state.houses[owner.id]
    if (house && house.active) {
      const factionIds: FactionId[] = []
      for (const mid of house.memberIds) {
        if (!isLivingPerson(state.persons[mid])) continue
        factionIds.push(...(state.factionIndex.byLeader[mid] ?? []))
      }
      for (const fid of factionIds.sort()) addFactionMembers(fid)
    }
  }

  return [...base, ...extra]
}

function isEligibleCandidate(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false
  if (!person.alive) return false
  if (person.kind === 'placeholder') return false
  if (!isLifeStageAtLeast(person.lifeStage, 'young_adulthood')) return false
  return true
}

export function selectProjectCreator(
  state: WorldState,
  config: SimulationConfig,
  aim: Aim,
): PersonId | undefined {
  const candidates = getCandidatePersonIds(state, aim.owner)
  const roleKey = getProjectRoleForAim(aim)

  let bestId: PersonId | undefined
  let bestScore = -Infinity

  for (const pid of candidates) {
    if (!isEligibleCandidate(state, pid)) continue

    const abilityScore = getRoleScore(state, pid, roleKey) / 10
    const workload = getPersonProjectWorkload(state, config, pid)
    const workloadPenalty = workload * 0.5

    let leaderBonus = 0
    if (aim.owner.kind === 'polity') {
      const leaderId = getPolityLeader(state, aim.owner.id)
      if (leaderId && (leaderId as string) === (pid as string)) leaderBonus = 3
    } else if (aim.owner.kind === 'house') {
      // 影響力個人中心化 Phase 3a: 家の執行主体は意志決定者 (支配 share 保有者) に
      const leaderId = getHouseDecisionMaker(state, aim.owner.id)
      if (leaderId && (leaderId as string) === (pid as string)) leaderBonus = 3
    }

    let officeBonus = 0
    const officeIds = state.officeIndex.byHolderPerson[pid as string] ?? []
    for (const oaId of officeIds) {
      const oa = state.officeAssignments[oaId]
      if (!oa || !oa.active) continue
      if (
        oa.organization.kind === aim.owner.kind &&
        (oa.organization.id as string) === (aim.owner.id as string)
      ) {
        officeBonus = 2
        break
      }
    }

    const score = abilityScore + leaderBonus + officeBonus - workloadPenalty

    if (score > bestScore) {
      bestScore = score
      bestId = pid
    }
  }

  return bestId
}

function getProjectRoleForAim(aim: Aim): AppliedRoleKey {
  switch (aim.kind) {
    case 'develop_owned_holding':
      return 'stewardship'
    case 'consolidate_province_holdings':
    case 'seize_weak_remote_holdings':
      return 'warCommand'
    case 'improve_owned_contract_terms':
    case 'demand_tax_increase_from_vassal':
    case 'eliminate_overlord_contract':
    case 'eliminate_vassal_contract':
      return 'stewardship'
    case 'acquire_political_right':
    case 'steer_polity_external_expansion':
    case 'steer_polity_internal_development':
      return 'diplomacy'
    case 'patronize_artist':
    case 'commission_chronicle':
      return 'diplomacy'
    default:
      return 'governance'
  }
}

export function selectProjectSupervisor(
  state: WorldState,
  config: SimulationConfig,
  owner: DecisionSubjectRef,
  projectKind: ProjectKind,
  creatorPersonId: PersonId,
): PersonId | undefined {
  const candidates = getSupervisorCandidatePersonIds(state, owner)
  const roleKey = PROJECT_KIND_ROLE_MAP[projectKind]

  const creator = state.persons[creatorPersonId]

  // v0.45.3 性別役職適格ゲート: gated で候補ゼロの場合のみ ungated 再試行。
  // 現職 house/polity leader は isRoleEligibleBySex 側で常に免除 (女当主・女王は監督可)。
  const pick = (gate: boolean): PersonId | undefined => {
    let bestId: PersonId | undefined
    let bestScore = -Infinity

    for (const pid of candidates) {
      if (!isEligibleCandidate(state, pid)) continue
      if ((pid as string) === (creatorPersonId as string)) continue
      if (gate && !isRoleEligibleBySex(state, config, pid)) continue

      const abilityScore = getRoleScore(state, pid, roleKey) / 10
      const workload = getPersonProjectWorkload(state, config, pid)
      const workloadPenalty = workload * 0.5

      let officeBonus = 0
      const officeIds = state.officeIndex.byHolderPerson[pid as string] ?? []
      for (const oaId of officeIds) {
        const oa = state.officeAssignments[oaId]
        if (!oa || !oa.active) continue
        if (
          oa.organization.kind === owner.kind &&
          (oa.organization.id as string) === (owner.id as string)
        ) {
          officeBonus = 2
          break
        }
      }

      let creatorBias = 0
      if (creator) {
        const att = getAttitudeOrDefault(state, creator, { kind: 'person', id: pid })
        creatorBias = (att.affection * 0.6 + att.respect * 0.4) / 100
      }

      let leaderBonus = 0
      if (owner.kind === 'polity') {
        const leaderId = getPolityLeader(state, owner.id)
        if (leaderId && (leaderId as string) === (pid as string)) leaderBonus = 1
      } else if (owner.kind === 'house') {
        // 影響力個人中心化 Phase 3a: 家の執行主体は意志決定者 (支配 share 保有者) に
        const leaderId = getHouseDecisionMaker(state, owner.id)
        if (leaderId && (leaderId as string) === (pid as string)) leaderBonus = 1
      }

      const score = abilityScore + officeBonus + creatorBias + leaderBonus - workloadPenalty

      if (score > bestScore) {
        bestScore = score
        bestId = pid
      }
    }

    return bestId
  }

  const gated = pick(true)
  if (gated) return gated
  return config.allowFemaleRolesWhenNoMaleCandidate ? pick(false) : undefined
}
