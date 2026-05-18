import type { TickContext } from './context'
import type { PersonId, FactionId, HouseId, PolityId } from '../types/ids'
import type { SimEvent } from '../types/event'
import { makeEventId } from './context'
import {
  getFactionByLeader,
  getActiveFactionMembership,
  getFactionActiveMemberIds,
  getFactionOpportunityScore,
  getFactionViabilityScore,
} from '../selectors/factionSelectors'
import {
  createFaction,
  addFactionMembership,
  deactivateFaction,
  transitionFactionLeader,
} from '../mutations/factionMutations'
import { setPersonAttitude } from '../mutations/attitudeMutations'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'

// v0.17 §13: FactionLifecycleSystem
// Runs each January, after mortality/estate/succession:
//   1. Existing active faction integrity check (leader death → succession or dissolution, dissolution conditions)
//   2. New faction formation decisions
export function runFactionLifecycleSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  // Phase 1: existing factions — leader vacancy / dissolution (runs every month)
  currentCtx = processExistingFactions(currentCtx)

  // Phase 2: new factions (January only)
  if (ctx.state.currentMonth === 1) {
    currentCtx = formNewFactions(currentCtx)
  }

  return currentCtx
}

function processExistingFactions(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const factionIds = (Object.keys(currentCtx.state.factions).sort() as FactionId[]).filter(
    (fid) => currentCtx.state.factions[fid]?.active,
  )
  for (const factionId of factionIds) {
    const faction = currentCtx.state.factions[factionId]
    if (!faction || !faction.active) continue

    const leader = currentCtx.state.persons[faction.leaderPersonId]
    const leaderAlive = leader && leader.alive && leader.kind !== 'placeholder'

    if (!leaderAlive) {
      currentCtx = handleLeaderVacancy(currentCtx, factionId)
      continue
    }

    // Dissolution checks (January only)
    if (currentCtx.state.currentMonth !== 1) continue

    const memberIds = getFactionActiveMemberIds(currentCtx.state, factionId)
    const viability = getFactionViabilityScore(currentCtx.state, currentCtx.config, factionId)
    const config = currentCtx.config

    const reasonsToDissolve: string[] = []
    if (memberIds.length < config.minimumFactionMembers)
      reasonsToDissolve.push('insufficient members')
    if (viability < config.factionDisbandThreshold) reasonsToDissolve.push('low viability')
    if (leader && leader.wealth < config.factionDisbandWealthFloor)
      reasonsToDissolve.push('leader bankrupt')

    if (reasonsToDissolve.length > 0) {
      currentCtx = dissolveFaction(
        currentCtx,
        factionId,
        `${faction.name} dissolved (${reasonsToDissolve.join(', ')}).`,
      )
    }
  }
  return currentCtx
}

function handleLeaderVacancy(ctx: TickContext, factionId: FactionId): TickContext {
  const faction = ctx.state.factions[factionId]
  if (!faction) return ctx

  const candidates: { personId: PersonId; score: number }[] = []
  const memberIds = getFactionActiveMemberIds(ctx.state, factionId).filter(
    (id) => id !== faction.leaderPersonId,
  )
  const oldLeader = ctx.state.persons[faction.leaderPersonId]

  for (const candidateId of memberIds) {
    const candidate = ctx.state.persons[candidateId]
    if (!candidate || !candidate.alive) continue
    if (candidate.kind === 'placeholder') continue

    // Score: attitude product (cand → old leader) + opportunity + wealth + prestige
    let attitudeProduct = 0
    if (oldLeader) {
      const att = getAttitudeOrDefault(ctx.state, candidate, {
        kind: 'person',
        id: faction.leaderPersonId,
      })
      attitudeProduct = ((att.affection + 100) * (att.respect + 100)) / 1000
    }
    const oppScore = getFactionOpportunityScore(ctx.state, ctx.config, candidateId)
    const wealthScore = candidate.wealth / 100
    const prestigeScore = (candidate.legacyPrestige / 100) * 5
    const score = attitudeProduct + oppScore * 2 + wealthScore + prestigeScore
    candidates.push({ personId: candidateId, score })
  }
  candidates.sort((a, b) => b.score - a.score)

  if (candidates.length === 0 || !candidates[0]) {
    return dissolveFaction(
      ctx,
      factionId,
      `${faction.name} dissolved after the death of ${oldLeader?.name ?? faction.leaderPersonId}.`,
    )
  }

  const newLeaderId = candidates[0].personId
  const result = transitionFactionLeader(ctx.state, { factionId, newLeaderPersonId: newLeaderId })
  if (!result.ok) {
    return dissolveFaction(ctx, factionId, `${faction.name} dissolved (leader transition failed).`)
  }
  const ctx1: TickContext = { ...ctx, state: result.value }
  const newLeader = ctx1.state.persons[newLeaderId]
  const { id: eventId, ctx: ec } = makeEventId(ctx1)
  const event: SimEvent = {
    id: eventId,
    year: ec.state.currentYear,
    month: ec.state.currentMonth,
    type: 'FACTION_LEADER_CHANGED',
    importance: 'normal',
    actorIds: [faction.leaderPersonId, newLeaderId],
    houseIds: newLeader ? [newLeader.houseId] : [],
    polityIds: [],
    provinceIds: [],
    summary: `${newLeader?.name ?? newLeaderId} succeeded ${oldLeader?.name ?? faction.leaderPersonId} as the head of ${faction.name}.`,
    reasons: [],
    effects: [],
  }
  return { ...ec, events: [...ec.events, event] }
}

function dissolveFaction(ctx: TickContext, factionId: FactionId, summary: string): TickContext {
  const faction = ctx.state.factions[factionId]
  if (!faction) return ctx
  const result = deactivateFaction(ctx.state, factionId)
  if (!result.ok) return ctx
  const ctx1: TickContext = { ...ctx, state: result.value }
  const oldLeader = ctx1.state.persons[faction.leaderPersonId]
  const { id: eventId, ctx: ec } = makeEventId(ctx1)
  const event: SimEvent = {
    id: eventId,
    year: ec.state.currentYear,
    month: ec.state.currentMonth,
    type: 'FACTION_DISSOLVED',
    importance: 'normal',
    actorIds: [faction.leaderPersonId],
    houseIds: oldLeader ? [oldLeader.houseId] : [],
    polityIds: [],
    provinceIds: [],
    summary,
    reasons: [],
    effects: [],
  }
  return { ...ec, events: [...ec.events, event] }
}

function formNewFactions(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const config = currentCtx.config

  // Candidate founders
  const founders: { personId: PersonId; score: number }[] = []
  for (const pid of Object.keys(currentCtx.state.persons).sort() as PersonId[]) {
    const person = currentCtx.state.persons[pid]
    if (!person || !person.alive) continue
    if (person.kind === 'placeholder') continue
    if (person.age < config.adultAge) continue

    const house = currentCtx.state.houses[person.houseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue // §13.4 system House excluded
    if (getFactionByLeader(currentCtx.state, pid)) continue
    if (getActiveFactionMembership(currentCtx.state, pid)) continue
    if (person.wealth < config.minimumFactionFounderWealth) continue

    const oppScore = getFactionOpportunityScore(currentCtx.state, currentCtx.config, pid)
    if (oppScore < config.factionFormationThreshold) continue

    // Score: ambition + opportunity + prestige
    const score = oppScore * 1.0 + person.traits.ambition * 5 + (person.legacyPrestige / 100) * 3
    founders.push({ personId: pid, score })
  }
  founders.sort((a, b) => b.score - a.score)

  // Process top N founders (cap so multiple factions can form per year but not unbounded)
  const maxFoundersPerYear = 3
  let formed = 0
  for (const { personId: leaderId } of founders) {
    if (formed >= maxFoundersPerYear) break
    currentCtx = tryFoundFaction(currentCtx, leaderId)
    if (getFactionByLeader(currentCtx.state, leaderId)) formed++
  }

  return currentCtx
}

function tryFoundFaction(ctx: TickContext, leaderId: PersonId): TickContext {
  const config = ctx.config
  const leader = ctx.state.persons[leaderId]
  if (!leader) return ctx

  // Faction name = "{leader.name}'s Circle"
  const factionName = `${leader.name}'s Circle`

  // Initial members from candidate pool
  const candidates = pickInitialMemberCandidates(ctx, leaderId)
  const slots = config.initialFactionMemberMax
  const selected = candidates.slice(0, slots)

  if (selected.length < config.minimumInitialFactionMembers) {
    // not enough initial members; do not found
    return ctx
  }

  // createFaction (CtxResult)
  const createResult = createFaction(ctx, {
    leaderPersonId: leaderId,
    name: factionName,
    year: ctx.state.currentYear,
    month: ctx.state.currentMonth,
  })
  if (!createResult.ok) return ctx
  let currentCtx = createResult.value.ctx
  const factionId = createResult.value.value.factionId

  // Add initial members + initial attitudes (Founded is a key-creation event)
  const initialMemberIds: PersonId[] = []
  for (const memberId of selected) {
    const addResult = addFactionMembership(currentCtx.state, {
      factionId,
      personId: memberId,
      year: currentCtx.state.currentYear,
      month: currentCtx.state.currentMonth,
    })
    if (!addResult.ok) continue
    currentCtx = { ...currentCtx, state: addResult.value.state }
    initialMemberIds.push(memberId)

    // Initial attitudes (overwrite — Founded is an important event)
    const leaderToMember = setPersonAttitude(
      currentCtx.state,
      leaderId,
      { kind: 'person', id: memberId },
      {
        affection: config.recruitmentInitialAffection,
        respect: config.recruitmentInitialRespect,
      },
    )
    if (leaderToMember.ok) currentCtx = { ...currentCtx, state: leaderToMember.value }
    const memberToLeader = setPersonAttitude(
      currentCtx.state,
      memberId,
      { kind: 'person', id: leaderId },
      {
        affection: config.recruitmentInitialAffection,
        respect: config.recruitmentInitialRespect,
      },
    )
    if (memberToLeader.ok) currentCtx = { ...currentCtx, state: memberToLeader.value }
  }

  // FACTION_FOUNDED event
  const { id: eventId, ctx: ec } = makeEventId(currentCtx)
  const housesInvolved: HouseId[] = [leader.houseId]
  for (const mid of initialMemberIds) {
    const m = ec.state.persons[mid]
    if (m && !housesInvolved.includes(m.houseId)) housesInvolved.push(m.houseId)
  }
  const polityIds: PolityId[] = []
  const event: SimEvent = {
    id: eventId,
    year: ec.state.currentYear,
    month: ec.state.currentMonth,
    type: 'FACTION_FOUNDED',
    importance: 'normal',
    actorIds: [leaderId, ...initialMemberIds],
    houseIds: housesInvolved,
    polityIds,
    provinceIds: [],
    summary: `${leader.name} founded the faction ${factionName}.`,
    reasons: [],
    effects: [],
  }
  return { ...ec, events: [...ec.events, event] }
}

function pickInitialMemberCandidates(ctx: TickContext, leaderId: PersonId): PersonId[] {
  const leader = ctx.state.persons[leaderId]
  if (!leader) return []
  const candidates: { personId: PersonId; score: number }[] = []

  for (const pid of Object.keys(ctx.state.persons).sort() as PersonId[]) {
    if (pid === leaderId) continue
    const p = ctx.state.persons[pid]
    if (!p || !p.alive) continue
    if (p.kind === 'placeholder') continue
    if (p.age < ctx.config.adultAge) continue
    if (getActiveFactionMembership(ctx.state, pid)) continue
    if (getFactionByLeader(ctx.state, pid)) continue

    // Bias: same House strongly preferred; attitudes also matter.
    let bias = 0
    if (p.houseId === leader.houseId) bias += 10
    const lToP = getAttitudeOrDefault(ctx.state, leader, { kind: 'person', id: pid })
    const pToL = getAttitudeOrDefault(ctx.state, p, { kind: 'person', id: leaderId })
    bias += (lToP.affection / 100) * 3
    bias += (pToL.affection / 100) * 3

    candidates.push({ personId: pid, score: bias })
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates.map((c) => c.personId)
}
