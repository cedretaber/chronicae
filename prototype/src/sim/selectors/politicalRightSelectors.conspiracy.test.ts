// v0.51 陰謀リファイン §3.3: findRevocableRightTarget のユニットテスト。
// - 自家・自家メンバー保有 right は対象外
// - rival の person holder right を house holder right より優先
// - 失効対象が無ければ undefined

import { describe, expect, it } from 'vitest'
import { createPersonId, createHouseId, createPolityId, createProvinceId } from '../types/ids'
import type { HoldingId } from '../types/ids'
import type { WorldState } from '../types/world'
import { createPoliticalRight } from '../mutations/politicalRightMutations'
import { findRevocableRightTarget } from './politicalRightSelectors'
import { politicalRightTargetKey } from '../types/politicalRight'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withHolding,
  withProvince,
} from '../testFixtures'

const polityId = createPolityId('c', 0)
const ownHouseId = createHouseId('h', 0)
const rivalHouseId = createHouseId('h', 1)
const ownMemberId = createPersonId('pe', 0)
const rivalPersonId = createPersonId('pe', 1)
const provinceId = createProvinceId('p', 0)
const holdingA = 'hl-0' as HoldingId
const holdingB = 'hl-1' as HoldingId

function makeFixture(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, provinceId)
  s = withHouse(s, ownHouseId)
  s = withHouse(s, rivalHouseId)
  s = withPerson(s, ownMemberId, { houseId: ownHouseId })
  s = withPerson(s, rivalPersonId, { houseId: rivalHouseId })
  s = withPolity(s, polityId, { ownerHouseId: ownHouseId })
  s = withHolding(s, holdingA, provinceId)
  s = withHolding(s, holdingB, provinceId)
  s = {
    ...s,
    holdingTerminalPolityCache: {
      ...s.holdingTerminalPolityCache,
      [holdingA]: polityId,
      [holdingB]: polityId,
    },
  }
  return s
}

function grantHouseRight(
  s: WorldState,
  holdingId: HoldingId,
  houseId: typeof ownHouseId,
): WorldState {
  const r = createPoliticalRight(s, {
    polityId,
    target: { kind: 'holding_office_role', holdingId, role: 'bailiff' },
    holder: { kind: 'house', id: houseId },
    grantedWeek: 0,
  })
  if (!r.ok) throw new Error('grant failed')
  return r.value.state
}

function grantPersonRight(
  s: WorldState,
  holdingId: HoldingId,
  personId: typeof ownMemberId,
): WorldState {
  const r = createPoliticalRight(s, {
    polityId,
    target: { kind: 'holding_office_role', holdingId, role: 'bailiff' },
    holder: { kind: 'person', id: personId },
    grantedWeek: 0,
  })
  if (!r.ok) throw new Error('grant failed')
  return r.value.state
}

describe('findRevocableRightTarget', () => {
  it('returns undefined when only own house holds rights', () => {
    const s = grantHouseRight(makeFixture(), holdingA, ownHouseId)
    expect(findRevocableRightTarget(s, ownHouseId, polityId)).toBeUndefined()
  })

  it('excludes own-member person-held rights', () => {
    const s = grantPersonRight(makeFixture(), holdingA, ownMemberId)
    expect(findRevocableRightTarget(s, ownHouseId, polityId)).toBeUndefined()
  })

  it('targets a rival house-held right', () => {
    const s = grantHouseRight(makeFixture(), holdingA, rivalHouseId)
    const target = findRevocableRightTarget(s, ownHouseId, polityId)
    expect(target).toBeDefined()
    expect(politicalRightTargetKey(target!)).toBe(
      politicalRightTargetKey({
        kind: 'holding_office_role',
        holdingId: holdingA,
        role: 'bailiff',
      }),
    )
  })

  it('prefers a rival person-held right over a rival house-held right', () => {
    let s = makeFixture()
    s = grantHouseRight(s, holdingA, rivalHouseId)
    s = grantPersonRight(s, holdingB, rivalPersonId)
    const target = findRevocableRightTarget(s, ownHouseId, polityId)
    expect(target).toBeDefined()
    // person holder right (holdingB) を優先
    expect(politicalRightTargetKey(target!)).toBe(
      politicalRightTargetKey({
        kind: 'holding_office_role',
        holdingId: holdingB,
        role: 'bailiff',
      }),
    )
  })
})
