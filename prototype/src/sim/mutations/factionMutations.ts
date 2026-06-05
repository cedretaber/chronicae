import type { WorldState } from '@sim/types/world'
import type { TickContext } from '@sim/tick/context'
import { createSimEvent } from '@sim/tick/context'
import type { PersonId, FactionId, FactionMembershipId, PolityId } from '@sim/types/ids'
import type { Faction, FactionMembership } from '@sim/types/faction'
import { createFactionId, createFactionMembershipId } from '@sim/types/ids'
import { entityRef, nameParam } from '@sim/types/event'
import type { StateResult, CtxResult } from './result'
import { ok, err } from './result'

export type CreateFactionInput = {
  leaderPersonId: PersonId
  // v0.42 §12.2: anchor Polity。呼出側 (factionLifecycleSystem) が founding 前に決定する。
  polityId: PolityId
  week: number
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

  const polity = ctx.state.polities[input.polityId]
  if (!polity || !polity.active)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: 'createFaction: anchor polity not found or inactive: ' + input.polityId,
    })

  const faction: Faction = {
    id: factionId,
    leaderPersonId: input.leaderPersonId,
    polityId: input.polityId,
    active: true,
    foundingWeek: input.week,
  }
  const membership: FactionMembership = {
    id: membershipId,
    factionId,
    personId: input.leaderPersonId,
    active: true,
    joinedWeek: input.week,
  }

  const existingByLeader = ctx.state.factionIndex.byLeader[input.leaderPersonId] ?? []
  const existingByMember = ctx.state.factionIndex.byMember[input.leaderPersonId] ?? []
  const existingByPolity = ctx.state.factionIndex.byPolity[input.polityId] ?? []

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
      byPolity: {
        ...ctx.state.factionIndex.byPolity,
        [input.polityId]: [...existingByPolity, factionId],
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
  week: number
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
    joinedWeek: input.week,
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
      byPolity: state.factionIndex.byPolity,
    },
    nextFactionMembershipId: state.nextFactionMembershipId + 1,
  }

  return ok({ state: newState, membershipId })
}

// Deactivates the faction and DELETES ALL its memberships (leader + members).
// v0.17.3 C: 旧版は memberships を active=false にセットして残置していた。
// integrityCheck §21.5 I2 (byMember index sync) を満たすため byMember からも除去する。
// Faction entity 自体は active=false で残置 (historical reference / event 参照用)。
export function deactivateFaction(state: WorldState, factionId: FactionId): StateResult {
  const faction = state.factions[factionId]
  if (!faction) return err({ code: 'FACTION_NOT_FOUND', message: 'deactivateFaction: not found' })
  if (!faction.active) return ok(state)

  const newMemberships = { ...state.factionMemberships }
  const newByMember = { ...state.factionIndex.byMember }
  for (const [mid, m] of Object.entries(state.factionMemberships)) {
    if (!m) continue
    if (m.factionId !== factionId) continue
    delete newMemberships[mid as FactionMembershipId]
    const slot = newByMember[m.personId] ?? []
    newByMember[m.personId] = slot.filter((id) => id !== (mid as FactionMembershipId))
  }

  return ok({
    ...state,
    factions: { ...state.factions, [factionId]: { ...faction, active: false } },
    factionMemberships: newMemberships,
    factionIndex: {
      byLeader: state.factionIndex.byLeader,
      byMember: newByMember,
      byPolity: state.factionIndex.byPolity,
    },
  })
}

// v0.42 §12.3: polity inactive 化に伴う anchor Faction の即時解散 cascade。
// F8 (active Faction の anchor polity は active を指す) を年末 integrity 前に守る。
// polity を inactive 化する全経路 (polityOwnerConsistencySystem の landless 経路 /
// dissolveNegotiatingCommonwealth の revolt 解散経路) はこのヘルパーを経由すること。
// factionLifecycleSystem の anchor_polity_dissolved 判定は年次 (weekOfYear 1) のため安全網にしかならない。
export function dissolveFactionsAnchoredToPolity(
  ctx: TickContext,
  polityId: PolityId,
): TickContext {
  let next = ctx
  const anchoredIds = [...(next.state.factionIndex.byPolity[polityId] ?? [])].sort()
  for (const factionId of anchoredIds) {
    const faction = next.state.factions[factionId]
    if (!faction || !faction.active) continue
    const result = deactivateFaction(next.state, factionId)
    if (!result.ok) continue
    const leader = next.state.persons[faction.leaderPersonId]
    const { event, ctx: ec } = createSimEvent(
      { ...next, state: result.value },
      {
        type: 'FACTION_DISSOLVED',
        importance: 'normal',
        messageKey: 'faction.dissolved',
        messageParams: {
          leader: nameParam('person', leader?.nameKey ?? 'unknown'),
          // enum コード — 表示は enum.factionDissolveReason.* (eventRenderer)
          reason: 'anchor_polity_dissolved',
        },
        entityRefs: [
          entityRef('person', faction.leaderPersonId, 'leader', leader?.nameKey),
          entityRef('faction', factionId, 'faction'),
        ],
      },
    )
    next = { ...ec, events: [...ec.events, event] }
  }
  return next
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

  // v0.17.3 C: 旧 leader の membership を完全削除する (active=false 残置から変更)。
  // byMember の同期も行う。
  const newMemberships = { ...state.factionMemberships }
  const oldLeaderMembershipIds = state.factionIndex.byMember[oldLeaderId] ?? []
  const removedMembershipIds: FactionMembershipId[] = []
  for (const mid of oldLeaderMembershipIds) {
    const m = state.factionMemberships[mid]
    if (m && m.factionId === input.factionId) {
      delete newMemberships[mid]
      removedMembershipIds.push(mid)
    }
  }

  // Index update: byLeader is rebuilt for both persons; byMember は旧 leader の slot を再構築
  const oldLeaderLed = state.factionIndex.byLeader[oldLeaderId] ?? []
  const newLeaderLed = state.factionIndex.byLeader[input.newLeaderPersonId] ?? []
  const newByLeader = {
    ...state.factionIndex.byLeader,
    [oldLeaderId]: oldLeaderLed.filter((fid) => fid !== input.factionId),
    [input.newLeaderPersonId]: [...newLeaderLed, input.factionId],
  }
  const oldLeaderMemberSlot = (state.factionIndex.byMember[oldLeaderId] ?? []).filter(
    (mid) => !removedMembershipIds.includes(mid),
  )
  const newByMember = {
    ...state.factionIndex.byMember,
    [oldLeaderId]: oldLeaderMemberSlot,
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
      byMember: newByMember,
      byPolity: state.factionIndex.byPolity,
    },
  })
}

// Single member leaves the faction. Cannot be called on the current leader's membership.
// v0.17.3 C: membership を完全削除 (active=false 残置から変更)。byMember も同期。
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

  const newMemberships = { ...state.factionMemberships }
  delete newMemberships[membershipId]
  const byMemberSlot = (state.factionIndex.byMember[membership.personId] ?? []).filter(
    (id) => id !== membershipId,
  )

  return ok({
    ...state,
    factionMemberships: newMemberships,
    factionIndex: {
      byLeader: state.factionIndex.byLeader,
      byMember: {
        ...state.factionIndex.byMember,
        [membership.personId]: byMemberSlot,
      },
      byPolity: state.factionIndex.byPolity,
    },
  })
}
