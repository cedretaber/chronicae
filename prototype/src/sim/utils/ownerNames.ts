import type { WorldState } from '../types/world'
import type { DecisionSubjectRef } from '../types/goal'
import {
  getHouseNameRefForEmit,
  getPolityNameRefForEmit,
  type SimNameRef,
} from '../selectors/nameRefSelectors'

/**
 * DecisionSubjectRef (polity / house / person) を nameKey に解決する (調査 §3.4)。
 * 解決できない場合は owner.id (locale 中立な識別子) をフォールバックとして返す。
 * 旧来は 7 つの tick system にほぼ同一実装が重複していた。
 *
 * 注意: これは category 非依存の代表 nameKey (entityRef スナップショット等) 用。
 * nameParam で emit する場合は category も必要なので getOwnerNameRefForEmit を使うこと
 * (holding 由来 Polity は category が 'polity' でなく 'province'/'city' になる)。
 */
export function getOwnerNameKey(state: WorldState, owner: DecisionSubjectRef): string {
  if (owner.kind === 'polity') return getPolityNameRefForEmit(state, owner.id).nameKey
  if (owner.kind === 'house') return state.houses[owner.id]?.nameKey ?? owner.id
  return state.persons[owner.id]?.nameKey ?? owner.id
}

/**
 * v0.41 (§7.2): DecisionSubjectRef を nameSource-aware な (category, nameKey) に解決する。
 * nameParam emit に使う。Polity は holding 由来名のとき category が切り替わる。
 */
export function getOwnerNameRefForEmit(state: WorldState, owner: DecisionSubjectRef): SimNameRef {
  if (owner.kind === 'polity') return getPolityNameRefForEmit(state, owner.id)
  if (owner.kind === 'house') return getHouseNameRefForEmit(state, owner.id)
  return { category: 'person', nameKey: state.persons[owner.id]?.nameKey ?? owner.id }
}
