// v0.44 §3.2: 即時成長 roll (floor + fractional) と評判付与 helper のユニットテスト。

import { describe, expect, it } from 'vitest'
import { createPersonId, createHouseId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import type { CreateSimEventInput } from '../tick/context'
import { makeEmptyV016State, withHouse, withPerson } from '../testFixtures'
import { applyImmediateAbilityGrowthMut, awardPersonReputationMut } from './awardHelpers'

const personId = createPersonId('pe', 0)

function makeState(overrides?: {
  abilities?: Partial<Record<string, number>>
  aptitudes?: Partial<Record<string, number>>
}): WorldState {
  let state = makeEmptyV016State()
  const houseId = createHouseId('dh', 0)
  state = withHouse(state, houseId, {})
  state = withPerson(state, personId, { houseId })
  const person = state.persons[personId]!
  state = {
    ...state,
    persons: {
      ...state.persons,
      [personId]: {
        ...person,
        abilities: { ...person.abilities, ...overrides?.abilities },
        aptitudes: { ...person.aptitudes, ...overrides?.aptitudes },
      },
    },
  }
  return state
}

function collectEmits(): { events: CreateSimEventInput[]; emit: (e: CreateSimEventInput) => void } {
  const events: CreateSimEventInput[] = []
  return { events, emit: (e) => events.push(e) }
}

describe('applyImmediateAbilityGrowthMut (§3.2)', () => {
  it('整数部は RNG を引かず確定で +N する (floor 決定性)', () => {
    // expected = 2 * 1.0 * 100 / 100 = 2.0 → guaranteed 2, fractional 0
    const config: SimulationConfig = {
      ...defaultConfig,
      experienceImmediateGrowthChancePerPoint: 100,
    }
    const state = makeState({ abilities: { numeracy: 50 }, aptitudes: { numeracy: 90 } })
    const ws = { ...state, persons: { ...state.persons } }
    const rng = createRng('seed')
    const { events, emit } = collectEmits()

    const nextRng = applyImmediateAbilityGrowthMut(
      ws,
      config,
      personId,
      2,
      { numeracy: 1.0 },
      'project',
      rng,
      emit,
    )

    expect(ws.persons[personId]!.abilities.numeracy).toBe(52)
    expect(nextRng).toBe(rng) // fractional 0 → RNG 不消費
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('PERSON_ABILITY_GREW')
    expect(events[0]!.messageParams).toMatchObject({
      ability: 'numeracy',
      oldValue: 50,
      newValue: 52,
      sourceKind: 'project',
    })
  })

  it('小数部は RNG を 1 回消費する', () => {
    // expected = 1 * 1.0 * 50 / 100 = 0.5 → guaranteed 0, fractional 0.5
    const config: SimulationConfig = {
      ...defaultConfig,
      experienceImmediateGrowthChancePerPoint: 50,
    }
    const state = makeState({ abilities: { numeracy: 50 }, aptitudes: { numeracy: 90 } })
    const ws = { ...state, persons: { ...state.persons } }
    const rng = createRng('seed')
    const { emit } = collectEmits()

    const nextRng = applyImmediateAbilityGrowthMut(
      ws,
      config,
      personId,
      1,
      { numeracy: 1.0 },
      'project',
      rng,
      emit,
    )

    expect(nextRng).not.toBe(rng) // fractional > 0 → RNG 消費
    const after = ws.persons[personId]!.abilities.numeracy
    expect(after === 50 || after === 51).toBe(true)
  })

  it('aptitude を超えない (再分配なし)', () => {
    const config: SimulationConfig = {
      ...defaultConfig,
      experienceImmediateGrowthChancePerPoint: 100,
    }
    const state = makeState({ abilities: { numeracy: 59 }, aptitudes: { numeracy: 60 } })
    const ws = { ...state, persons: { ...state.persons } }
    const { events, emit } = collectEmits()

    applyImmediateAbilityGrowthMut(
      ws,
      config,
      personId,
      5, // expected 5 だが cap 60 で +1 のみ
      { numeracy: 1.0 },
      'project',
      createRng('seed'),
      emit,
    )

    expect(ws.persons[personId]!.abilities.numeracy).toBe(60)
    expect(events[0]!.messageParams).toMatchObject({ oldValue: 59, newValue: 60 })
  })

  it('ability hard cap 120 を超えない', () => {
    const config: SimulationConfig = {
      ...defaultConfig,
      experienceImmediateGrowthChancePerPoint: 100,
    }
    const state = makeState({ abilities: { numeracy: 118 }, aptitudes: { numeracy: 200 } })
    const ws = { ...state, persons: { ...state.persons } }
    const { emit } = collectEmits()

    applyImmediateAbilityGrowthMut(
      ws,
      config,
      personId,
      10,
      { numeracy: 1.0 },
      'project',
      createRng('seed'),
      emit,
    )

    expect(ws.persons[personId]!.abilities.numeracy).toBe(120)
  })

  it('weight 分配: 複数 ability に ABILITY_KEYS 順で適用される', () => {
    // 経験 10 × weight 0.6/0.2/0.2 × 100/100 = 6 / 2 / 2 (整数 → 決定的)
    const config: SimulationConfig = {
      ...defaultConfig,
      experienceImmediateGrowthChancePerPoint: 100,
    }
    const state = makeState({
      abilities: { numeracy: 10, learning: 10, insight: 10 },
      aptitudes: { numeracy: 90, learning: 90, insight: 90 },
    })
    const ws = { ...state, persons: { ...state.persons } }
    const { events, emit } = collectEmits()

    applyImmediateAbilityGrowthMut(
      ws,
      config,
      personId,
      10,
      { numeracy: 0.6, learning: 0.2, insight: 0.2 },
      'project',
      createRng('seed'),
      emit,
    )

    const abilities = ws.persons[personId]!.abilities
    expect(abilities.numeracy).toBe(16)
    expect(abilities.learning).toBe(12)
    expect(abilities.insight).toBe(12)
    // ABILITY_KEYS 順: numeracy → learning → insight (valor/command/charisma は weight なし)
    expect(events.map((e) => e.messageParams.ability)).toEqual(['numeracy', 'learning', 'insight'])
  })

  it('死亡人物には付与しない', () => {
    const config: SimulationConfig = {
      ...defaultConfig,
      experienceImmediateGrowthChancePerPoint: 100,
    }
    let state = makeState({ abilities: { numeracy: 50 } })
    const person = state.persons[personId]!
    state = { ...state, persons: { ...state.persons, [personId]: { ...person, alive: false } } }
    const ws = { ...state, persons: { ...state.persons } }
    const { events, emit } = collectEmits()

    applyImmediateAbilityGrowthMut(
      ws,
      config,
      personId,
      5,
      { numeracy: 1.0 },
      'project',
      createRng('seed'),
      emit,
    )

    expect(ws.persons[personId]!.abilities.numeracy).toBe(50)
    expect(events).toHaveLength(0)
  })
})

describe('awardPersonReputationMut (§4)', () => {
  it('正の baseScore で entity 作成 + GAINED event', () => {
    const state = makeState()
    const ws = { ...state, persons: { ...state.persons } }
    const { events, emit } = collectEmits()

    const rep = awardPersonReputationMut(
      ws,
      defaultConfig,
      {
        personId,
        source: { kind: 'war' },
        category: 'military',
        baseScore: 12,
      },
      emit,
    )

    expect(rep).toBeDefined()
    expect(ws.personReputations[rep!.id]).toMatchObject({
      personId,
      category: 'military',
      baseScore: 12,
      outcome: 'success',
    })
    expect(ws.personReputationIndex.byPerson[personId]).toEqual([rep!.id])
    expect(rep!.expiryWeek).toBeGreaterThan(ws.absoluteWeek)
    expect(events[0]!.type).toBe('PERSON_REPUTATION_GAINED')
  })

  it('負の baseScore で DAMAGED event + outcome failure', () => {
    const state = makeState()
    const ws = { ...state, persons: { ...state.persons } }
    const { events, emit } = collectEmits()

    const rep = awardPersonReputationMut(
      ws,
      defaultConfig,
      {
        personId,
        source: { kind: 'diplomatic_play', playKind: 'land_claim' },
        category: 'diplomacy',
        baseScore: -8,
      },
      emit,
    )

    expect(rep!.outcome).toBe('failure')
    expect(events[0]!.type).toBe('PERSON_REPUTATION_DAMAGED')
  })

  it('abs(baseScore) <= cleanupThreshold は作成しない (§4.4)', () => {
    const state = makeState()
    const ws = { ...state, persons: { ...state.persons } }
    const { events, emit } = collectEmits()

    const rep = awardPersonReputationMut(
      ws,
      defaultConfig,
      {
        personId,
        source: { kind: 'war' },
        baseScore: defaultConfig.personReputationCleanupThreshold,
        category: 'military',
      },
      emit,
    )

    expect(rep).toBeUndefined()
    expect(Object.keys(ws.personReputations)).toHaveLength(0)
    expect(events).toHaveLength(0)
  })
})
