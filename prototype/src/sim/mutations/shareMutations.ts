// v0.42c §4.1: 旧 shareMutations を HouseShare 専用に縮小。
// polity share は全廃 (Polity Influence は influenceSelectors の read-model)。
// holder は Person のみ。index 2 系統 (byHouse / byHolderPerson) の同期はこの層で閉じる。

import type { WorldState } from '@sim/types/world'
import type { HouseShareId, PersonId, HouseId } from '@sim/types/ids'
import { createHouseShareId } from '@sim/types/ids'
import type { HouseShare } from '@sim/types/office'
import type { StateResult } from './result'
import { ok } from './result'

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

export function updateShareRawPower(
  state: WorldState,
  shareId: HouseShareId,
  newRawPower: number,
): WorldState {
  const share = state.houseShares[shareId]
  if (!share) return state
  return {
    ...state,
    houseShares: {
      ...state.houseShares,
      [shareId]: { ...share, rawPower: newRawPower },
    },
  }
}

export function removeHouseShare(state: WorldState, shareId: HouseShareId): WorldState {
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

export function deleteAllSharesForHolderPerson(
  state: WorldState,
  holderPersonId: PersonId,
): WorldState {
  const ids = [...(state.houseShareIndex.byHolderPerson[holderPersonId] ?? [])]
  let current = state
  for (const id of ids) {
    current = removeHouseShare(current, id)
  }
  return current
}

// v0.15 §11.3 / §11.4: House 消滅時に当該 House の全 Share を削除する。
export function removeSharesByHouse(state: WorldState, houseId: HouseId): WorldState {
  const ids = [...(state.houseShareIndex.byHouse[houseId] ?? [])]
  let current = state
  for (const id of ids) {
    current = removeHouseShare(current, id)
  }
  return current
}

export function transferShareRawPower(
  state: WorldState,
  fromPersonId: PersonId,
  toPersonId: PersonId,
  houseId: HouseId,
  ratio: number,
): WorldState {
  const ids = [...(state.houseShareIndex.byHouse[houseId] ?? [])]

  let current = state
  for (const id of ids) {
    const share = current.houseShares[id]
    if (!share) continue
    if (share.holderPersonId !== fromPersonId) continue

    const transferAmount = share.rawPower * ratio
    const remaining = share.rawPower - transferAmount

    if (remaining <= 0) {
      current = removeHouseShare(current, id)
    } else {
      current = updateShareRawPower(current, id, remaining)
    }

    const toIds = current.houseShareIndex.byHouse[houseId] ?? []
    let toShareId: HouseShareId | undefined
    for (const tid of toIds) {
      const ts = current.houseShares[tid]
      if (ts && ts.holderPersonId === toPersonId) {
        toShareId = tid
        break
      }
    }

    if (toShareId) {
      const toShare = current.houseShares[toShareId]
      if (toShare) {
        current = updateShareRawPower(current, toShareId, toShare.rawPower + transferAmount)
      }
    } else {
      current = createHouseShare(current, houseId, toPersonId, transferAmount)
    }
  }

  return current
}

export type UpsertShareInput = {
  houseId: HouseId
  holderPersonId: PersonId
  rawPower: number
}

export function upsertHouseShare(state: WorldState, input: UpsertShareInput): StateResult {
  const ids = state.houseShareIndex.byHouse[input.houseId] ?? []
  let existingId: HouseShareId | undefined
  for (const id of ids) {
    const share = state.houseShares[id]
    if (share && share.holderPersonId === input.holderPersonId) {
      existingId = id
      break
    }
  }

  if (existingId !== undefined) {
    if (input.rawPower <= 0) {
      return ok(removeHouseShare(state, existingId))
    }
    return ok(updateShareRawPower(state, existingId, input.rawPower))
  }

  if (input.rawPower <= 0) return ok(state)
  return ok(createHouseShare(state, input.houseId, input.holderPersonId, input.rawPower))
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
