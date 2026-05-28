import type { WorldState } from '@sim/types/world'
import type { OrganizationShareId, PersonId, HouseId } from '@sim/types/ids'
import type { OrganizationRef, ShareHolderRef } from '@sim/types/office'
import { createOrganizationShareId } from '@sim/types/ids'
import type { StateResult } from './result'
import { ok } from './result'

function orgKey(org: OrganizationRef): string {
  return `${org.kind}:${org.id}`
}

function holderKey(holder: ShareHolderRef): string {
  return `${holder.kind}:${holder.id}`
}

export function createOrganizationShare(
  state: WorldState,
  organization: OrganizationRef,
  holder: ShareHolderRef,
  rawPower: number,
): WorldState {
  const id = createOrganizationShareId(state.nextOrganizationShareId)
  const newShare = { id, organization, holder, rawPower }

  const orgKeyStr = orgKey(organization)
  const hKeyStr = holderKey(holder)

  const existingByOrg = state.shareIndex.byOrganization[orgKeyStr] ?? []
  const existingByHolder = state.shareIndex.byHolder[hKeyStr] ?? []

  return {
    ...state,
    nextOrganizationShareId: state.nextOrganizationShareId + 1,
    organizationShares: {
      ...state.organizationShares,
      [id]: newShare,
    },
    shareIndex: {
      byOrganization: {
        ...state.shareIndex.byOrganization,
        [orgKeyStr]: [...existingByOrg, id],
      },
      byHolder: {
        ...state.shareIndex.byHolder,
        [hKeyStr]: [...existingByHolder, id],
      },
    },
  }
}

export function updateShareRawPower(
  state: WorldState,
  shareId: OrganizationShareId,
  newRawPower: number,
): WorldState {
  const share = state.organizationShares[shareId]
  if (!share) return state
  return {
    ...state,
    organizationShares: {
      ...state.organizationShares,
      [shareId]: { ...share, rawPower: newRawPower },
    },
  }
}

export function removeOrganizationShare(
  state: WorldState,
  shareId: OrganizationShareId,
): WorldState {
  const share = state.organizationShares[shareId]
  if (!share) return state

  const orgKeyStr = orgKey(share.organization)
  const hKeyStr = holderKey(share.holder)

  const newShares = { ...state.organizationShares }
  delete newShares[shareId]

  return {
    ...state,
    organizationShares: newShares,
    shareIndex: {
      byOrganization: {
        ...state.shareIndex.byOrganization,
        [orgKeyStr]: (state.shareIndex.byOrganization[orgKeyStr] ?? []).filter(
          (id) => id !== shareId,
        ),
      },
      byHolder: {
        ...state.shareIndex.byHolder,
        [hKeyStr]: (state.shareIndex.byHolder[hKeyStr] ?? []).filter((id) => id !== shareId),
      },
    },
  }
}

export function deleteAllSharesForHolder(state: WorldState, holder: ShareHolderRef): WorldState {
  const hKeyStr = holderKey(holder)
  const ids = state.shareIndex.byHolder[hKeyStr] ?? []
  let current = state
  for (const id of ids) {
    current = removeOrganizationShare(current, id)
  }
  return current
}

// v0.15 §11.3 / §11.4: Polity 消滅時に当該 organization の全 Share を削除する。
export function removeSharesByOrganization(
  state: WorldState,
  organization: { kind: 'polity' | 'house'; id: string },
): WorldState {
  const orgKeyStr = `${organization.kind}:${organization.id}`
  const ids = state.shareIndex.byOrganization[orgKeyStr] ?? []
  let current = state
  for (const id of ids) {
    current = removeOrganizationShare(current, id)
  }
  return current
}

export function transferShareRawPower(
  state: WorldState,
  fromHolder: ShareHolderRef,
  toHolder: ShareHolderRef,
  organization: OrganizationRef,
  ratio: number,
): WorldState {
  const orgKeyStr = orgKey(organization)
  const fromHKeyStr = holderKey(fromHolder)
  const ids = [...(state.shareIndex.byOrganization[orgKeyStr] ?? [])]

  let current = state
  for (const id of ids) {
    const share = current.organizationShares[id]
    if (!share) continue
    if (holderKey(share.holder) !== fromHKeyStr) continue

    const transferAmount = share.rawPower * ratio
    const remaining = share.rawPower - transferAmount

    if (remaining <= 0) {
      current = removeOrganizationShare(current, id)
    } else {
      current = updateShareRawPower(current, id, remaining)
    }

    const toHKeyStr = holderKey(toHolder)
    const toIds = current.shareIndex.byOrganization[orgKeyStr] ?? []
    let toShareId: OrganizationShareId | undefined
    for (const tid of toIds) {
      const ts = current.organizationShares[tid]
      if (ts && holderKey(ts.holder) === toHKeyStr) {
        toShareId = tid
        break
      }
    }

    if (toShareId) {
      const toShare = current.organizationShares[toShareId]
      if (toShare) {
        current = updateShareRawPower(current, toShareId, toShare.rawPower + transferAmount)
      }
    } else {
      current = createOrganizationShare(current, organization, toHolder, transferAmount)
    }
  }

  return current
}

export type UpsertShareInput = {
  organization: OrganizationRef
  holder: ShareHolderRef
  rawPower: number
}

export function upsertOrganizationShare(state: WorldState, input: UpsertShareInput): StateResult {
  const orgKeyStr = orgKey(input.organization)
  const hKeyStr = holderKey(input.holder)

  const ids = state.shareIndex.byOrganization[orgKeyStr] ?? []
  let existingId: OrganizationShareId | undefined
  for (const id of ids) {
    const share = state.organizationShares[id]
    if (share && holderKey(share.holder) === hKeyStr) {
      existingId = id
      break
    }
  }

  if (existingId !== undefined) {
    if (input.rawPower <= 0) {
      return ok(removeOrganizationShare(state, existingId))
    }
    return ok(updateShareRawPower(state, existingId, input.rawPower))
  }

  if (input.rawPower <= 0) return ok(state)
  return ok(createOrganizationShare(state, input.organization, input.holder, input.rawPower))
}

export function removePersonSharesInHouse(
  state: WorldState,
  personId: PersonId,
  houseId: HouseId,
): WorldState {
  const holderKeyStr = `person:${personId}`
  const ids = [...(state.shareIndex.byHolder[holderKeyStr] ?? [])]
  let current = state
  for (const id of ids) {
    const share = current.organizationShares[id]
    if (!share) continue
    if (share.organization.kind === 'house' && share.organization.id === houseId) {
      current = removeOrganizationShare(current, id)
    }
  }
  return current
}
