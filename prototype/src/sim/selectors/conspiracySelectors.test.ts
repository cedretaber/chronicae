// v0.51 陰謀リファイン: computeConspiracyDrive のゲート (閾値・cooldown) ユニットテスト。
// raw drive 式そのものは旧 plotTendency 移植のため、ここではゲート挙動を検証する。

import { describe, expect, it } from 'vitest'
import { createPersonId, createHouseId, createPolityId, createProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import { computeRawConspiracyDrive, computeConspiracyDrive } from './conspiracySelectors'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createOfficeAssignment } from '../mutations/officeMutations'

const polityId = createPolityId('dp', 0)
const houseId = createHouseId('dh', 0)
const leaderId = createPersonId('pe', 0)
const provinceId = createProvinceId('p', 0)

// 高 drive (ambition 高・caution 低) の家を組む。owned polity を持たせて primary polity を成立させる。
function makeMalcontentState(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, provinceId)
  s = withHouse(s, houseId, { seatProvinceId: provinceId, legacyPrestige: 80 })
  s = withPerson(s, leaderId, {
    houseId,
    traits: { ambition: 1, caution: 0 },
  })
  s = withPolity(s, polityId, { ownerHouseId: houseId })
  s = bindProvinceToHouseViaPolity(s, provinceId, polityId, houseId)
  s = createOfficeAssignment(s, { kind: 'house', id: houseId }, 'leader', leaderId)
  return s
}

describe('computeConspiracyDrive', () => {
  it('returns raw drive when above threshold and no cooldown', () => {
    const s = makeMalcontentState()
    const raw = computeRawConspiracyDrive(s, houseId)
    expect(raw).toBeGreaterThan(0)
    // 閾値を raw 未満にすればゲートを通過し raw を返す (式の絶対値に依存しない検証)
    const cfg = { ...defaultConfig, conspiracyDriveThreshold: raw - 1 }
    expect(computeConspiracyDrive(s, cfg, houseId)).toBe(raw)
  })

  it('returns 0 when raw drive is below threshold', () => {
    const s = makeMalcontentState()
    const raw = computeRawConspiracyDrive(s, houseId)
    const cfg = { ...defaultConfig, conspiracyDriveThreshold: raw + 100 }
    expect(computeConspiracyDrive(s, cfg, houseId)).toBe(0)
  })

  it('returns 0 while within cooldown window even when above threshold', () => {
    let s = makeMalcontentState()
    const raw = computeRawConspiracyDrive(s, houseId)
    s = {
      ...s,
      absoluteWeek: 48000,
      houses: {
        ...s.houses,
        [houseId]: { ...s.houses[houseId]!, lastConspiracyResolvedWeek: 48000 - 10 },
      },
    }
    // cooldown 52 週: 経過 10 週 < 52 なので閾値を通過しても 0
    const cfg = { ...defaultConfig, conspiracyDriveThreshold: raw - 1 }
    expect(computeConspiracyDrive(s, cfg, houseId)).toBe(0)
  })

  it('resumes after cooldown elapses', () => {
    let s = makeMalcontentState()
    const raw = computeRawConspiracyDrive(s, houseId)
    s = {
      ...s,
      absoluteWeek: 48000,
      houses: {
        ...s.houses,
        [houseId]: {
          ...s.houses[houseId]!,
          lastConspiracyResolvedWeek: 48000 - defaultConfig.conspiracyCooldownWeeks - 1,
        },
      },
    }
    const cfg = { ...defaultConfig, conspiracyDriveThreshold: raw - 1 }
    expect(computeConspiracyDrive(s, cfg, houseId)).toBeGreaterThan(0)
  })

  it('returns 0 for a house with no primary polity', () => {
    let s = makeEmptyV016State()
    s = withHouse(s, houseId, { legacyPrestige: 80 })
    s = withPerson(s, leaderId, { houseId, traits: { ambition: 1, caution: 0 } })
    s = createOfficeAssignment(s, { kind: 'house', id: houseId }, 'leader', leaderId)
    expect(computeRawConspiracyDrive(s, houseId)).toBe(0)
    expect(computeConspiracyDrive(s, defaultConfig, houseId)).toBe(0)
  })
})
