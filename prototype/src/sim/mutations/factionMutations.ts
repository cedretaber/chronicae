import type { WorldState } from '@sim/types/world'
import type { TickContext } from '@sim/tick/context'
import type { PersonId, FactionId, FactionMembershipId } from '@sim/types/ids'
import type { Faction, FactionMembership } from '@sim/types/faction'
import { createFactionId, createFactionMembershipId } from '@sim/types/ids'
import type { StateResult, CtxResult } from './result'
import { ok, err } from './result'

export type CreateFactionInput = {
  leaderPersonId: PersonId
  name: string
  year: number
  month: number
}

// Creates a Faction + leader FactionMembership atomically.
// Validates: leader exists, alive, kind !== 'placeholder', has no active membership elsewhere.
export function createFaction(
  ctx: TickContext,
  input: CreateFactionInput,
): CtxResult<{ factionId: FactionId; leaderMembershipId: FactionMembershipId }> {
  const leader = ctx.state.persons[input.leaderPersonId]
  if (!leader) return err({ code: 'PERSON_NOT_FOUND', message: 'createFaction: leader not found' })
  if (!leader.alive) return err({ code: 'PERSON_DEAD', message: 'createFaction: leader is dead' })
  if (leader.kind === 'placeholder')
    return err({
      code: 'PLACEHOLDER_PERSON',
      message: 'createFaction: leader is placeholder',
    })

  const existingMemberships = ctx.state.factionIndex.byMember[input.leaderPersonId] ?? []
  for (const mid of existingMemberships) {
    const m = ctx.state.factionMemberships[mid]
    if (m && m.active)
      return err({
        code: 'FACTION_MEMBERSHIP_CONFLICT',
        message: 'createFaction: leader already has active membership',
      })
  }

  const factionId = createFactionId(ctx.state.nextFactionId)
  const membershipId = createFactionMembershipId(ctx.state.nextFactionMembershipId)

  const faction: Faction = {
    id: factionId,
    name: input.name,
    leaderPersonId: input.leaderPersonId,
    active: true,
    foundingYear: input.year,
    foundingMonth: input.month,
  }
  const membership: FactionMembership = {
    id: membershipId,
    factionId,
    personId: input.leaderPersonId,
    active: true,
    joinedYear: input.year,
    joinedMonth: input.month,
  }

  const existingByLeader = ctx.state.factionIndex.byLeader[input.leaderPersonId] ?? []
  const existingByMember = ctx.state.factionIndex.byMember[input.leaderPersonId] ?? []

  const newState: WorldState = {
    ...ctx.state,
    factions: { ...ctx.state.factions, [factionId]: faction },
    factionMemberships: {
      ...ctx.state.factionMemberships,
      [membershipId]: membership,
    },
    factionIndex: {
      byLeader: {
        ...ctx.state.factionIndex.byLeader,
        [input.leaderPersonId]: [...existingByLeader, factionId],
      },
      byMember: {
        ...ctx.state.factionIndex.byMember,
        [input.leaderPersonId]: [...existingByMember, membershipId],
      },
    },
    nextFactionId: ctx.state.nextFactionId + 1,
    nextFactionMembershipId: ctx.state.nextFactionMembershipId + 1,
  }

  return ok({
    ctx: { ...ctx, state: newState },
    value: { factionId, leaderMembershipId: membershipId },
  })
}

export type AddFactionMembershipInput = {
  factionId: FactionId
  personId: PersonId
  year: number
  month: number
}

export function addFactionMembership(
  state: WorldState,
  input: AddFactionMembershipInput,
): StateResult<{ state: WorldState; membershipId: FactionMembershipId }> {
  const faction = state.factions[input.factionId]
  if (!faction)
    return err({ code: 'FACTION_NOT_FOUND', message: 'addFactionMembership: faction not found' })
  if (!faction.active)
    return err({ code: 'FACTION_INACTIVE', message: 'addFactionMembership: faction inactive' })

  const person = state.persons[input.personId]
  if (!person)
    return err({ code: 'PERSON_NOT_FOUND', message: 'addFactionMembership: person not found' })
  if (!person.alive)
    return err({ code: 'PERSON_DEAD', message: 'addFactionMembership: person is dead' })
  if (person.kind === 'placeholder')
    return err({
      code: 'PLACEHOLDER_PERSON',
      message: 'addFactionMembership: person is placeholder',
    })
  if (input.personId === faction.leaderPersonId)
    return err({
      code: 'FACTION_LEADER_MEMBERSHIP_EXISTS',
      message: 'addFactionMembership: leader already has membership',
    })

  const existingMemberships = state.factionIndex.byMember[input.personId] ?? []
  for (const mid of existingMemberships) {
    const m = state.factionMemberships[mid]
    if (m && m.active)
      return err({
        code: 'FACTION_MEMBERSHIP_CONFLICT',
        message: 'addFactionMembership: person already has active membership',
      })
  }

  const membershipId = createFactionMembershipId(state.nextFactionMembershipId)
  const membership: FactionMembership = {
    id: membershipId,
    factionId: input.factionId,
    personId: input.personId,
    active: true,
    joinedYear: input.year,
    joinedMonth: input.month,
  }

  const newState: WorldState = {
    ...state,
    factionMemberships: { ...state.factionMemberships, [membershipId]: membership },
    factionIndex: {
      byLeader: state.factionIndex.byLeader,
      byMember: {
        ...state.factionIndex.byMember,
        [input.personId]: [...existingMemberships, membershipId],
      },
    },
    nextFactionMembershipId: state.nextFactionMembershipId + 1,
  }

  return ok({ state: newState, membershipId })
}

// Deactivates the faction and ALL its memberships (leader + members).
export function deactivateFaction(state: WorldState, factionId: FactionId): StateResult {
  const faction = state.factions[factionId]
  if (!faction) return err({ code: 'FACTION_NOT_FOUND', message: 'deactivateFaction: not found' })
  if (!faction.active) return ok(state)

  const newMemberships = { ...state.factionMemberships }
  for (const [mid, m] of Object.entries(state.factionMemberships)) {
    if (!m) continue
    if (m.factionId !== factionId) continue
    if (!m.active) continue
    newMemberships[mid as FactionMembershipId] = { ...m, active: false }
  }

  return ok({
    ...state,
    factions: { ...state.factions, [factionId]: { ...faction, active: false } },
    factionMemberships: newMemberships,
  })
}

export type TransitionFactionLeaderInput = {
  factionId: FactionId
  newLeaderPersonId: PersonId
}

// Moves leadership to an existing active member. The old leader's membership becomes inactive.
export function transitionFactionLeader(
  state: WorldState,
  input: TransitionFactionLeaderInput,
): StateResult {
  const faction = state.factions[input.factionId]
  if (!faction)
    return err({ code: 'FACTION_NOT_FOUND', message: 'transitionFactionLeader: not found' })
  if (!faction.active)
    return err({ code: 'FACTION_INACTIVE', message: 'transitionFactionLeader: inactive' })

  const oldLeaderId = faction.leaderPersonId
  if (oldLeaderId === input.newLeaderPersonId) return ok(state)

  const newLeader = state.persons[input.newLeaderPersonId]
  if (!newLeader)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'transitionFactionLeader: new leader not found',
    })
  if (!newLeader.alive)
    return err({ code: 'PERSON_DEAD', message: 'transitionFactionLeader: new leader dead' })
  if (newLeader.kind === 'placeholder')
    return err({
      code: 'PLACEHOLDER_PERSON',
      message: 'transitionFactionLeader: new leader is placeholder',
    })

  // new leader must currently be an active member of THIS faction
  let newLeaderHasMembership = false
  const newLeaderMembershipIds = state.factionIndex.byMember[input.newLeaderPersonId] ?? []
  for (const mid of newLeaderMembershipIds) {
    const m = state.factionMemberships[mid]
    if (m && m.active && m.factionId === input.factionId) {
      newLeaderHasMembership = true
      break
    }
  }
  if (!newLeaderHasMembership)
    return err({
      code: 'FACTION_MEMBERSHIP_NOT_FOUND',
      message: 'transitionFactionLeader: new leader is not an active member',
    })

  // Deactivate old leader's membership in THIS faction
  const newMemberships = { ...state.factionMemberships }
  const oldLeaderMembershipIds = state.factionIndex.byMember[oldLeaderId] ?? []
  for (const mid of oldLeaderMembershipIds) {
    const m = state.factionMemberships[mid]
    if (m && m.active && m.factionId === input.factionId) {
      newMemberships[mid] = { ...m, active: false }
    }
  }

  // Index update: byLeader is rebuilt for both persons
  const oldLeaderLed = state.factionIndex.byLeader[oldLeaderId] ?? []
  const newLeaderLed = state.factionIndex.byLeader[input.newLeaderPersonId] ?? []
  const newByLeader = {
    ...state.factionIndex.byLeader,
    [oldLeaderId]: oldLeaderLed.filter((fid) => fid !== input.factionId),
    [input.newLeaderPersonId]: [...newLeaderLed, input.factionId],
  }

  return ok({
    ...state,
    factions: {
      ...state.factions,
      [input.factionId]: { ...faction, leaderPersonId: input.newLeaderPersonId },
    },
    factionMemberships: newMemberships,
    factionIndex: {
      byLeader: newByLeader,
      byMember: state.factionIndex.byMember,
    },
  })
}

// Single member leaves the faction. Cannot be called on the current leader's membership.
export function removeFactionMembership(
  state: WorldState,
  membershipId: FactionMembershipId,
): StateResult {
  const membership = state.factionMemberships[membershipId]
  if (!membership)
    return err({
      code: 'FACTION_MEMBERSHIP_NOT_FOUND',
      message: 'removeFactionMembership: not found',
    })
  if (!membership.active) return ok(state)

  const faction = state.factions[membership.factionId]
  if (faction && faction.active && faction.leaderPersonId === membership.personId) {
    return err({
      code: 'FACTION_LEADER_MEMBERSHIP_PROTECTED',
      message:
        'removeFactionMembership: cannot remove leader membership; use transitionFactionLeader or deactivateFaction',
    })
  }

  return ok({
    ...state,
    factionMemberships: {
      ...state.factionMemberships,
      [membershipId]: { ...membership, active: false },
    },
  })
}
