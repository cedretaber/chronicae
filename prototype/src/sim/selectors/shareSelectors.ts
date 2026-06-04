// v0.42c §4.1: HouseShare 専用の selector に縮小。
// 旧 getHousePolitySharePercent / getDominantPolityHouse / getSharePercent (polity 系) は
// polity share 全廃に伴い削除 — 置換先は influenceSelectors。

import type { WorldState } from '@sim/types/world'
import type { HouseId, PersonId } from '@sim/types/ids'
import type { HouseShare } from '@sim/types/office'

export function getHouseShares(state: WorldState, houseId: HouseId): HouseShare[] {
  const ids = state.houseShareIndex.byHouse[houseId] ?? []
  return ids.flatMap((id) => {
    const share = state.houseShares[id]
    return share ? [share] : []
  })
}

export function getHouseTotalRawPower(state: WorldState, houseId: HouseId): number {
  const shares = getHouseShares(state, houseId)
  const total = shares.reduce((sum, s) => sum + s.rawPower, 0)
  return total <= 0 ? 0 : total
}

// 0〜100 (§5.5 と同スケール)
export function getPersonHouseSharePercent(
  state: WorldState,
  houseId: HouseId,
  personId: PersonId,
): number {
  const total = getHouseTotalRawPower(state, houseId)
  if (total <= 0) return 0
  let holderPower = 0
  for (const share of getHouseShares(state, houseId)) {
    if (share.holderPersonId === personId) holderPower += share.rawPower
  }
  return (holderPower / total) * 100
}

export function getTopShareholders(
  state: WorldState,
  houseId: HouseId,
  limit = 5,
): Array<{ holderPersonId: PersonId; rawPower: number; percent: number }> {
  const total = getHouseTotalRawPower(state, houseId)
  const shares = getHouseShares(state, houseId)
  const byHolder = new Map<PersonId, number>()
  for (const share of shares) {
    byHolder.set(share.holderPersonId, (byHolder.get(share.holderPersonId) ?? 0) + share.rawPower)
  }
  return [...byHolder.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([holderPersonId, rawPower]) => ({
      holderPersonId,
      rawPower,
      percent: total > 0 ? (rawPower / total) * 100 : 0,
    }))
}

export function getDominantHouseMember(state: WorldState, houseId: HouseId): PersonId | undefined {
  return getTopShareholders(state, houseId, 1)[0]?.holderPersonId
}
