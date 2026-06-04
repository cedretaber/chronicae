import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { Project, ProjectKind } from '../types/project'
import type { AimKind } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import { getProjectRelatedRefs } from '../selectors/projectSelectors'

export function addProjectToIndexMut(ws: WorldState, project: Project): void {
  const ownerKey = decisionSubjectKey(project.owner)
  ws.projectIndex.byOwner[ownerKey] = [...(ws.projectIndex.byOwner[ownerKey] ?? []), project.id]

  if (project.origin.kind === 'aim') {
    const aimKey = project.origin.aimId as string
    ws.projectIndex.byAim[aimKey] = [...(ws.projectIndex.byAim[aimKey] ?? []), project.id]
  }

  if (project.parentProjectId) {
    const parentKey = project.parentProjectId as string
    ws.projectIndex.byParentProject[parentKey] = [
      ...(ws.projectIndex.byParentProject[parentKey] ?? []),
      project.id,
    ]
  }

  const creatorKey = project.creatorPersonId as string
  ws.projectIndex.byCreatorPerson[creatorKey] = [
    ...(ws.projectIndex.byCreatorPerson[creatorKey] ?? []),
    project.id,
  ]

  const supervisorKey = project.supervisorPersonId as string
  ws.projectIndex.bySupervisorPerson[supervisorKey] = [
    ...(ws.projectIndex.bySupervisorPerson[supervisorKey] ?? []),
    project.id,
  ]

  for (const ref of getProjectRelatedRefs(project)) {
    if (!('id' in ref)) continue
    const refKey = `${ref.kind}:${ref.id}`
    ws.projectIndex.byRelatedEntity[refKey] = [
      ...(ws.projectIndex.byRelatedEntity[refKey] ?? []),
      project.id,
    ]
  }
}

export function removeProjectFromIndexMut(ws: WorldState, project: Project): void {
  const pid = project.id

  const ownerKey = decisionSubjectKey(project.owner)
  const ownerIds = ws.projectIndex.byOwner[ownerKey]
  if (ownerIds) {
    const filtered = ownerIds.filter((id) => (id as string) !== (pid as string))
    if (filtered.length > 0) {
      ws.projectIndex.byOwner[ownerKey] = filtered
    } else {
      delete ws.projectIndex.byOwner[ownerKey]
    }
  }

  if (project.origin.kind === 'aim') {
    const aimKey = project.origin.aimId as string
    const aimIds = ws.projectIndex.byAim[aimKey]
    if (aimIds) {
      const filtered = aimIds.filter((id) => (id as string) !== (pid as string))
      if (filtered.length > 0) {
        ws.projectIndex.byAim[aimKey] = filtered
      } else {
        delete ws.projectIndex.byAim[aimKey]
      }
    }
  }

  if (project.parentProjectId) {
    const parentKey = project.parentProjectId as string
    const parentIds = ws.projectIndex.byParentProject[parentKey]
    if (parentIds) {
      const filtered = parentIds.filter((id) => (id as string) !== (pid as string))
      if (filtered.length > 0) {
        ws.projectIndex.byParentProject[parentKey] = filtered
      } else {
        delete ws.projectIndex.byParentProject[parentKey]
      }
    }
  }

  const creatorKey = project.creatorPersonId as string
  const creatorIds = ws.projectIndex.byCreatorPerson[creatorKey]
  if (creatorIds) {
    const filtered = creatorIds.filter((id) => (id as string) !== (pid as string))
    if (filtered.length > 0) {
      ws.projectIndex.byCreatorPerson[creatorKey] = filtered
    } else {
      delete ws.projectIndex.byCreatorPerson[creatorKey]
    }
  }

  const supervisorKey = project.supervisorPersonId as string
  const supervisorIds = ws.projectIndex.bySupervisorPerson[supervisorKey]
  if (supervisorIds) {
    const filtered = supervisorIds.filter((id) => (id as string) !== (pid as string))
    if (filtered.length > 0) {
      ws.projectIndex.bySupervisorPerson[supervisorKey] = filtered
    } else {
      delete ws.projectIndex.bySupervisorPerson[supervisorKey]
    }
  }

  for (const ref of getProjectRelatedRefs(project)) {
    if (!('id' in ref)) continue
    const refKey = `${ref.kind}:${ref.id}`
    const refIds = ws.projectIndex.byRelatedEntity[refKey]
    if (refIds) {
      const filtered = refIds.filter((id) => (id as string) !== (pid as string))
      if (filtered.length > 0) {
        ws.projectIndex.byRelatedEntity[refKey] = filtered
      } else {
        delete ws.projectIndex.byRelatedEntity[refKey]
      }
    }
  }
}

export function aimKindToProjectKind(aimKind: AimKind): ProjectKind | undefined {
  switch (aimKind) {
    case 'consolidate_province_holdings':
    case 'seize_weak_remote_holdings':
      return 'acquire_land'
    case 'develop_owned_holding':
      return 'develop_holding'
    case 'improve_owned_contract_terms':
    case 'eliminate_overlord_contract':
      return 'improve_contract_terms'
    case 'demand_tax_increase_from_vassal':
    case 'eliminate_vassal_contract':
      return 'demand_tax_increase'
    case 'steer_polity_external_expansion':
    case 'steer_polity_internal_development':
      return 'promote_policy_shift'
    case 'patronize_artist':
      return 'patronize_artist'
    case 'commission_chronicle':
      return 'commission_chronicle'
    default:
      return undefined
  }
}

export function isDiplomaticProjectKind(kind: ProjectKind): boolean {
  return (
    kind === 'acquire_land' ||
    kind === 'sell_land' ||
    kind === 'improve_contract_terms' ||
    kind === 'demand_tax_increase' ||
    kind === 'respond_to_pressure'
  )
}

export function getProjectDeadlineWeeks(
  config: SimulationConfig,
  kind: ProjectKind,
  targetProgress?: number,
): number {
  if (isDiplomaticProjectKind(kind)) return config.projectDeadlineWeeksDiplomatic
  if (kind === 'develop_holding' && targetProgress !== undefined) {
    return Math.ceil(
      config.projectDeadlineWeeksDevelopment *
        (targetProgress / config.projectDefaultTargetProgress),
    )
  }
  return config.projectDeadlineWeeksDevelopment
}
