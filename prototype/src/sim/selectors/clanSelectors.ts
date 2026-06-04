import type { WorldState } from '@sim/types/world'
import type { HouseId, ClanId } from '@sim/types/ids'
import type { Clan } from '@sim/types/clan'
import { isRulingHouse, isInfluentialHouse } from './availabilitySelectors'
import type { SimulationConfig } from '../config/defaultConfig'

export function getClan(state: WorldState, clanId: ClanId): Clan | undefined {
  return state.clans[clanId]
}

export function getHouseClan(state: WorldState, houseId: HouseId): Clan | undefined {
  const house = state.houses[houseId]
  if (!house?.clanId) return undefined
  return state.clans[house.clanId]
}

export function getClanActiveHouseIds(state: WorldState, clanId: ClanId): HouseId[] {
  const clan = state.clans[clanId]
  if (!clan) return []
  const result: HouseId[] = []
  for (const houseId of clan.memberHouseIds) {
    const house = state.houses[houseId]
    if (house && house.active) result.push(houseId)
  }
  return result
}

export function getClanExtinctHouseIds(state: WorldState, clanId: ClanId): HouseId[] {
  const clan = state.clans[clanId]
  if (!clan) return []
  const result: HouseId[] = []
  for (const houseId of clan.memberHouseIds) {
    const house = state.houses[houseId]
    if (house && !house.active) result.push(houseId)
  }
  return result
}

export function getClanLivingMemberCount(state: WorldState, clanId: ClanId): number {
  const clan = state.clans[clanId]
  if (!clan) return 0
  let count = 0
  for (const houseId of clan.memberHouseIds) {
    const house = state.houses[houseId]
    if (house && house.active) count += house.memberIds.length
  }
  return count
}

export function getClanTotalWealth(state: WorldState, clanId: ClanId): number {
  const clan = state.clans[clanId]
  if (!clan) return 0
  let total = 0
  for (const houseId of clan.memberHouseIds) {
    const house = state.houses[houseId]
    if (house && house.active) total += house.wealth
  }
  return total
}

export function getClanTotalLegacyPrestige(state: WorldState, clanId: ClanId): number {
  const clan = state.clans[clanId]
  if (!clan) return 0
  let total = 0
  for (const houseId of clan.memberHouseIds) {
    const house = state.houses[houseId]
    if (house && house.active) total += house.legacyPrestige
  }
  return total
}

export function getClanRulingHouseIds(state: WorldState, clanId: ClanId): HouseId[] {
  const clan = state.clans[clanId]
  if (!clan) return []
  const result: HouseId[] = []
  for (const houseId of clan.memberHouseIds) {
    const house = state.houses[houseId]
    if (house && house.active && isRulingHouse(state, houseId)) result.push(houseId)
  }
  return result
}

export function getClanInfluentialHouseIds(
  state: WorldState,
  config: SimulationConfig,
  clanId: ClanId,
): HouseId[] {
  const clan = state.clans[clanId]
  if (!clan) return []
  const result: HouseId[] = []
  for (const houseId of clan.memberHouseIds) {
    const house = state.houses[houseId]
    if (house && house.active && isInfluentialHouse(state, config, houseId)) result.push(houseId)
  }
  return result
}

export function getHouseClanRole(
  state: WorldState,
  houseId: HouseId,
): 'root' | 'descendant' | undefined {
  const house = state.houses[houseId]
  if (!house?.clanId) return undefined
  const clan = state.clans[house.clanId]
  if (!clan) return undefined
  if (clan.rootHouseId === houseId) return 'root'
  return 'descendant'
}

export function getDescendantHouseIdsIncludingSelf(
  state: WorldState,
  rootHouseId: HouseId,
): HouseId[] {
  const result: HouseId[] = []
  const visited = new Set<string>()
  const stack: HouseId[] = [rootHouseId]
  while (stack.length > 0) {
    const houseId = stack.pop()!
    if (visited.has(houseId)) continue
    visited.add(houseId)
    const house = state.houses[houseId]
    if (!house) continue
    if (house.kind === 'system') continue
    result.push(houseId)
    for (const cadetId of house.cadetHouseIds) {
      if (!visited.has(cadetId)) stack.push(cadetId)
    }
  }
  return result
}
