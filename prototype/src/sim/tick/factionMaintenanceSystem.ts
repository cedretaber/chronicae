import type { TickContext } from './context'
import type { FactionId } from '../types/ids'
import type { FactionMembershipId } from '../types/ids'
import { removeFactionMembership } from '../mutations/factionMutations'
import { handleFactionLeaderVacancy } from './factionLifecycleSystem'
import { isLivingPerson } from '../types/person'

export function runFactionMaintenanceSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const factionIds = (Object.keys(currentCtx.state.factions).sort() as FactionId[]).filter(
    (fid) => currentCtx.state.factions[fid]?.active,
  )
  for (const factionId of factionIds) {
    const faction = currentCtx.state.factions[factionId]
    if (!faction || !faction.active) continue

    const leader = currentCtx.state.persons[faction.leaderPersonId]
    const leaderAlive = isLivingPerson(leader)

    if (!leaderAlive) {
      currentCtx = handleFactionLeaderVacancy(currentCtx, factionId)
      continue
    }

    currentCtx = removeDeadMemberships(currentCtx, factionId)
  }
  return currentCtx
}

function removeDeadMemberships(ctx: TickContext, factionId: FactionId): TickContext {
  const faction = ctx.state.factions[factionId]
  if (!faction || !faction.active) return ctx

  const targetIds = (
    Object.keys(ctx.state.factionMemberships).sort() as FactionMembershipId[]
  ).filter((mid) => {
    const m = ctx.state.factionMemberships[mid]
    if (!m || !m.active || m.factionId !== factionId) return false
    if (m.personId === faction.leaderPersonId) return false
    const p = ctx.state.persons[m.personId]
    return Boolean(p && !p.alive)
  })

  let currentCtx = ctx
  for (const membershipId of targetIds) {
    const result = removeFactionMembership(currentCtx.state, membershipId)
    if (result.ok) currentCtx = { ...currentCtx, state: result.value }
  }
  return currentCtx
}
