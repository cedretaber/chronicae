// v0.51 InfluenceModifierConsistencySystem — InfluenceModifier の期限切れ・drift 回収 (陰謀リファイン §2.4)。
//
// 回収対象:
//   - 期限切れ (absoluteWeek >= expiryWeek)
//   - target 消滅 (house inactive/絶家 / person 死亡)
//   - polity inactive
//
// influenceSelectors は期限切れ・target 消滅 modifier を計算時点で寄与 0 として無視するため、
// 本 system は「state を実際に掃除して肥大化を防ぐ」役割 (rightConsistencySystem と同型)。
// 回収は silent (イベントなし — 一時的な修正項の自然消滅であり報告対象でない)。
//
// interval: 1 (weekly)。年末 integrity tick (absoluteWeek ≡ 47 mod 48) は interval 4 系の実行週に
// 当たらないため、target/polity liveness を年末 integrity が検査するには weekly で毎 tick
// 掃除する必要がある (rightConsistencySystem と同じ理由)。

import type { TickContext } from './context'
import type { InfluenceModifierId } from '../types/ids'
import type { WorldState } from '../types/world'
import { removeInfluenceModifier } from '../mutations/influenceModifierMutations'

// modifier が回収対象かを判定する。整合していれば false。
function isStaleModifier(state: WorldState, id: InfluenceModifierId): boolean {
  const mod = state.influenceModifiers[id]
  if (!mod) return false
  if (mod.expiryWeek !== undefined && state.absoluteWeek >= mod.expiryWeek) return true
  const polity = state.polities[mod.polityId]
  if (!polity || !polity.active) return true
  if (mod.target.kind === 'person') {
    const person = state.persons[mod.target.id]
    if (!person || !person.alive || person.kind === 'placeholder') return true
  } else {
    const house = state.houses[mod.target.id]
    if (!house || !house.active) return true
  }
  return false
}

export function runInfluenceModifierConsistencySystem(ctx: TickContext): TickContext {
  const ids = Object.keys(ctx.state.influenceModifiers).sort() as InfluenceModifierId[]
  if (ids.length === 0) return ctx

  let state = ctx.state
  let removed = false
  for (const id of ids) {
    if (!isStaleModifier(state, id)) continue
    state = removeInfluenceModifier(state, id)
    removed = true
  }
  if (!removed) return ctx
  return { ...ctx, state }
}
