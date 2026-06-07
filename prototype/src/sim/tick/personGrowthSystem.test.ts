// v0.45: ギャップ比例成長 (abilityGrowthGapFactor) のユニットテスト。

import { describe, expect, it } from 'vitest'
import { createHouseId, createPersonId } from '../types/ids'
import type { TickContext } from './context'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { makeEmptyV016State, withHouse, withPerson } from '../testFixtures'
import { runPersonGrowthSystem } from './personGrowthSystem'

const houseId = createHouseId('h', 0)
const personId = createPersonId('pe', 0)

function makeCtx(input: {
  age: number
  ability: number
  aptitude: number
  config?: Partial<SimulationConfig>
}): TickContext {
  let state = makeEmptyV016State()
  state = withHouse(state, houseId, {})
  state = withPerson(state, personId, { houseId, age: input.age })
  const person = state.persons[personId]!
  // 全能力を同値にし、判定を能力 1 本ごとに同条件にする
  const abilities = { ...person.abilities }
  const aptitudes = { ...person.aptitudes }
  for (const k of Object.keys(abilities) as (keyof typeof abilities)[]) {
    abilities[k] = input.ability
    aptitudes[k] = input.aptitude
  }
  state = {
    ...state,
    persons: { ...state.persons, [personId]: { ...person, abilities, aptitudes } },
  }
  return {
    state,
    rng: createRng('growth-test'),
    config: { ...defaultConfig, ...input.config },
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextPolityIndex: 0,
  }
}

describe('runPersonGrowthSystem ギャップ比例成長', () => {
  it('天井から遠いと 1 回の成功で複数ポイント伸びる', () => {
    // 30歳 aptitude 100: naturalCeil は 50-75 → gap 大 → +5 前後
    // ability 0 なので gainChance = 100% で必ず成功する
    const ctx = makeCtx({ age: 30, ability: 0, aptitude: 100 })
    const result = runPersonGrowthSystem(ctx)
    const person = result.state.persons[personId]!
    for (const value of Object.values(person.abilities)) {
      expect(value).toBeGreaterThanOrEqual(3) // 全能力で複数ポイント成長
    }
    const grew = result.events.filter((e) => e.type === 'PERSON_ABILITY_GREW')
    expect(grew.length).toBe(6)
    for (const e of grew) {
      // イベントの oldValue→newValue も複数ポイント差
      const delta = (e.messageParams.newValue as number) - (e.messageParams.oldValue as number)
      expect(delta).toBeGreaterThanOrEqual(3)
    }
  })

  it('天井の直下では従来どおり +1 になる', () => {
    // ability 45 / 30歳 aptitude 65: ceil = 65 × 0.7〜0.75 ≈ 45.5-48.75 → gap < 4 → +1
    // 天井直下は gainChance が低くなるため base を引き上げて成功を決定化する
    const ctx = makeCtx({
      age: 30,
      ability: 45,
      aptitude: 65,
      config: { abilityGrowthChanceBase: 100000 },
    })
    const result = runPersonGrowthSystem(ctx)
    const grew = result.events.filter((e) => e.type === 'PERSON_ABILITY_GREW')
    expect(grew.length).toBeGreaterThan(0)
    for (const e of grew) {
      const delta = (e.messageParams.newValue as number) - (e.messageParams.oldValue as number)
      expect(delta).toBe(1)
    }
  })

  it('大ギャップでも round(effectiveCeil) を超えない (clamp)', () => {
    const ctx = makeCtx({
      age: 30,
      ability: 10,
      aptitude: 60,
      config: { abilityGrowthGapFactor: 10, abilityGrowthChanceBase: 100000 },
    })
    const result = runPersonGrowthSystem(ctx)
    const person = result.state.persons[personId]!
    for (const [k, value] of Object.entries(person.abilities)) {
      const aptitude = person.aptitudes[k as keyof typeof person.aptitudes]
      expect(value).toBeLessThanOrEqual(aptitude) // round(naturalCeil) <= aptitude の内側
      expect(value).toBeGreaterThan(10)
    }
  })
})
