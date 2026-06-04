import { describe, expect, it } from 'vitest'
import { createProvinceId, createHoldingId, createPolityId } from '../types/ids'
import type { EntityRef } from '../types/goal'
import { aimSlotKey } from './goalSelectors'

// v0.43 Aim 並列化: aimSlotKey は「生成側の候補除外」と「integrity の重複検査」が共有する
// 唯一のキー。両者が同じ (kind, target) に対して同じ文字列を返すこと、および異なる対象が
// 衝突しないことが、並列 Aim の正しさ (同一対象の二重 Aim 禁止) を担保する。
describe('aimSlotKey', () => {
  it('target ありは kind と target の両方でキーが分かれる', () => {
    const provA: EntityRef = { kind: 'province', id: createProvinceId(1) }
    const provB: EntityRef = { kind: 'province', id: createProvinceId(2) }
    // 同 kind・別 target → 別スロット (別々の province を並列に対象にできる)
    expect(aimSlotKey('develop_owned_holding', provA)).not.toBe(
      aimSlotKey('develop_owned_holding', provB),
    )
  })

  it('同 kind・同 target は同一キー (= 二重 Aim を弾く根拠)', () => {
    const holding: EntityRef = { kind: 'holding', id: createHoldingId(7) }
    expect(aimSlotKey('develop_owned_holding', holding)).toBe(
      aimSlotKey('develop_owned_holding', holding),
    )
  })

  it('同 target でも kind が違えば別スロット', () => {
    const polity: EntityRef = { kind: 'polity', id: createPolityId(3) }
    expect(aimSlotKey('increase_polity_share', polity)).not.toBe(
      aimSlotKey('steer_polity_external_expansion', polity),
    )
  })

  it('target なし (例: patronize_artist) は kind のみがキー', () => {
    expect(aimSlotKey('patronize_artist')).toBe('patronize_artist')
    // target なし同士は同 kind なら衝突 → house は同種 prestige Aim を 2 つ並列に持てない
    expect(aimSlotKey('patronize_artist')).toBe(aimSlotKey('patronize_artist'))
    expect(aimSlotKey('patronize_artist')).not.toBe(aimSlotKey('commission_chronicle'))
  })

  it('target あり vs なしは衝突しない', () => {
    const polity: EntityRef = { kind: 'polity', id: createPolityId(5) }
    expect(aimSlotKey('increase_polity_share', polity)).not.toBe(
      aimSlotKey('increase_polity_share'),
    )
  })
})
