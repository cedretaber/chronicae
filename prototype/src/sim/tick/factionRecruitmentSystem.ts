import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { PersonId, FactionId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import type { Person } from '../types/person'
import {
  getActiveFactions,
  getActiveFactionMembership,
  getFactionByLeader,
  getFactionActiveMemberIds,
  getFactionMemberCap,
  getBestRoleScore,
  getOccupationRoleFitBonus,
} from '../selectors/factionSelectors'
import { isHouselessPerson, isLandlessHouseMember } from '../selectors/availabilitySelectors'
import { addFactionMembership } from '../mutations/factionMutations'
import { addPersonWealth } from '../mutations/personMutations'
import { setPersonAttitude } from '../mutations/attitudeMutations'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'

function buildRecruitmentBasePool(ctx: TickContext): PersonId[] {
  const config = ctx.config
  const result: PersonId[] = []
  for (const pid of ctx.state.livingPersonIds) {
    const p = ctx.state.persons[pid]
    if (!p) continue
    if (p.kind === 'placeholder') continue
    if (p.age < config.adultAge) continue
    if (!(isHouselessPerson(ctx.state, pid) || isLandlessHouseMember(ctx.state, pid))) continue
    if (getActiveFactionMembership(ctx.state, pid)) continue
    if (getFactionByLeader(ctx.state, pid)) continue

    const officeIds = ctx.state.officeIndex.byHolderPerson[pid] ?? []
    let hasActiveOffice = false
    for (const oid of officeIds) {
      const o = ctx.state.officeAssignments[oid]
      if (o && o.active) {
        hasActiveOffice = true
        break
      }
    }
    if (hasActiveOffice) continue
    result.push(pid)
  }
  return result
}

// v0.17 §12: FactionRecruitmentSystem (yearly, Jan, after FactionLifecycle)
export function runFactionRecruitmentSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const basePool = buildRecruitmentBasePool(ctx)
  for (const faction of getActiveFactions(currentCtx.state)) {
    currentCtx = recruitForFaction(currentCtx, faction.id, basePool)
  }
  return currentCtx
}

function recruitForFaction(
  ctx: TickContext,
  factionId: FactionId,
  basePool: PersonId[],
): TickContext {
  const faction = ctx.state.factions[factionId]
  if (!faction || !faction.active) return ctx
  const leader = ctx.state.persons[faction.leaderPersonId]
  if (!leader || !leader.alive) return ctx
  const config = ctx.config

  const candidates: { personId: PersonId; score: number }[] = []
  for (const pid of basePool) {
    const p = ctx.state.persons[pid]
    if (!p || !p.alive) continue
    const score = computeRecruitmentScore(ctx, leader, p)
    candidates.push({ personId: pid, score })
  }
  candidates.sort((a, b) => b.score - a.score)

  const memberCap = getFactionMemberCap(ctx.state, config, factionId)
  const currentMemberCount = getFactionActiveMemberIds(ctx.state, factionId).length
  if (currentMemberCount >= memberCap) return ctx

  let currentCtx = ctx
  for (const { personId: candidateId } of candidates) {
    const updatedMemberCount = getFactionActiveMemberIds(currentCtx.state, factionId).length
    if (updatedMemberCount >= memberCap) break

    const candidate = currentCtx.state.persons[candidateId]
    if (!candidate || !candidate.alive) continue

    // cost / signing bonus
    const cost =
      config.baseFactionRecruitmentCost +
      candidate.legacyPrestige * config.factionRecruitmentPrestigeCostFactor +
      getBestRoleScore(currentCtx.state, candidateId) * config.factionRecruitmentAbilityCostFactor
    const signingBonus = Math.floor(cost * config.factionRecruitmentSigningBonusRate)

    const currentLeader = currentCtx.state.persons[faction.leaderPersonId]
    if (!currentLeader || currentLeader.wealth < cost) break

    // wealth transfers
    const lResult = addPersonWealth(currentCtx.state, faction.leaderPersonId, -Math.floor(cost))
    if (!lResult.ok) continue
    currentCtx = { ...currentCtx, state: lResult.value }

    const cResult = addPersonWealth(currentCtx.state, candidateId, signingBonus)
    if (cResult.ok) currentCtx = { ...currentCtx, state: cResult.value }

    // add membership
    const addResult = addFactionMembership(currentCtx.state, {
      factionId,
      personId: candidateId,
      week: currentCtx.state.absoluteWeek,
    })
    if (!addResult.ok) continue
    currentCtx = { ...currentCtx, state: addResult.value.state }

    // initial attitude
    const lToC = setPersonAttitude(
      currentCtx.state,
      faction.leaderPersonId,
      { kind: 'person', id: candidateId },
      {
        affection: config.recruitmentInitialAffection,
        respect: config.recruitmentInitialRespect,
      },
    )
    if (lToC.ok) currentCtx = { ...currentCtx, state: lToC.value }
    const cToL = setPersonAttitude(
      currentCtx.state,
      candidateId,
      { kind: 'person', id: faction.leaderPersonId },
      {
        affection: config.recruitmentInitialAffection,
        respect: config.recruitmentInitialRespect,
      },
    )
    if (cToL.ok) currentCtx = { ...currentCtx, state: cToL.value }

    // event
    const { event, ctx: ec } = createSimEvent(currentCtx, {
      type: 'PERSON_RECRUITED_TO_FACTION',
      importance: 'normal',
      messageKey: 'faction.member_recruited',
      messageParams: {
        person: nameParam('person', candidate.nameKey),
        leader: nameParam(
          'person',
          currentCtx.state.persons[faction.leaderPersonId]?.nameKey ?? 'unknown',
        ),
      },
      entityRefs: [
        entityRef('person', candidateId, 'recruit', candidate.nameKey),
        entityRef('person', faction.leaderPersonId, 'leader'),
        entityRef('faction', factionId, 'faction'),
      ],
    })
    currentCtx = { ...ec, events: [...ec.events, event] }
  }

  return currentCtx
}

function computeRecruitmentScore(ctx: TickContext, leader: Person, candidate: Person): number {
  const leaderToCand = getAttitudeOrDefault(ctx.state, leader, { kind: 'person', id: candidate.id })
  const candToLeader = getAttitudeOrDefault(ctx.state, candidate, { kind: 'person', id: leader.id })
  const occupationFit = getOccupationRoleFitBonus(candidate)
  return (
    leaderToCand.affection * 1.5 +
    leaderToCand.respect * 1.0 +
    candToLeader.affection * 0.8 +
    candToLeader.respect * 0.5 +
    getBestRoleScore(ctx.state, candidate.id) * 0.3 +
    occupationFit * 0.3 +
    (candidate.legacyPrestige / 100) * 5 -
    (candidate.wealth / 100) * 1
  )
}
