import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PersonId } from '../types/ids'
import type { EntityRef, Aim, DecisionSubjectRef } from '../types/goal'
import type { Project, ProjectKind } from '../types/project'
import type { AppliedRoleKey } from './abilitySelectors'
import { getRoleScore } from './abilitySelectors'
import { getPolityLeader } from './officeSelectors'
import { getHouseLeader } from './officeSelectors'
import { getPolityPersonIds } from './polityRelations'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'

export function getProjectRelatedRefs(project: Project): EntityRef[] {
  switch (project.kind) {
    case 'develop_holding':
      return [{ kind: 'holding', id: project.holdingId }]

    case 'expand_polity_share':
      return [
        { kind: 'polity', id: project.polityId },
        { kind: 'house', id: project.houseId },
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
  }
}

const PROJECT_KIND_ROLE_MAP: Record<ProjectKind, AppliedRoleKey> = {
  develop_holding: 'stewardship',
  expand_polity_share: 'diplomacy',
  promote_policy_shift: 'diplomacy',
  patronize_artist: 'diplomacy',
  commission_chronicle: 'governance',
  acquire_land: 'warCommand',
  sell_land: 'stewardship',
  improve_contract_terms: 'stewardship',
  demand_tax_increase: 'stewardship',
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

function isEligibleCandidate(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): boolean {
  const person = state.persons[personId]
  if (!person) return false
  if (!person.alive) return false
  if (person.kind === 'placeholder') return false
  if (person.age < config.adultAge) return false
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
    if (!isEligibleCandidate(state, config, pid)) continue

    const abilityScore = getRoleScore(state, pid, roleKey) / 10
    const workload = getPersonProjectWorkload(state, config, pid)
    const workloadPenalty = workload * 0.5

    let leaderBonus = 0
    if (aim.owner.kind === 'polity') {
      const leaderId = getPolityLeader(state, aim.owner.id)
      if (leaderId && (leaderId as string) === (pid as string)) leaderBonus = 3
    } else if (aim.owner.kind === 'house') {
      const leaderId = getHouseLeader(state, aim.owner.id)
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
      return 'stewardship'
    case 'increase_polity_share':
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
  const candidates = getCandidatePersonIds(state, owner)
  const roleKey = PROJECT_KIND_ROLE_MAP[projectKind]

  let bestId: PersonId | undefined
  let bestScore = -Infinity

  const creator = state.persons[creatorPersonId]

  for (const pid of candidates) {
    if (!isEligibleCandidate(state, config, pid)) continue
    if ((pid as string) === (creatorPersonId as string)) continue

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
      const leaderId = getHouseLeader(state, owner.id)
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
