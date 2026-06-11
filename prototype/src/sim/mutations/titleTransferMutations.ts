import type { WorldState } from '../types/world'
import type { PolityId, HouseId, PersonId } from '../types/ids'
import type { House } from '../types/house'
import { createOfficeAssignment, revokeOfficesByOrganization } from './officeMutations'
import { moveFounderFamilyToHouse } from './personMutations'
import { reassignPolityOwnershipMut } from './polityMutations'
import { addHouseToClan } from './clanMutations'

// v0.47 §11.9: Polity 譲渡による分家創設の成功時 orchestration。
// 宗家の secondary Polity を新設 cadet House に譲り、petitioner を其の leader (title holder) にする。
// 新 Polity は作らない (既存 Polity の ownerHouse 付替)。失敗時 undefined。
export function applyCadetBranchTitleTransferMut(
  ws: WorldState,
  params: {
    petitionerPersonId: PersonId
    parentHouseId: HouseId
    targetPolityId: PolityId
  },
): { ws: WorldState; cadetHouseId: HouseId } | undefined {
  const petitioner = ws.persons[params.petitionerPersonId]
  if (!petitioner) return undefined
  const parentHouse = ws.houses[params.parentHouseId]
  if (!parentHouse) return undefined
  const targetPolity = ws.polities[params.targetPolityId]
  if (!targetPolity) return undefined
  // 譲渡対象は parentHouse が owner であること。
  if (targetPolity.ownerHouseId !== params.parentHouseId) return undefined

  let state = ws
  const nextHouseIndex = state.nextHouseIndex ?? 0
  const cadetHouseId = `dh-${nextHouseIndex}` as HouseId

  // 1. cadet House 作成 (creationReason='polity_grant')。seat は対象 Polity の capital province。
  const cadetHouse: House = {
    id: cadetHouseId,
    nameKey: petitioner.nameKey,
    nameSource: 'person', // founder 個人名由来の家名 (person category で解決)。
    active: true,
    memberIds: [],
    deceasedMemberIds: [],
    founderId: params.petitionerPersonId,
    cadetHouseIds: [],
    legacyPrestige: Math.floor(parentHouse.legacyPrestige * 0.5),
    wealth: 0,
    seatProvinceId: targetPolity.capitalProvinceId,
    creationKind: 'cadet_branch',
    creationReason: 'polity_grant',
    parentHouseId: params.parentHouseId,
    ...(parentHouse.clanId !== undefined && { clanId: parentHouse.clanId }),
  }
  const nextHouses: Record<HouseId, House> = {
    ...state.houses,
    [cadetHouseId]: cadetHouse,
    [params.parentHouseId]: {
      ...parentHouse,
      cadetHouseIds: [...parentHouse.cadetHouseIds, cadetHouseId],
    },
  }
  state = { ...state, houses: nextHouses, nextHouseIndex: nextHouseIndex + 1 }

  // §17 C1: clanId を継承した cadet House は Clan.memberHouseIds にも登録する
  //   (worldStructureSplitHouse と同じ規約。欠落すると clanId 有 ↔ memberHouseIds 不在の C1 違反)。
  if (cadetHouse.clanId !== undefined) {
    state = addHouseToClan(state, cadetHouse.clanId, cadetHouseId)
  }

  // 2. founder + 家族を cadet House へ移す (§10)。
  state = moveFounderFamilyToHouse(state, params.petitionerPersonId, cadetHouseId)

  // 3. targetPolity の ownerHouse を cadet House に付替 (既存 helper 経由・§11.9)。
  state = reassignPolityOwnershipMut(state, params.targetPolityId, cadetHouseId)

  // 4. founder を cadet House leader に。
  state = createOfficeAssignment(
    state,
    { kind: 'house', id: cadetHouseId },
    'leader',
    params.petitionerPersonId,
  )

  // 5. targetPolity の leader を founder (title holder / ruler) に付替。
  state = revokeOfficesByOrganization(
    state,
    { kind: 'polity', id: params.targetPolityId },
    'leader',
  )
  state = createOfficeAssignment(
    state,
    { kind: 'polity', id: params.targetPolityId },
    'leader',
    params.petitionerPersonId,
  )

  return { ws: state, cadetHouseId }
}
