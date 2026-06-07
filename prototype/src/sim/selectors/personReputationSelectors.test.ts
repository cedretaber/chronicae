// v0.44 §4.3-4.4: PersonReputation の減衰 selector / expiryWeek 計算のユニットテスト。

import { describe, expect, it } from 'vitest'
import { createPersonId, createPersonReputationId } from '../types/ids'
import type { PersonReputation } from '../types/personReputation'
import { defaultConfig } from '../config/defaultConfig'
import {
  getCurrentPersonReputationScore,
  computeReputationExpiryWeek,
} from './personReputationSelectors'

function makeReputation(baseScore: number, createdWeek: number): PersonReputation {
  return {
    id: createPersonReputationId(0),
    personId: createPersonId('pe', 0),
    source: { kind: 'war' },
    outcome: baseScore >= 0 ? 'success' : 'failure',
    category: 'military',
    baseScore,
    createdWeek,
    expiryWeek: computeReputationExpiryWeek(baseScore, createdWeek, defaultConfig) ?? createdWeek,
    relatedRefs: [],
  }
}

describe('getCurrentPersonReputationScore (§4.3)', () => {
  it('作成直後は baseScore そのまま', () => {
    const rep = makeReputation(10, 1000)
    expect(getCurrentPersonReputationScore(rep, 1000, defaultConfig)).toBe(10)
    // 4 週未満も同月扱い
    expect(getCurrentPersonReputationScore(rep, 1003, defaultConfig)).toBe(10)
  })

  it('月次で retentionRate を累乗する', () => {
    const rep = makeReputation(10, 1000)
    const rate = defaultConfig.personReputationMonthlyRetentionRate
    expect(getCurrentPersonReputationScore(rep, 1004, defaultConfig)).toBeCloseTo(10 * rate)
    expect(getCurrentPersonReputationScore(rep, 1048, defaultConfig)).toBeCloseTo(
      10 * Math.pow(rate, 12),
    )
  })

  it('負スコアも同率で減衰する (符号維持)', () => {
    const rep = makeReputation(-8, 1000)
    const rate = defaultConfig.personReputationMonthlyRetentionRate
    expect(getCurrentPersonReputationScore(rep, 1004, defaultConfig)).toBeCloseTo(-8 * rate)
  })
})

describe('computeReputationExpiryWeek (§4.4)', () => {
  it('expiryWeek 時点の現在値は threshold 未満・直前月は以上', () => {
    const createdWeek = 1000
    const expiry = computeReputationExpiryWeek(10, createdWeek, defaultConfig)
    expect(expiry).toBeDefined()
    const rep = makeReputation(10, createdWeek)
    const atExpiry = Math.abs(getCurrentPersonReputationScore(rep, expiry!, defaultConfig))
    const beforeExpiry = Math.abs(getCurrentPersonReputationScore(rep, expiry! - 4, defaultConfig))
    expect(atExpiry).toBeLessThan(defaultConfig.personReputationCleanupThreshold)
    expect(beforeExpiry).toBeGreaterThanOrEqual(defaultConfig.personReputationCleanupThreshold)
  })

  it('abs(baseScore) <= threshold は undefined (作成しない)', () => {
    expect(
      computeReputationExpiryWeek(defaultConfig.personReputationCleanupThreshold, 0, defaultConfig),
    ).toBeUndefined()
    expect(computeReputationExpiryWeek(0, 0, defaultConfig)).toBeUndefined()
  })

  it('負の baseScore も abs で扱う', () => {
    const expiryNeg = computeReputationExpiryWeek(-10, 1000, defaultConfig)
    const expiryPos = computeReputationExpiryWeek(10, 1000, defaultConfig)
    expect(expiryNeg).toBe(expiryPos)
  })
})

// ─── 任用反映 (§9) ───

import { createHouseId, createProvinceId } from '../types/ids'
import {
  getPersonReputationModifierForCategories,
  getReputationCategoriesForOfficeRole,
  getAppointmentReputationModifier,
} from './personReputationSelectors'
import { addPersonReputationMut } from '../mutations/personReputationMutations'
import { makeEmptyV016State, withPerson, withHouse, withProvince } from '../testFixtures'
import type { WorldState } from '../types/world'
import type { ReputationCategory } from '../types/personReputation'

const pid = createPersonId('pe', 0)

function makeStateWithReps(
  reps: { category: ReputationCategory; baseScore: number }[],
): WorldState {
  let state = makeEmptyV016State()
  const houseId = createHouseId('dh', 0)
  state = withProvince(state, createProvinceId('p', 0), {})
  state = withHouse(state, houseId, {})
  state = withPerson(state, pid, { houseId })
  const ws = { ...state }
  for (const r of reps) {
    addPersonReputationMut(ws, {
      personId: pid,
      source: { kind: 'war' },
      outcome: r.baseScore >= 0 ? 'success' : 'failure',
      category: r.category,
      baseScore: r.baseScore,
      createdWeek: ws.absoluteWeek,
      expiryWeek: ws.absoluteWeek + 1000,
      relatedRefs: [],
    })
  }
  return ws
}

describe('getPersonReputationModifierForCategories (§9.1)', () => {
  it('categories に含まれる category のみ等価合算する', () => {
    const ws = makeStateWithReps([
      { category: 'military', baseScore: 12 },
      { category: 'diplomacy', baseScore: 10 },
      { category: 'culture', baseScore: 8 },
    ])
    expect(getPersonReputationModifierForCategories(ws, defaultConfig, pid, ['military'])).toBe(12)
    expect(
      getPersonReputationModifierForCategories(ws, defaultConfig, pid, ['military', 'diplomacy']),
    ).toBe(20) // 22 だが cap 20 で clamp
  })

  it('±appointmentReputationModifierCap に clamp する', () => {
    const ws = makeStateWithReps([
      { category: 'military', baseScore: -12 },
      { category: 'military', baseScore: -12 },
      { category: 'military', baseScore: -12 },
    ])
    expect(getPersonReputationModifierForCategories(ws, defaultConfig, pid, ['military'])).toBe(
      -defaultConfig.appointmentReputationModifierCap,
    )
  })

  it('評判が無ければ 0', () => {
    const ws = makeStateWithReps([])
    expect(getPersonReputationModifierForCategories(ws, defaultConfig, pid, ['military'])).toBe(0)
  })
})

describe('getAppointmentReputationModifier (§9.3)', () => {
  it('role の category 表で filter し factor を 1 回だけ掛ける', () => {
    const ws = makeStateWithReps([
      { category: 'military', baseScore: 12 },
      { category: 'culture', baseScore: 8 },
    ])
    // military role → ['military'] → 12 × 0.25 = 3
    expect(getAppointmentReputationModifier(ws, defaultConfig, pid, 'military')).toBeCloseTo(
      12 * defaultConfig.officeReputationScoreFactor,
    )
    // advisor → culture/diplomacy/intrigue → 8 × 0.25 = 2
    expect(getAppointmentReputationModifier(ws, defaultConfig, pid, 'advisor')).toBeCloseTo(
      8 * defaultConfig.officeReputationScoreFactor,
    )
  })

  it('§9.2 の role → category 表', () => {
    expect(getReputationCategoriesForOfficeRole('administrator')).toEqual([
      'administration',
      'diplomacy',
    ])
    expect(getReputationCategoriesForOfficeRole('treasurer')).toEqual([
      'stewardship',
      'administration',
    ])
    expect(getReputationCategoriesForOfficeRole('military')).toEqual(['military'])
    expect(getReputationCategoriesForOfficeRole('leader')).toEqual([
      'general',
      'diplomacy',
      'military',
      'administration',
    ])
  })
})
