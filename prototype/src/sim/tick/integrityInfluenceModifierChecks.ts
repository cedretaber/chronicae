// v0.51 InfluenceModifier の integrity checks (陰謀リファイン §2.4)。
//
// liveness (target / polity) は influenceModifierConsistencySystem (weekly) が毎 tick 掃除する
// ため、年末 integrity 時点では常に成立する (rightConsistencySystem と同型)。
// index 2 系統 (byPolity / byTarget) は mutation 層でのみ更新されるため常時成立すべき構造 invariant。
// 期限切れ (expiryWeek 超過) は consistency が同 tick で消すため violation にしない。

import type { InfluenceModifierId } from '../types/ids'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import { influenceModifierTargetKey } from '../types/influenceModifier'

export function checkInfluenceModifiers(state: WorldState, errors: SimError[]): void {
  for (const idStr of Object.keys(state.influenceModifiers)) {
    const id = idStr as InfluenceModifierId
    const mod = state.influenceModifiers[id]
    if (!mod) continue

    // target は存在し有効 (person: alive かつ normal / house: active)
    if (mod.target.kind === 'person') {
      const person = state.persons[mod.target.id]
      if (!person || !person.alive || person.kind === 'placeholder') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `InfluenceModifier ${id} person target ${mod.target.id} is not alive / normal (v0.51)`,
        })
      }
    } else {
      const house = state.houses[mod.target.id]
      if (!house || !house.active) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `InfluenceModifier ${id} house target ${mod.target.id} is not active (v0.51)`,
        })
      }
    }

    // polityId は active Polity
    const polity = state.polities[mod.polityId]
    if (!polity || !polity.active) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `InfluenceModifier ${id} polity ${mod.polityId} is not active (v0.51)`,
      })
    }

    // index (modifier → index 方向): 2 index すべてに登録されていること
    const targetKey = influenceModifierTargetKey(mod.target)
    if (!(state.influenceModifierIndex.byPolity[mod.polityId] ?? []).includes(id)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `InfluenceModifier ${id} missing from influenceModifierIndex.byPolity[${mod.polityId}] (v0.51)`,
      })
    }
    if (!(state.influenceModifierIndex.byTarget[targetKey] ?? []).includes(id)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `InfluenceModifier ${id} missing from influenceModifierIndex.byTarget[${targetKey}] (v0.51)`,
      })
    }
  }

  // index → modifier 方向: index の全 entry が実在の modifier を指し、キーが一致すること
  for (const [polityKey, ids] of Object.entries(state.influenceModifierIndex.byPolity)) {
    for (const id of ids ?? []) {
      const mod = state.influenceModifiers[id]
      if (!mod) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `influenceModifierIndex.byPolity[${polityKey}] references missing modifier ${id} (v0.51)`,
        })
      } else if ((mod.polityId as string) !== polityKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `influenceModifierIndex.byPolity[${polityKey}] entry ${id} has polityId=${mod.polityId} (v0.51)`,
        })
      }
    }
  }
  for (const [targetKey, ids] of Object.entries(state.influenceModifierIndex.byTarget)) {
    for (const id of ids ?? []) {
      const mod = state.influenceModifiers[id]
      if (!mod) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `influenceModifierIndex.byTarget[${targetKey}] references missing modifier ${id} (v0.51)`,
        })
      } else if (influenceModifierTargetKey(mod.target) !== targetKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `influenceModifierIndex.byTarget[${targetKey}] entry ${id} has target=${influenceModifierTargetKey(mod.target)} (v0.51)`,
        })
      }
    }
  }
}
