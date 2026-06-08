import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PersonId } from '../types/ids'
import type { Project, ProjectKind } from '../types/project'
import type { AimKind } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import { getProjectRelatedRefs, selectProjectSupervisor } from '../selectors/projectSelectors'
import type { TickContext } from '../tick/context'
import { createSimEvent } from '../tick/context'
import { nameParam, entityRef } from '../types/event'
import { getOwnerNameKey, getOwnerNameRefForEmit } from '../utils/ownerNames'

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
    case 'acquire_political_right':
      return 'acquire_political_right'
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
    // 影響力個人中心化 Phase 1b: 運動
    case 'start_movement_campaign':
      return 'movement_campaign'
    // v0.44 §6.5: improve_ability は直接 Task 生成を廃止し personal_training Project 化
    case 'improve_ability':
      return 'personal_training'
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
  if (kind === 'personal_training') return config.personalTrainingDeadlineWeeks
  if (kind === 'develop_holding' && targetProgress !== undefined) {
    return Math.ceil(
      config.projectDeadlineWeeksDevelopment *
        (targetProgress / config.projectDefaultTargetProgress),
    )
  }
  return config.projectDeadlineWeeksDevelopment
}

// 死亡した person が supervisor を務める active Project の即時 cascade。
// supervisor 死亡の通常回収は ProjectMaintenanceSystem (4週ごと) だが、tick 順で
// maintenance より後に走る system からの死亡 (例: revolt 鎮圧での指導者処刑 —
// dissolveNegotiatingCommonwealth) は年末 integrity (「active project but supervisor
// is dead」) に先に捕まる。maintenance と同じ規則 (再選定 → 不能なら failed) を
// 死亡サイトで即時に適用する。dissolveFactionsAnchoredToPolity (F8) と同じ
// TickContext パターン。
export function reassignProjectsOfDeadSupervisor(
  ctx: TickContext,
  personId: PersonId,
): TickContext {
  const projectIds = [...(ctx.state.projectIndex.bySupervisorPerson[personId as string] ?? [])]
  if (projectIds.length === 0) return ctx

  let next = ctx
  for (const pid of projectIds.sort()) {
    const project = next.state.projects[pid]
    if (!project || project.status !== 'active') continue
    if ((project.supervisorPersonId as string) !== (personId as string)) continue

    // mut helper を使うため index/projects を clone した state を作る
    const ws: WorldState = {
      ...next.state,
      projects: { ...next.state.projects },
      projectIndex: {
        byOwner: { ...next.state.projectIndex.byOwner },
        byAim: { ...next.state.projectIndex.byAim },
        byParentProject: { ...next.state.projectIndex.byParentProject },
        byCreatorPerson: { ...next.state.projectIndex.byCreatorPerson },
        bySupervisorPerson: { ...next.state.projectIndex.bySupervisorPerson },
        byRelatedEntity: { ...next.state.projectIndex.byRelatedEntity },
      },
    }

    // v0.44 §6.9: personal_training は本人死亡 = project 終了。再選定せず cancelled に倒す
    // (通常死亡は projectMaintenanceSystem の isOwnerActive 経由で cancelled になるが、
    // 処刑 cascade はこの即時経路を通るため、failed 化せず cancelled の分岐を入れる)。
    if (project.kind === 'personal_training') {
      ws.projects[pid] = { ...project, status: 'cancelled', terminalReason: 'owner_inactive' }
      next = { ...next, state: ws }
      continue
    }

    const newSupervisor = selectProjectSupervisor(
      ws,
      next.config,
      project.owner,
      project.kind,
      project.creatorPersonId,
    )
    if (newSupervisor !== undefined) {
      removeProjectFromIndexMut(ws, project)
      const updated = { ...project, supervisorPersonId: newSupervisor }
      ws.projects[pid] = updated
      addProjectToIndexMut(ws, updated)
      next = { ...next, state: ws }
      continue
    }

    ws.projects[pid] = { ...project, status: 'failed', terminalReason: 'no_supervisor' }
    const ownerNameKey = getOwnerNameKey(ws, project.owner)
    const { event, ctx: ec } = createSimEvent(
      { ...next, state: ws },
      {
        type: 'PROJECT_FAILED',
        importance: 'minor',
        messageKey: 'project.failed.no_supervisor',
        messageParams: {
          owner: nameParam(getOwnerNameRefForEmit(ws, project.owner).category, ownerNameKey),
          kind: project.kind,
        },
        entityRefs: [entityRef(project.owner.kind, project.owner.id, 'owner', ownerNameKey)],
      },
    )
    next = { ...ec, events: [...ec.events, event] }
  }
  return next
}
