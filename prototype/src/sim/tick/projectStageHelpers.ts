import type { WorldState } from '../types/world'
import type { DevelopHoldingProject } from '../types/project'
import type { FactionId, HouseId, PersonId } from '../types/ids'
import { isLifeStageAtLeast } from '../types/person'
import {
  getActiveFactionMembership,
  getFactionActiveMemberIds,
  getFactionByLeader,
} from '../selectors/factionSelectors'
import { getOrganizationShares } from '../selectors/shareSelectors'

export function findBailiffCandidateForProject(
  ws: WorldState,
  project: DevelopHoldingProject,
): PersonId | undefined {
  if (project.owner.kind !== 'polity') return undefined
  const polityId = project.owner.id
  const polity = ws.polities[polityId]
  if (!polity || !polity.active || !polity.ownerHouseId) return undefined

  const creator = ws.persons[project.creatorPersonId]
  if (creator) {
    const membership = getActiveFactionMembership(ws, creator.id)
    if (membership) {
      const factionMembers = getFactionActiveMemberIds(ws, membership.factionId)
      const found = pickBestCandidate(ws, factionMembers)
      if (found) return found
    }
  }

  const ownerMembers = collectHouseMemberIds(ws, polity.ownerHouseId)
  const found2 = pickBestCandidate(ws, ownerMembers)
  if (found2) return found2

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
  const found3 = pickBestCandidate(ws, shareholderCandidates)
  if (found3) return found3

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
  return pickBestCandidate(ws, factionCandidates)
}

function pickBestCandidate(ws: WorldState, candidateIds: PersonId[]): PersonId | undefined {
  const candidates = candidateIds
    .map((mid) => ws.persons[mid])
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .filter(
      (p) =>
        p.alive &&
        isLifeStageAtLeast(p.lifeStage, 'young_adulthood') &&
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
