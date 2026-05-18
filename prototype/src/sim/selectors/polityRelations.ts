// v0.15 Polity 直交化のための関係 selector 群。
// Stage A 段階では既存型 (Country / CountryId / countryId フィールド) をそのまま参照し、
// Stage B の機械置換で Polity / PolityId / polityId に置き換わる前提で実装する。
// 仕様: docs/drafts/spec-v015-update.md §8, §9
//
// 戻り値型は将来の rename 対象 (Country / CountryId) をそのまま露出する。
// Phase 0 では新たな型 alias を作らず、既存型をそのまま使う。
import type { WorldState } from '@sim/types/world'
import type { Polity } from '@sim/types/polity'
import type { House } from '@sim/types/house'
import type { PolityId, HouseId, PersonId, ProvinceId } from '@sim/types/ids'

// §8.1 — Province → Polity
export function getProvincePolity(state: WorldState, provinceId: ProvinceId): Polity | undefined {
  const province = state.provinces[provinceId]
  if (!province) return undefined
  return state.polities[province.polityId]
}

// §8.1 — Province → owner House
export function getProvinceOwnerHouse(
  state: WorldState,
  provinceId: ProvinceId,
): House | undefined {
  const province = state.provinces[provinceId]
  if (!province) return undefined
  return state.houses[province.ownerHouseId]
}

// §8.2 — Polity 内 Province ids（active / inactive 問わず）
export function getPolityProvinceIds(state: WorldState, polityId: PolityId): ProvinceId[] {
  const result: ProvinceId[] = []
  for (const province of Object.values(state.provinces)) {
    if (!province) continue
    if ((province.polityId as string) === (polityId as string)) {
      result.push(province.id)
    }
  }
  result.sort((a, b) => a.localeCompare(b))
  return result
}

// §8.2 — Polity 内に Province を持つ active House
export function getPolityHouseIds(state: WorldState, polityId: PolityId): HouseId[] {
  const seen = new Set<string>()
  for (const province of Object.values(state.provinces)) {
    if (!province) continue
    if ((province.polityId as string) !== (polityId as string)) continue
    const house = state.houses[province.ownerHouseId]
    if (!house || !house.active) continue
    seen.add(house.id)
  }
  return [...seen].sort((a, b) => a.localeCompare(b)).map((id) => id as HouseId)
}

// §8.2 — Polity に関係する alive Person。複数 Polity に所領を持つ House の人物は重複可
export function getPolityPersonIds(state: WorldState, polityId: PolityId): PersonId[] {
  const houseIds = getPolityHouseIds(state, polityId)
  const result: PersonId[] = []
  for (const houseId of houseIds) {
    const house = state.houses[houseId]
    if (!house) continue
    for (const memberId of house.memberIds) {
      const person = state.persons[memberId]
      if (!person || !person.alive) continue
      result.push(memberId)
    }
  }
  result.sort((a, b) => a.localeCompare(b))
  return result
}

// §8.3 — House が対象 Polity 内に所有する Province 一覧
export function getHouseProvinceIdsByPolity(
  state: WorldState,
  houseId: HouseId,
  polityId: PolityId,
): ProvinceId[] {
  const house = state.houses[houseId]
  if (!house) return []
  const result: ProvinceId[] = []
  for (const pid of house.provinceIds) {
    const province = state.provinces[pid]
    if (!province) continue
    if ((province.polityId as string) === (polityId as string)) {
      result.push(pid)
    }
  }
  result.sort((a, b) => a.localeCompare(b))
  return result
}

// §8.3 — House が Province を所有している active Polity の一覧
export function getHousePolityIds(state: WorldState, houseId: HouseId): PolityId[] {
  const house = state.houses[houseId]
  if (!house || !house.active) return []
  if (house.provinceIds.length === 0) return []
  const seen = new Set<string>()
  for (const pid of house.provinceIds) {
    const province = state.provinces[pid]
    if (!province) continue
    const polity = state.polities[province.polityId]
    if (!polity || !polity.active) continue
    seen.add(province.polityId)
  }
  return [...seen].sort((a, b) => a.localeCompare(b)).map((id) => id as PolityId)
}

// §8.3 — 表示・候補選定用の便宜的 primary Polity
export function getHousePrimaryPolityId(state: WorldState, houseId: HouseId): PolityId | undefined {
  const house = state.houses[houseId]
  if (!house || !house.active) return undefined
  if (house.provinceIds.length === 0) return undefined

  // 1) seatProvinceId の Polity
  const seat = state.provinces[house.seatProvinceId]
  if (seat) {
    const seatPolity = state.polities[seat.polityId]
    if (seatPolity && seatPolity.active) {
      // ただし seat が他家に奪われている場合は house が seat polity 内に Province を持つことを確認
      const ownsInSeatPolity = house.provinceIds.some((pid) => {
        const p = state.provinces[pid]
        return p && (p.polityId as string) === (seat.polityId as string)
      })
      if (ownsInSeatPolity) return seat.polityId
    }
  }

  // 2) 所有 Province 数が最大の Polity
  // 3) 同数なら development 合計が最大
  // 4) それも同じなら PolityId 昇順
  const stats = new Map<
    string,
    { polityId: PolityId; provinceCount: number; development: number }
  >()
  for (const pid of house.provinceIds) {
    const province = state.provinces[pid]
    if (!province) continue
    const polity = state.polities[province.polityId]
    if (!polity || !polity.active) continue
    const key = province.polityId as string
    const cur = stats.get(key)
    if (cur) {
      cur.provinceCount += 1
      cur.development += province.development
    } else {
      stats.set(key, {
        polityId: province.polityId,
        provinceCount: 1,
        development: province.development,
      })
    }
  }
  if (stats.size === 0) return undefined

  const entries = [...stats.values()]
  entries.sort((a, b) => {
    if (b.provinceCount !== a.provinceCount) return b.provinceCount - a.provinceCount
    if (b.development !== a.development) return b.development - a.development
    return a.polityId.localeCompare(b.polityId)
  })
  return entries[0]?.polityId
}

// §8.4 — Person が関係する Polity 一覧（所属 House の getHousePolityIds に委譲）
export function getPersonRelevantPolityIds(state: WorldState, personId: PersonId): PolityId[] {
  const person = state.persons[personId]
  if (!person) return []
  return getHousePolityIds(state, person.houseId)
}

// §8.4 — Person primary Polity（所属 House の getHousePrimaryPolityId に委譲）
export function getPersonPrimaryPolityId(
  state: WorldState,
  personId: PersonId,
): PolityId | undefined {
  const person = state.persons[personId]
  if (!person) return undefined
  return getHousePrimaryPolityId(state, person.houseId)
}

// §9 — House の Polity 内拠点。Polity ごとに動的に選ぶ
export function getHouseSeatProvinceInPolity(
  state: WorldState,
  houseId: HouseId,
  polityId: PolityId,
): ProvinceId | undefined {
  const house = state.houses[houseId]
  if (!house) return undefined

  // 1) seatProvinceId が対象 Polity 内なら、それを返す
  const seat = state.provinces[house.seatProvinceId]
  if (
    seat &&
    (seat.polityId as string) === (polityId as string) &&
    house.provinceIds.some((pid) => (pid as string) === (house.seatProvinceId as string))
  ) {
    return house.seatProvinceId
  }

  // 2) House が対象 Polity 内に持つ Province を集める
  const candidates: ProvinceId[] = []
  for (const pid of house.provinceIds) {
    const province = state.provinces[pid]
    if (!province) continue
    if ((province.polityId as string) === (polityId as string)) {
      candidates.push(pid)
    }
  }
  if (candidates.length === 0) return undefined

  // 3) development が最大の Province
  // 4) 同値なら popGroupIds.length（人口の代理）が最大
  // 5) 同値なら ProvinceId 昇順
  candidates.sort((a, b) => {
    const pa = state.provinces[a]
    const pb = state.provinces[b]
    if (!pa || !pb) return 0
    if (pb.development !== pa.development) return pb.development - pa.development
    if (pb.popGroupIds.length !== pa.popGroupIds.length) {
      return pb.popGroupIds.length - pa.popGroupIds.length
    }
    return a.localeCompare(b)
  })
  return candidates[0]
}
