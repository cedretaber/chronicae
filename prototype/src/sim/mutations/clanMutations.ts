import type { WorldState } from '@sim/types/world'
import type { HouseId, ClanId, PersonId } from '@sim/types/ids'
import { createClanId } from '@sim/types/ids'
import type { Clan } from '@sim/types/clan'

export function createClan(
  state: WorldState,
  params: {
    rootHouseId: HouseId
    memberHouseIds: HouseId[]
    founderPersonId?: PersonId
    createdWeek: number
  },
): { state: WorldState; clan: Clan } {
  const id = createClanId(state.nextClanId)
  const clan: Clan = {
    id,
    active: true,
    rootHouseId: params.rootHouseId,
    nameSourceHouseId: params.rootHouseId,
    memberHouseIds: [...params.memberHouseIds],
    ...(params.founderPersonId !== undefined && { founderPersonId: params.founderPersonId }),
    createdWeek: params.createdWeek,
  }

  let houses = state.houses
  for (const houseId of params.memberHouseIds) {
    const house = houses[houseId]
    if (!house) continue
    houses = { ...houses, [houseId]: { ...house, clanId: id } }
  }

  const newState: WorldState = {
    ...state,
    clans: { ...state.clans, [id]: clan },
    houses,
    nextClanId: state.nextClanId + 1,
  }
  return { state: newState, clan }
}

export function addHouseToClan(state: WorldState, clanId: ClanId, houseId: HouseId): WorldState {
  const clan = state.clans[clanId]
  if (!clan) return state
  const house = state.houses[houseId]
  if (!house) return state
  if (house.kind === 'system') return state
  if (house.clanId !== undefined && house.clanId !== clanId) return state

  const alreadyMember = clan.memberHouseIds.includes(houseId)
  const updatedClan: Clan = alreadyMember
    ? clan
    : { ...clan, memberHouseIds: [...clan.memberHouseIds, houseId] }
  const updatedHouse = house.clanId === clanId ? house : { ...house, clanId }

  if (updatedClan === clan && updatedHouse === house) return state

  return {
    ...state,
    clans: { ...state.clans, [clanId]: updatedClan },
    houses: { ...state.houses, [houseId]: updatedHouse },
  }
}

export function syncClanActive(state: WorldState, clanId: ClanId): WorldState {
  const clan = state.clans[clanId]
  if (!clan) return state
  const newActive = clan.memberHouseIds.some((houseId) => {
    const house = state.houses[houseId]
    return house !== undefined && house.active && house.kind !== 'system'
  })
  if (clan.active === newActive) return state
  return {
    ...state,
    clans: { ...state.clans, [clanId]: { ...clan, active: newActive } },
  }
}
