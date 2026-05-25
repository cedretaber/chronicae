import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { DevelopHoldingProject } from '../types/project'
import type { FactionId, HouseId, PersonId, ProjectId } from '../types/ids'
import {
  removeProjectFromIndexMut,
  addProjectToIndexMut,
  getProjectDeadlineWeeks,
} from '../mutations/projectMutations'
import { vacateHoldingBailiff, appointHoldingBailiff } from '../mutations/provinceOfficeMutations'
import {
  getActiveFactionMembership,
  getFactionActiveMemberIds,
  getFactionByLeader,
} from '../selectors/factionSelectors'
import { getOrganizationShares } from '../selectors/shareSelectors'

export function tryResolveDevelopHoldingStages(
  ws: WorldState,
  config: SimulationConfig,
  projectId: ProjectId,
  absoluteWeek: number,
): void {
  let project = ws.projects[projectId]
  if (!project || project.kind !== 'develop_holding') return

  if (project.currentStageKey === 'find_supervisor') {
    const resolved = resolveFindSupervisor(ws, config, project, absoluteWeek)
    if (!resolved) return
    ws.projects[projectId] = resolved
    project = resolved
  }

  if (project.currentStageKey === 'secure_budget') {
    const resolved = resolveSecureBudget(ws, config, project, absoluteWeek)
    if (!resolved) return
    ws.projects[projectId] = resolved
  }
}

function resolveFindSupervisor(
  ws: WorldState,
  config: SimulationConfig,
  project: DevelopHoldingProject,
  absoluteWeek: number,
): DevelopHoldingProject | undefined {
  const holdingId = project.holdingId
  const officeId = ws.holdingOfficeIndex.byHolding[holdingId]
  let supervisorId: PersonId | undefined

  if (officeId) {
    const assignment = ws.holdingOfficeAssignments[officeId]
    if (assignment?.active) {
      const holder = ws.persons[assignment.holderPersonId]
      if (holder?.alive && holder.kind !== 'placeholder') {
        supervisorId = assignment.holderPersonId
      }
    }
  }

  if (!supervisorId) {
    supervisorId = findBailiffCandidateForProject(ws, config, project)
    if (!supervisorId) return undefined

    const tp = ws.holdingTerminalPolityCache[holdingId]
    if (!tp) return undefined

    const vacated = vacateHoldingBailiff(
      {
        ...ws,
        holdingOfficeAssignments: { ...ws.holdingOfficeAssignments },
        holdingOfficeIndex: {
          ...ws.holdingOfficeIndex,
          byHolding: { ...ws.holdingOfficeIndex.byHolding },
          byHolderPerson: { ...ws.holdingOfficeIndex.byHolderPerson },
          byAppointingPolity: { ...ws.holdingOfficeIndex.byAppointingPolity },
        },
      },
      holdingId,
    )
    const { state: appointed } = appointHoldingBailiff(vacated, {
      holdingId,
      holderPersonId: supervisorId,
      appointingPolityId: tp,
      week: absoluteWeek,
    })
    ws.holdingOfficeAssignments = appointed.holdingOfficeAssignments
    ws.holdingOfficeIndex = appointed.holdingOfficeIndex
    ws.nextHoldingOfficeAssignmentId = appointed.nextHoldingOfficeAssignmentId
  }

  const currentOfficeId = ws.holdingOfficeIndex.byHolding[holdingId]
  if (currentOfficeId) {
    const a = ws.holdingOfficeAssignments[currentOfficeId]
    if (a) {
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

  removeProjectFromIndexMut(ws, project)
  const updated: DevelopHoldingProject = {
    ...project,
    supervisorPersonId: supervisorId,
    currentStageKey: 'secure_budget',
  }
  addProjectToIndexMut(ws, updated)
  return updated
}

function resolveSecureBudget(
  ws: WorldState,
  config: SimulationConfig,
  project: DevelopHoldingProject,
  absoluteWeek: number,
): DevelopHoldingProject | undefined {
  if (project.owner.kind !== 'polity') return undefined
  const polityId = project.owner.id
  const polity = ws.polities[polityId]
  if (!polity || polity.treasury < project.budget.required) return undefined

  ws.polities = {
    ...ws.polities,
    [polityId]: { ...polity, treasury: polity.treasury - project.budget.required },
  }

  const executionDeadline =
    absoluteWeek + getProjectDeadlineWeeks(config, 'develop_holding', project.targetProgress)

  return {
    ...project,
    budget: {
      ...project.budget,
      allocated: project.budget.required,
      remaining: project.budget.required,
    },
    currentStageKey: 'execute_project',
    deadlineWeek: executionDeadline,
  }
}

function pickBestCandidate(
  ws: WorldState,
  config: SimulationConfig,
  candidateIds: PersonId[],
): PersonId | undefined {
  const candidates = candidateIds
    .map((mid) => ws.persons[mid])
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .filter(
      (p) =>
        p.alive &&
        p.age >= config.adultAge &&
        p.kind !== 'placeholder' &&
        !hasActiveOffice(ws, p.id) &&
        !hasActiveHoldingOffice(ws, p.id),
    )
    .sort((a, b) => {
      const aScore = a.abilities.numeracy + a.abilities.insight
      const bScore = b.abilities.numeracy + b.abilities.insight
      if (bScore !== aScore) return bScore - aScore
      return a.id.localeCompare(b.id)
    })
  return candidates[0]?.id
}

function collectHouseMemberIds(ws: WorldState, houseId: HouseId): PersonId[] {
  const house = ws.houses[houseId]
  if (!house || !house.active) return []
  return house.memberIds
}

function findBailiffCandidateForProject(
  ws: WorldState,
  config: SimulationConfig,
  project: DevelopHoldingProject,
): PersonId | undefined {
  if (project.owner.kind !== 'polity') return undefined
  const polityId = project.owner.id
  const polity = ws.polities[polityId]
  if (!polity || !polity.active || !polity.ownerHouseId) return undefined

  // Tier 1: creator's faction members
  const creator = ws.persons[project.creatorPersonId]
  if (creator) {
    const membership = getActiveFactionMembership(ws, creator.id)
    if (membership) {
      const factionMembers = getFactionActiveMemberIds(ws, membership.factionId)
      const found = pickBestCandidate(ws, config, factionMembers)
      if (found) return found
    }
  }

  // Tier 2: owner house members
  const ownerMembers = collectHouseMemberIds(ws, polity.ownerHouseId)
  const found2 = pickBestCandidate(ws, config, ownerMembers)
  if (found2) return found2

  // Tier 3: members of all houses holding shares in this polity
  const shares = getOrganizationShares(ws, { kind: 'polity', id: polityId })
  const seen = new Set<PersonId>(ownerMembers)
  const shareholderCandidates: PersonId[] = []
  const shareholderHouseIds: HouseId[] = []
  for (const share of shares) {
    if (share.holder.kind !== 'house') continue
    const houseId = share.holder.id
    shareholderHouseIds.push(houseId)
    for (const mid of collectHouseMemberIds(ws, houseId)) {
      if (!seen.has(mid)) {
        seen.add(mid)
        shareholderCandidates.push(mid)
      }
    }
  }
  const found3 = pickBestCandidate(ws, config, shareholderCandidates)
  if (found3) return found3

  // Tier 4: factions led by members of shareholder houses
  const factionSeen = new Set<FactionId>()
  const factionCandidates: PersonId[] = []
  for (const houseId of shareholderHouseIds) {
    for (const mid of collectHouseMemberIds(ws, houseId)) {
      const faction = getFactionByLeader(ws, mid)
      if (!faction || factionSeen.has(faction.id)) continue
      factionSeen.add(faction.id)
      for (const fmid of getFactionActiveMemberIds(ws, faction.id)) {
        if (!seen.has(fmid)) {
          seen.add(fmid)
          factionCandidates.push(fmid)
        }
      }
    }
  }
  return pickBestCandidate(ws, config, factionCandidates)
}

function hasActiveOffice(state: WorldState, personId: PersonId): boolean {
  const ids = state.officeIndex.byHolderPerson[personId as string] ?? []
  for (const id of ids) {
    const o = state.officeAssignments[id]
    if (o && o.active) return true
  }
  return false
}

function hasActiveHoldingOffice(state: WorldState, personId: PersonId): boolean {
  const ids = state.holdingOfficeIndex.byHolderPerson[personId] ?? []
  for (const id of ids) {
    const a = state.holdingOfficeAssignments[id]
    if (a && a.active) return true
  }
  return false
}
