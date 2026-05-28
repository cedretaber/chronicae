import type { TickContext } from './context'
import type { PersonId, FactionId, HouseId } from '../types/ids'
import type { ShareHolderRef } from '../types/office'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import {
  getFactionByLeader,
  getActiveFactionMembership,
  getFactionActiveMemberIds,
  getFactionOpportunityScore,
  getFactionViabilityScore,
} from '../selectors/factionSelectors'
import { getTopShareholders, getPersonHouseSharePercent } from '../selectors/shareSelectors'
import {
  createFaction,
  addFactionMembership,
  deactivateFaction,
  transitionFactionLeader,
} from '../mutations/factionMutations'
import { setPersonAttitude } from '../mutations/attitudeMutations'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'

// v0.19: FactionLifecycleYearlySystem (intervalWeeks=52)
// Dissolution checks + new faction formation. Runs once per year.
// Leader vacancy + dead member cleanup is handled by FactionMaintenanceSystem (intervalWeeks=4).
export function runFactionLifecycleSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  currentCtx = checkDissolutions(currentCtx)
  currentCtx = formNewFactions(currentCtx)

  return currentCtx
}

function checkDissolutions(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const factionIds = (Object.keys(currentCtx.state.factions).sort() as FactionId[]).filter(
    (fid) => currentCtx.state.factions[fid]?.active,
  )
  for (const factionId of factionIds) {
    const faction = currentCtx.state.factions[factionId]
    if (!faction || !faction.active) continue

    const leader = currentCtx.state.persons[faction.leaderPersonId]
    if (!leader || !leader.alive || leader.kind === 'placeholder') continue

    const memberIds = getFactionActiveMemberIds(currentCtx.state, factionId)
    const viability = getFactionViabilityScore(currentCtx.state, currentCtx.config, factionId)
    const config = currentCtx.config

    if (!leader.houseId) continue
    const leaderHouse = currentCtx.state.houses[leader.houseId]

    const reasonsToDissolve: string[] = []
    if (!leaderHouse || !leaderHouse.active || leaderHouse.kind === 'system')
      reasonsToDissolve.push('leader unaffiliated')
    if (memberIds.length < config.minimumFactionMembers)
      reasonsToDissolve.push('insufficient members')
    if (viability < config.factionDisbandThreshold) reasonsToDissolve.push('low viability')
    if (leader.wealth < config.factionDisbandWealthFloor) reasonsToDissolve.push('leader bankrupt')

    if (reasonsToDissolve.length > 0) {
      if (reasonsToDissolve.includes('leader bankrupt')) {
        const { event, ctx: ec } = createSimEvent(currentCtx, {
          type: 'FACTION_LEADER_BANKRUPT',
          importance: 'normal',
          messageKey: 'faction.leader_bankrupt',
          messageParams: {
            person: nameParam('person', leader.nameKey),
            factionLeader: nameParam(
              'person',
              currentCtx.state.persons[faction.leaderPersonId]?.nameKey ?? 'unknown',
            ),
          },
          entityRefs: [
            entityRef('person', faction.leaderPersonId, 'leader', leader.nameKey),
            entityRef('faction', factionId, 'faction'),
          ],
        })
        currentCtx = { ...ec, events: [...ec.events, event] }
      }
      currentCtx = dissolveFaction(
        currentCtx,
        factionId,
        `${faction.id} dissolved (${reasonsToDissolve.join(', ')}).`,
      )
    }
  }
  return currentCtx
}

// Exported for use by FactionMaintenanceSystem
export function handleFactionLeaderVacancy(ctx: TickContext, factionId: FactionId): TickContext {
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
    if (!candidate.houseId) continue
    const candidateHouse = ctx.state.houses[candidate.houseId]
    if (!candidateHouse || !candidateHouse.active || candidateHouse.kind === 'system') continue

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
      `${faction.id} dissolved after the death of ${oldLeader?.nameKey ?? faction.leaderPersonId}.`,
    )
  }

  const newLeaderId = candidates[0].personId
  const result = transitionFactionLeader(ctx.state, { factionId, newLeaderPersonId: newLeaderId })
  if (!result.ok) {
    return dissolveFaction(ctx, factionId, `${faction.id} dissolved (leader transition failed).`)
  }
  const ctx1: TickContext = { ...ctx, state: result.value }
  const newLeader = ctx1.state.persons[newLeaderId]
  const { event, ctx: ec } = createSimEvent(ctx1, {
    type: 'FACTION_LEADER_CHANGED',
    importance: 'normal',
    messageKey: 'faction.leader_changed',
    messageParams: {
      newLeader: nameParam('person', newLeader?.nameKey ?? 'unknown'),
      oldLeader: nameParam('person', oldLeader?.nameKey ?? 'unknown'),
      factionLeader: nameParam('person', ctx1.state.persons[newLeaderId]?.nameKey ?? 'unknown'),
    },
    entityRefs: [
      entityRef('person', newLeaderId, 'newLeader', newLeader?.nameKey),
      entityRef('person', faction.leaderPersonId, 'oldLeader', oldLeader?.nameKey),
      entityRef('faction', factionId, 'faction'),
    ],
  })
  return { ...ec, events: [...ec.events, event] }
}

function dissolveFaction(ctx: TickContext, factionId: FactionId, summary: string): TickContext {
  const faction = ctx.state.factions[factionId]
  if (!faction) return ctx
  const result = deactivateFaction(ctx.state, factionId)
  if (!result.ok) return ctx
  const ctx1: TickContext = { ...ctx, state: result.value }
  const oldLeader = ctx1.state.persons[faction.leaderPersonId]
  const { event, ctx: ec } = createSimEvent(ctx1, {
    type: 'FACTION_DISSOLVED',
    importance: 'normal',
    messageKey: 'faction.dissolved',
    messageParams: {
      factionLeader: nameParam(
        'person',
        ctx1.state.persons[faction.leaderPersonId]?.nameKey ?? 'unknown',
      ),
      reasons: summary,
    },
    entityRefs: [
      entityRef('person', faction.leaderPersonId, 'leader', oldLeader?.nameKey),
      entityRef('faction', factionId, 'faction'),
    ],
  })
  return { ...ec, events: [...ec.events, event] }
}

function formNewFactions(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const config = currentCtx.config

  const topShareholderCache = new Map<
    string,
    Array<{ holder: ShareHolderRef; rawPower: number; percent: number }>
  >()
  function getTopShareholdersForHouse(houseId: HouseId) {
    const cached = topShareholderCache.get(houseId)
    if (cached) return cached
    const result = getTopShareholders(
      currentCtx.state,
      { kind: 'house', id: houseId },
      config.factionFounderShareRank,
    )
    topShareholderCache.set(houseId, result)
    return result
  }

  const founders: { personId: PersonId; score: number }[] = []
  for (const pid of currentCtx.state.livingPersonIds) {
    const person = currentCtx.state.persons[pid]
    if (!person) continue
    if (person.kind === 'placeholder') continue
    if (person.age < config.adultAge) continue
    if (!person.houseId) continue

    const house = currentCtx.state.houses[person.houseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue
    if (getFactionByLeader(currentCtx.state, pid)) continue
    if (getActiveFactionMembership(currentCtx.state, pid)) continue
    if (person.wealth < config.minimumFactionFounderWealth) continue

    const topHolders = getTopShareholdersForHouse(house.id)
    const isTopShareHolder = topHolders.some(
      (s) => s.holder.kind === 'person' && s.holder.id === pid,
    )
    if (!isTopShareHolder) continue

    const sharePercent = getPersonHouseSharePercent(currentCtx.state, house.id, pid)
    const score =
      sharePercent * 0.1 + person.traits.ambition * 5 + (person.legacyPrestige / 100) * 3
    founders.push({ personId: pid, score })
  }
  founders.sort((a, b) => b.score - a.score)

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
  if (!leader.houseId) return ctx

  const factionName = `${leader.nameKey}'s Circle`
  const candidates = pickInitialMemberCandidates(ctx, leaderId)
  const slots = config.initialFactionMemberMax
  const selected = candidates.slice(0, slots)

  if (selected.length < config.minimumInitialFactionMembers) {
    return ctx
  }

  const createResult = createFaction(ctx, {
    leaderPersonId: leaderId,
    week: ctx.state.absoluteWeek,
  })
  if (!createResult.ok) return ctx
  let currentCtx = createResult.value.ctx
  const factionId = createResult.value.value.factionId

  const initialMemberIds: PersonId[] = []
  for (const memberId of selected) {
    const addResult = addFactionMembership(currentCtx.state, {
      factionId,
      personId: memberId,
      week: currentCtx.state.absoluteWeek,
    })
    if (!addResult.ok) continue
    currentCtx = { ...currentCtx, state: addResult.value.state }
    initialMemberIds.push(memberId)

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

  const housesInvolved: HouseId[] = leader.houseId ? [leader.houseId] : []
  for (const mid of initialMemberIds) {
    const m = currentCtx.state.persons[mid]
    if (m && m.houseId && !housesInvolved.includes(m.houseId)) housesInvolved.push(m.houseId)
  }

  const { event, ctx: ec } = createSimEvent(currentCtx, {
    type: 'FACTION_FOUNDED',
    importance: 'normal',
    messageKey: 'faction.founded',
    messageParams: {
      person: nameParam('person', leader.nameKey),
      faction: factionName,
    },
    entityRefs: [
      entityRef('person', leaderId, 'leader', leader.nameKey),
      entityRef('faction', factionId, 'faction'),
      ...initialMemberIds.map((mid) => entityRef('person', mid, 'member')),
    ],
  })
  return { ...ec, events: [...ec.events, event] }
}

function pickInitialMemberCandidates(ctx: TickContext, leaderId: PersonId): PersonId[] {
  const leader = ctx.state.persons[leaderId]
  if (!leader) return []
  const candidates: { personId: PersonId; score: number }[] = []

  for (const pid of ctx.state.livingPersonIds) {
    if (pid === leaderId) continue
    const p = ctx.state.persons[pid]
    if (!p) continue
    if (p.kind === 'placeholder') continue
    if (p.age < ctx.config.adultAge) continue
    if (getActiveFactionMembership(ctx.state, pid)) continue
    if (getFactionByLeader(ctx.state, pid)) continue

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
