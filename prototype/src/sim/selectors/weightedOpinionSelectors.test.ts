import { describe, it, expect } from 'vitest'
import {
  makeEmptyV016State,
  withHouse,
  withPerson,
  withHouseLeader,
  withPolity,
} from '../testFixtures'
import { getWeightedOpinionFromInfluenceBreakdown } from './influenceSelectors'
import { polityAttitudeKey } from '../helpers/attitudeHelpers'
import type { WorldState } from '../types/world'
import type { PolityId, HouseId, PersonId } from '../types/ids'
import type { PolityInfluenceBreakdown, PolityInfluenceEntry } from '../types/influence'

// v0.43 §9.3: getWeightedOpinionFromInfluenceBreakdown。
//   breakdown は手組み (selector の計算自体は v0.42 でテスト済み)。

const TARGET = 'c-target' as PolityId

function entry(
  holder: PolityInfluenceEntry['holder'],
  percent: number,
  total = percent,
): PolityInfluenceEntry {
  return { holder, byDomain: {}, total, percent }
}

function makeBreakdown(entries: PolityInfluenceEntry[]): PolityInfluenceBreakdown {
  return { polityId: 'c-1' as PolityId, entries, totalScore: 100 }
}

function setPolityAttitude(
  state: WorldState,
  personId: PersonId,
  affection: number,
  respect: number,
): WorldState {
  const person = state.persons[personId]!
  return {
    ...state,
    persons: {
      ...state.persons,
      [personId]: {
        ...person,
        attitudes: { ...person.attitudes, [polityAttitudeKey(TARGET)]: { affection, respect } },
      },
    },
  }
}

function makeBaseState(): WorldState {
  let s = makeEmptyV016State()
  s = withPolity(s, TARGET, {})
  return s
}

describe('getWeightedOpinionFromInfluenceBreakdown', () => {
  it('uses the person attitude directly for a person holder', () => {
    let s = makeBaseState()
    s = withHouse(s, 'h-1' as HouseId)
    s = withPerson(s, 'pe-1' as PersonId, { houseId: 'h-1' as HouseId })
    // houseless person entry: person holder は holder.id 本人の attitude
    s = setPolityAttitude(s, 'pe-1' as PersonId, 100, 100)
    const breakdown = makeBreakdown([entry({ kind: 'person', id: 'pe-1' as PersonId }, 100)])
    // opinion = 0.7*100 + 0.3*100 = 100
    expect(getWeightedOpinionFromInfluenceBreakdown(s, breakdown, TARGET)).toBe(100)
  })

  it('uses the house leader attitude for a house holder', () => {
    let s = makeBaseState()
    s = withHouse(s, 'h-1' as HouseId)
    s = withPerson(s, 'pe-leader' as PersonId, { houseId: 'h-1' as HouseId })
    s = withHouseLeader(s, 'h-1' as HouseId, 'pe-leader' as PersonId)
    s = setPolityAttitude(s, 'pe-leader' as PersonId, 50, -50)
    const breakdown = makeBreakdown([entry({ kind: 'house', id: 'h-1' as HouseId }, 100)])
    // opinion = 0.7*50 + 0.3*(-50) = 20
    expect(getWeightedOpinionFromInfluenceBreakdown(s, breakdown, TARGET)).toBeCloseTo(20)
  })

  it('weights opinions by entry.percent', () => {
    let s = makeBaseState()
    s = withHouse(s, 'h-1' as HouseId)
    s = withHouse(s, 'h-2' as HouseId)
    s = withPerson(s, 'pe-1' as PersonId, { houseId: 'h-1' as HouseId })
    s = withPerson(s, 'pe-2' as PersonId, { houseId: 'h-2' as HouseId })
    s = withHouseLeader(s, 'h-1' as HouseId, 'pe-1' as PersonId)
    s = withHouseLeader(s, 'h-2' as HouseId, 'pe-2' as PersonId)
    s = setPolityAttitude(s, 'pe-1' as PersonId, 100, 100) // opinion 100, weight 75
    s = setPolityAttitude(s, 'pe-2' as PersonId, -100, -100) // opinion -100, weight 25
    const breakdown = makeBreakdown([
      entry({ kind: 'house', id: 'h-1' as HouseId }, 75),
      entry({ kind: 'house', id: 'h-2' as HouseId }, 25),
    ])
    // (100*75 + (-100)*25) / 100 = 50
    expect(getWeightedOpinionFromInfluenceBreakdown(s, breakdown, TARGET)).toBeCloseTo(50)
  })

  it('excludes house entries without a living leader (weight is dropped, not zeroed)', () => {
    let s = makeBaseState()
    s = withHouse(s, 'h-1' as HouseId)
    s = withHouse(s, 'h-no-leader' as HouseId)
    s = withPerson(s, 'pe-1' as PersonId, { houseId: 'h-1' as HouseId })
    s = withHouseLeader(s, 'h-1' as HouseId, 'pe-1' as PersonId)
    s = setPolityAttitude(s, 'pe-1' as PersonId, 100, 100)
    const breakdown = makeBreakdown([
      entry({ kind: 'house', id: 'h-1' as HouseId }, 30),
      entry({ kind: 'house', id: 'h-no-leader' as HouseId }, 70),
    ])
    // leader 不在 entry は分母からも除外 → 100*30/30 = 100 (0 と混ぜて薄めない)
    expect(getWeightedOpinionFromInfluenceBreakdown(s, breakdown, TARGET)).toBe(100)
  })

  it('returns 0 (neutral) when no holder is evaluable', () => {
    const s = makeBaseState()
    const breakdown = makeBreakdown([entry({ kind: 'house', id: 'h-ghost' as HouseId }, 100)])
    expect(getWeightedOpinionFromInfluenceBreakdown(s, breakdown, TARGET)).toBe(0)
  })

  it('returns 0 for an empty breakdown', () => {
    const s = makeBaseState()
    expect(getWeightedOpinionFromInfluenceBreakdown(s, makeBreakdown([]), TARGET)).toBe(0)
  })

  it('defaults to neutral 0 for holders without attitude entries', () => {
    let s = makeBaseState()
    s = withHouse(s, 'h-1' as HouseId)
    s = withPerson(s, 'pe-1' as PersonId, { houseId: 'h-1' as HouseId })
    s = withHouseLeader(s, 'h-1' as HouseId, 'pe-1' as PersonId)
    const breakdown = makeBreakdown([entry({ kind: 'house', id: 'h-1' as HouseId }, 100)])
    expect(getWeightedOpinionFromInfluenceBreakdown(s, breakdown, TARGET)).toBe(0)
  })
})
