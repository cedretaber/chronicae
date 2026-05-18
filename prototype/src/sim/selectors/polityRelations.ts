// v0.15 Polity 直交化のための関係 selector 群。
// Stage A 段階では既存型 (Country / CountryId / countryId フィールド) をそのまま参照し、
// Stage B の機械置換で Polity / PolityId / polityId に置き換わる前提で実装する。
// 仕様: docs/drafts/spec-v015-update.md §8, §9
//
// 戻り値型は将来の rename 対象 (Country / CountryId) をそのまま露出する。
// Phase 0 では新たな型 alias を作らず、既存型をそのまま使う。
import type { WorldState } from '@sim/types/world'
import type { Country } from '@sim/types/country'
import type { House } from '@sim/types/house'
import type { CountryId, HouseId, PersonId, ProvinceId } from '@sim/types/ids'

// §8.1 — Province → Polity
export function getProvincePolity(state: WorldState, provinceId: ProvinceId): Country | undefined {
  const province = state.provinces[provinceId]
  if (!province) return undefined
  return state.countries[province.countryId]
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
export function getPolityProvinceIds(state: WorldState, polityId: CountryId): ProvinceId[] {
  const result: ProvinceId[] = []
  for (const province of Object.values(state.provinces)) {
    if (!province) continue
    if ((province.countryId as string) === (polityId as string)) {
      result.push(province.id)
    }
  }
  result.sort((a, b) => a.localeCompare(b))
  return result
}

// §8.2 — Polity 内に Province を持つ active House
export function getPolityHouseIds(state: WorldState, polityId: CountryId): HouseId[] {
  const seen = new Set<string>()
  for (const province of Object.values(state.provinces)) {
    if (!province) continue
    if ((province.countryId as string) !== (polityId as string)) continue
    const house = state.houses[province.ownerHouseId]
    if (!house || !house.active) continue
    seen.add(house.id)
  }
  return [...seen].sort((a, b) => a.localeCompare(b)).map((id) => id as HouseId)
}

// §8.2 — Polity に関係する alive Person。複数 Polity に所領を持つ House の人物は重複可
export function getPolityPersonIds(state: WorldState, polityId: CountryId): PersonId[] {
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
  polityId: CountryId,
): ProvinceId[] {
  const house = state.houses[houseId]
  if (!house) return []
  const result: ProvinceId[] = []
  for (const pid of house.provinceIds) {
    const province = state.provinces[pid]
    if (!province) continue
    if ((province.countryId as string) === (polityId as string)) {
      result.push(pid)
    }
  }
  result.sort((a, b) => a.localeCompare(b))
  return result
}

// §8.3 — House が Province を所有している active Polity の一覧
export function getHousePolityIds(state: WorldState, houseId: HouseId): CountryId[] {
  const house = state.houses[houseId]
  if (!house || !house.active) return []
  if (house.provinceIds.length === 0) return []
  const seen = new Set<string>()
  for (const pid of house.provinceIds) {
    const province = state.provinces[pid]
    if (!province) continue
    const country = state.countries[province.countryId]
    if (!country || !country.active) continue
    seen.add(province.countryId)
  }
  return [...seen].sort((a, b) => a.localeCompare(b)).map((id) => id as CountryId)
}

// §8.3 — 表示・候補選定用の便宜的 primary Polity
export function getHousePrimaryPolityId(
  state: WorldState,
  houseId: HouseId,
): CountryId | undefined {
  const house = state.houses[houseId]
  if (!house || !house.active) return undefined
  if (house.provinceIds.length === 0) return undefined

  // 1) seatProvinceId の Polity
  const seat = state.provinces[house.seatProvinceId]
  if (seat) {
    const seatCountry = state.countries[seat.countryId]
    if (seatCountry && seatCountry.active) {
      // ただし seat が他家に奪われている場合は house が seat polity 内に Province を持つことを確認
      const ownsInSeatPolity = house.provinceIds.some((pid) => {
        const p = state.provinces[pid]
        return p && (p.countryId as string) === (seat.countryId as string)
      })
      if (ownsInSeatPolity) return seat.countryId
    }
  }

  // 2) 所有 Province 数が最大の Polity
  // 3) 同数なら development 合計が最大
  // 4) それも同じなら PolityId 昇順
  const stats = new Map<
    string,
    { polityId: CountryId; provinceCount: number; development: number }
  >()
  for (const pid of house.provinceIds) {
    const province = state.provinces[pid]
    if (!province) continue
    const country = state.countries[province.countryId]
    if (!country || !country.active) continue
    const key = province.countryId as string
    const cur = stats.get(key)
    if (cur) {
      cur.provinceCount += 1
      cur.development += province.development
    } else {
      stats.set(key, {
        polityId: province.countryId,
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
export function getPersonRelevantPolityIds(state: WorldState, personId: PersonId): CountryId[] {
  const person = state.persons[personId]
  if (!person) return []
  return getHousePolityIds(state, person.houseId)
}

// §8.4 — Person primary Polity（所属 House の getHousePrimaryPolityId に委譲）
export function getPersonPrimaryPolityId(
  state: WorldState,
  personId: PersonId,
): CountryId | undefined {
  const person = state.persons[personId]
  if (!person) return undefined
  return getHousePrimaryPolityId(state, person.houseId)
}

// §9 — House の Polity 内拠点。Polity ごとに動的に選ぶ
export function getHouseSeatProvinceInPolity(
  state: WorldState,
  houseId: HouseId,
  polityId: CountryId,
): ProvinceId | undefined {
  const house = state.houses[houseId]
  if (!house) return undefined

  // 1) seatProvinceId が対象 Polity 内なら、それを返す
  const seat = state.provinces[house.seatProvinceId]
  if (
    seat &&
    (seat.countryId as string) === (polityId as string) &&
    house.provinceIds.some((pid) => (pid as string) === (house.seatProvinceId as string))
  ) {
    return house.seatProvinceId
  }

  // 2) House が対象 Polity 内に持つ Province を集める
  const candidates: ProvinceId[] = []
  for (const pid of house.provinceIds) {
    const province = state.provinces[pid]
    if (!province) continue
    if ((province.countryId as string) === (polityId as string)) {
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
