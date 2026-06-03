import type { WorldState } from '../types/world'
import type { HoldingId, PolityId } from '../types/ids'
import type { Polity } from '../types/polity'

/**
 * v0.41 (§7.2): sim 層の emit helper。イベント emit 経路で `(category, nameKey)` を
 * nameSource-aware に導出する純粋 helper。i18n には依存せず、category 文字列と nameKey の
 * ペアを返すだけ。実際の表示文字列解決 (locale 依存) は app / i18n 層の責務。
 */
export type SimNameRef = {
  category: string
  nameKey: string
}

/**
 * Holding の (category, nameKey) を返す。解決カテゴリは Holding.kind で決まる:
 * manor -> 'province' / city -> 'city'。Holding 不在時は id を nameKey とする安全値。
 */
export function getHoldingNameRefForEmit(state: WorldState, holdingId: HoldingId): SimNameRef {
  const holding = state.holdings[holdingId]
  if (!holding) {
    return { category: 'province', nameKey: holdingId }
  }
  switch (holding.kind) {
    case 'city':
      return { category: 'city', nameKey: holding.nameKey }
    case 'manor':
      return { category: 'province', nameKey: holding.nameKey }
  }
}

/**
 * Polity の (category, nameKey) を nameSource に応じて返す。
 * pool -> ('polity', nameKey) / holding -> Holding の ref を借りる。
 * Polity 不在時は id を nameKey とする安全値 (呼び出し側の `?? id` を helper 内に集約)。
 */
export function getPolityNameRefForEmit(state: WorldState, polityId: PolityId): SimNameRef {
  const polity = state.polities[polityId]
  if (!polity) {
    return { category: 'polity', nameKey: polityId }
  }
  return getPolityNameRefForEmitFromPolity(state, polity)
}

/** Polity オブジェクトを直接受け取る版 (lookup 済みの呼び出し向け)。 */
export function getPolityNameRefForEmitFromPolity(state: WorldState, polity: Polity): SimNameRef {
  switch (polity.nameSource.kind) {
    case 'pool':
      return { category: 'polity', nameKey: polity.nameSource.nameKey }
    case 'holding':
      return getHoldingNameRefForEmit(state, polity.nameSource.holdingId)
  }
}

/**
 * category 非依存な文脈 (entityRef の nameKey スナップショット / debug summary 文字列 /
 * pool used-set 構築) 用に、代表 nameKey 文字列だけを返す薄い accessor。
 * category-sensitive な emit (nameParam) には使わず getPolityNameRefForEmit を使うこと。
 */
export function getPolityEmitNameKey(state: WorldState, polityId: PolityId): string {
  return getPolityNameRefForEmit(state, polityId).nameKey
}
