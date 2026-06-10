import type { WorldState } from '../types/world'
import type { PolityId, HouseId, PersonId } from '../types/ids'
import type { House } from '../types/house'
import { createOfficeAssignment } from './officeMutations'
import { movePersonToHouse } from './personMutations'

// v0.47 §13.5: 共和国役職者による landless House 創設の成功時 orchestration。
// person.houseId を新 House に付け替え、office は維持する (office は personId キーなので houseId
// 変更で revoke されない)。新 House は土地を持たない (seat は所属 commonwealth の capital province)。
export function applyRepublicHouseFoundationMut(
  ws: WorldState,
  params: {
    petitionerPersonId: PersonId
    commonwealthPolityId: PolityId
  },
): { ws: WorldState; newHouseId: HouseId } | undefined {
  const person = ws.persons[params.petitionerPersonId]
  if (!person) return undefined
  if (person.houseId !== undefined) return undefined // 無家のみ
  const commonwealth = ws.polities[params.commonwealthPolityId]
  if (!commonwealth) return undefined

  let state = ws
  const nextHouseIndex = state.nextHouseIndex ?? 0
  const newHouseId = `dh-${nextHouseIndex}` as HouseId

  const newHouse: House = {
    id: newHouseId,
    nameKey: person.nameKey,
    active: true,
    memberIds: [],
    deceasedMemberIds: [],
    founderId: params.petitionerPersonId,
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    // landless だが House は seatProvinceId 必須 → 所属 commonwealth の capital province を借用。
    seatProvinceId: commonwealth.capitalProvinceId,
    creationKind: 'self_made_foundation',
    creationReason: 'office',
  }
  state = {
    ...state,
    houses: { ...state.houses, [newHouseId]: newHouse },
    nextHouseIndex: nextHouseIndex + 1,
  }

  // person を新 House に所属させる (office/right/influence は personId キーなので維持される)。
  const moved = movePersonToHouse(state, params.petitionerPersonId, newHouseId)
  if (moved.ok) state = moved.value

  // founder を house:leader に。
  state = createOfficeAssignment(
    state,
    { kind: 'house', id: newHouseId },
    'leader',
    params.petitionerPersonId,
  )

  return { ws: state, newHouseId }
}
