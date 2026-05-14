import type { HouseId, PersonId } from '../types/ids'
import type { WorldState } from '../types/world'

export function setHouseHead(state: WorldState, houseId: HouseId, personId: PersonId): WorldState {
  const house = state.houses[houseId]
  if (!house) throw new Error('setHouseHead: house not found: ' + houseId)

  const newHouses = { ...state.houses }
  newHouses[houseId] = { ...house, headId: personId }

  return {
    ...state,
    houses: newHouses,
  }
}
