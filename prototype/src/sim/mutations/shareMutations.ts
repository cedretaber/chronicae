// v0.42c §4.1: 旧 shareMutations を HouseShare 専用に縮小。
// polity share は全廃 (Polity Influence は influenceSelectors の read-model)。
// holder は Person のみ。index 2 系統 (byHouse / byHolderPerson) の同期はこの層で閉じる。

import type { WorldState } from '@sim/types/world'
import type { HouseShareId, PersonId, HouseId } from '@sim/types/ids'
import { createHouseShareId } from '@sim/types/ids'
import type { HouseShare } from '@sim/types/office'

export function createHouseShare(
  state: WorldState,
  houseId: HouseId,
  holderPersonId: PersonId,
  rawPower: number,
): WorldState {
  const id = createHouseShareId(state.nextHouseShareId)
  const newShare: HouseShare = { id, houseId, holderPersonId, rawPower }

  const existingByHouse = state.houseShareIndex.byHouse[houseId] ?? []
  const existingByHolder = state.houseShareIndex.byHolderPerson[holderPersonId] ?? []

  return {
    ...state,
    nextHouseShareId: state.nextHouseShareId + 1,
    houseShares: {
      ...state.houseShares,
      [id]: newShare,
    },
    houseShareIndex: {
      byHouse: {
        ...state.houseShareIndex.byHouse,
        [houseId]: [...existingByHouse, id],
      },
      byHolderPerson: {
        ...state.houseShareIndex.byHolderPerson,
        [holderPersonId]: [...existingByHolder, id],
      },
    },
  }
}

function removeHouseShare(state: WorldState, shareId: HouseShareId): WorldState {
  const share = state.houseShares[shareId]
  if (!share) return state

  const newShares = { ...state.houseShares }
  delete newShares[shareId]

  return {
    ...state,
    houseShares: newShares,
    houseShareIndex: {
      byHouse: {
        ...state.houseShareIndex.byHouse,
        [share.houseId]: (state.houseShareIndex.byHouse[share.houseId] ?? []).filter(
          (id) => id !== shareId,
        ),
      },
      byHolderPerson: {
        ...state.houseShareIndex.byHolderPerson,
        [share.holderPersonId]: (
          state.houseShareIndex.byHolderPerson[share.holderPersonId] ?? []
        ).filter((id) => id !== shareId),
      },
    },
  }
}

export function removePersonSharesInHouse(
  state: WorldState,
  personId: PersonId,
  houseId: HouseId,
): WorldState {
  const ids = [...(state.houseShareIndex.byHolderPerson[personId] ?? [])]
  let current = state
  for (const id of ids) {
    const share = current.houseShares[id]
    if (!share) continue
    if (share.houseId === houseId) {
      current = removeHouseShare(current, id)
    }
  }
  return current
}
