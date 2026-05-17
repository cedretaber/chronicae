import type { WorldState } from '@sim/types/world'
import type { CountryId, HouseId, PersonId } from '@sim/types/ids'
import type { OrganizationRef, ShareHolderRef, OrganizationShare } from '@sim/types/office'

function orgKey(org: OrganizationRef): string {
  return `${org.kind}:${org.id}`
}

function holderKey(holder: ShareHolderRef): string {
  return `${holder.kind}:${holder.id}`
}

export function getOrganizationShares(
  state: WorldState,
  organization: OrganizationRef,
): OrganizationShare[] {
  const key = orgKey(organization)
  const ids = state.shareIndex.byOrganization[key] ?? []
  return ids.flatMap((id) => {
    const share = state.organizationShares[id]
    return share ? [share] : []
  })
}

export function getTotalRawPower(state: WorldState, organization: OrganizationRef): number {
  const shares = getOrganizationShares(state, organization)
  const total = shares.reduce((sum, s) => sum + s.rawPower, 0)
  return total <= 0 ? 0 : total
}

export function getSharePercent(
  state: WorldState,
  organization: OrganizationRef,
  holder: ShareHolderRef,
): number {
  const total = getTotalRawPower(state, organization)
  if (total <= 0) return 0
  const key = orgKey(organization)
  const hKey = holderKey(holder)
  const ids = state.shareIndex.byOrganization[key] ?? []
  let holderPower = 0
  for (const id of ids) {
    const share = state.organizationShares[id]
    if (!share) continue
    if (holderKey(share.holder) === hKey) {
      holderPower += share.rawPower
    }
  }
  return (holderPower / total) * 100
}

export function getTopShareholders(
  state: WorldState,
  organization: OrganizationRef,
  limit = 5,
): Array<{ holder: ShareHolderRef; rawPower: number; percent: number }> {
  const total = getTotalRawPower(state, organization)
  const shares = getOrganizationShares(state, organization)
  const byHolder = new Map<string, { holder: ShareHolderRef; rawPower: number }>()
  for (const share of shares) {
    const key = holderKey(share.holder)
    const existing = byHolder.get(key)
    if (existing) {
      existing.rawPower += share.rawPower
    } else {
      byHolder.set(key, { holder: share.holder, rawPower: share.rawPower })
    }
  }
  return [...byHolder.values()]
    .sort((a, b) => b.rawPower - a.rawPower)
    .slice(0, limit)
    .map(({ holder, rawPower }) => ({
      holder,
      rawPower,
      percent: total > 0 ? (rawPower / total) * 100 : 0,
    }))
}

export function getHouseCountrySharePercent(
  state: WorldState,
  countryId: CountryId,
  houseId: HouseId,
): number {
  return getSharePercent(state, { kind: 'country', id: countryId }, { kind: 'house', id: houseId })
}

export function getDominantCountryHouse(
  state: WorldState,
  countryId: CountryId,
): HouseId | undefined {
  const top = getTopShareholders(state, { kind: 'country', id: countryId }, 1)
  const first = top[0]
  if (!first) return undefined
  if (first.holder.kind === 'house') return first.holder.id
  return undefined
}

export function getPersonHouseSharePercent(
  state: WorldState,
  houseId: HouseId,
  personId: PersonId,
): number {
  return getSharePercent(state, { kind: 'house', id: houseId }, { kind: 'person', id: personId })
}

export function getDominantHouseMember(state: WorldState, houseId: HouseId): PersonId | undefined {
  const top = getTopShareholders(state, { kind: 'house', id: houseId }, 1)
  const first = top[0]
  if (!first) return undefined
  if (first.holder.kind === 'person') return first.holder.id
  return undefined
}
