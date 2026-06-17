import type { WorldState } from '@sim/types/world'
import type { HouseId, ClanId } from '@sim/types/ids'
import { isRulingHouse } from './availabilitySelectors'

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
