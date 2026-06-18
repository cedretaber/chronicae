import type { WorldState } from '@sim/types/world'
import type { HoldingId, PolityId, ProvinceId } from '@sim/types/ids'
import type { House } from '@sim/types/house'

/**
 * v0.41 (§7.3-7.5): app 層の nameSource-aware 表示 helper。
 *
 * sim 層 (`sim/ → i18n/` 禁止) には置けないため app 層に置く。`resolveName` は
 * `useEntityName()` が返す `(category, nameKey, fallback) => string`。
 *
 * 禁止: holding 由来名を `resolveName('polity', holdingNameKey)` で解決すること
 * (翻訳が `polity` category に無く raw key 表示になる)。必ず Holding.kind に応じて
 * `province` / `city` category で解決する。
 */
export type ResolveName = (
  category: string,
  nameKey: string | undefined,
  fallback: string,
) => string

type MaybeState = WorldState | null | undefined

/**
 * House 短名 (v0.47)。家名 nameKey の出所 (nameSource) に応じて category を切り替える:
 * 'person' (founder 個人名由来 = 共和国 House) -> 'person' category /
 * { kind: 'polity', category } (分封・分家 = 領国名 snapshot) -> その領国名 category /
 * それ以外 (house プール由来) -> 'house' category。
 *
 * 禁止: 個人名・領国名由来の家名を `resolveName('house', house.nameKey)` で解決すること
 * (house.yaml に該当キーが無く raw key 表示になる)。必ずこの helper を通す。
 * house が undefined のときは fallback をそのまま返す。
 */
export function getHouseDisplayName(
  resolveName: ResolveName,
  house: House | undefined,
  fallback: string,
): string {
  if (!house) return fallback
  const ns = house.nameSource
  const category =
    ns === 'person'
      ? 'person'
      : typeof ns === 'object' && ns.kind === 'polity'
        ? ns.category
        : 'house'
  return resolveName(category, house.nameKey, house.nameKey)
}

/** Province 短名。province が無ければ id を返す。 */
export function getProvinceShortName(
  state: MaybeState,
  resolveName: ResolveName,
  provinceId: ProvinceId,
): string {
  const province = state?.provinces[provinceId]
  if (!province) return provinceId
  return resolveName('province', province.nameKey, province.nameKey)
}

/** Holding 短名。manor -> province category / city -> city category。 */
export function getHoldingShortName(
  state: MaybeState,
  resolveName: ResolveName,
  holdingId: HoldingId,
): string {
  const holding = state?.holdings[holdingId]
  if (!holding) return holdingId
  switch (holding.kind) {
    case 'manor':
      return resolveName('province', holding.nameKey, holding.nameKey)
    case 'city':
      return resolveName('city', holding.nameKey, holding.nameKey)
  }
}

/**
 * Holding 完全名 = Province 名 + Holding 名。語順・接続表現は locale 側で扱うべきだが、
 * v0.41 では最小実装として "<Holding> (<Province>)" 形式で連結する。
 */
export function getHoldingQualifiedName(
  state: MaybeState,
  resolveName: ResolveName,
  holdingId: HoldingId,
): string {
  const holding = state?.holdings[holdingId]
  if (!holding) return holdingId
  const short = getHoldingShortName(state, resolveName, holdingId)
  const province = state.provinces[holding.provinceId]
  if (!province) return short
  const provinceName = resolveName('province', province.nameKey, province.nameKey)
  if (provinceName === short) return short
  return `${short} (${provinceName})`
}

/** Polity 短名。pool -> polity category / holding -> Holding 短名を借りる。 */
export function getPolityShortName(
  state: MaybeState,
  resolveName: ResolveName,
  polityId: PolityId,
): string {
  const polity = state?.polities[polityId]
  if (!polity) return polityId
  switch (polity.nameSource.kind) {
    case 'pool':
      return resolveName('polity', polity.nameSource.nameKey, polity.nameSource.nameKey)
    case 'holding':
      return getHoldingShortName(state, resolveName, polity.nameSource.holdingId)
  }
}
