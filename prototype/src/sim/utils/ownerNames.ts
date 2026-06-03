import type { WorldState } from '../types/world'
import type { DecisionSubjectRef } from '../types/goal'

/**
 * DecisionSubjectRef (polity / house / person) を nameKey に解決する (調査 §3.4)。
 * 解決できない場合は owner.id (locale 中立な識別子) をフォールバックとして返す。
 * 旧来は 7 つの tick system にほぼ同一実装が重複していた。
 */
export function getOwnerNameKey(state: WorldState, owner: DecisionSubjectRef): string {
  if (owner.kind === 'polity') return state.polities[owner.id]?.nameKey ?? owner.id
  if (owner.kind === 'house') return state.houses[owner.id]?.nameKey ?? owner.id
  return state.persons[owner.id]?.nameKey ?? owner.id
}
