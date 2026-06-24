// v0.45: ギャップ比例成長 (abilityGrowthGapFactor) のユニットテスト。

import { describe, expect, it } from 'vitest'
import { createHouseId, createPersonId } from '../types/ids'
import type { TickContext } from './context'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { makeEmptyV016State, withHouse, withPerson, withHouseLeader } from '../testFixtures'
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
    // 30歳 aptitude 100: naturalCeil = 0.8 × shape × 100 → gap 大 → 複数ポイント
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
    // ability 45 / 30歳 aptitude 65: ceil = 65 × 0.8 × shape ≈ 47-52 → gap×0.15 < 1.5 → +1
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

  it('大ギャップでも round(naturalCeil) を超えない (clamp)', () => {
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

describe('runPersonGrowthSystem 経験天井解放の撤廃', () => {
  function runManyTicks(ctx: TickContext, ticks: number): TickContext {
    let cur = ctx
    for (let i = 0; i < ticks; i++) {
      cur = runPersonGrowthSystem(cur)
    }
    return cur
  }

  it('家長(経験あり)でも自然成長は 0.8×aptitude を超えない', () => {
    // 旧仕様では家長(command 経験)は command を aptitude(100)まで自然成長させられた。
    // 新仕様では command も 0.8×100=80 で頭打ち(超過は award 成長のみ)。
    let ctx = makeCtx({ age: 45, ability: 10, aptitude: 100 })
    ctx = { ...ctx, state: withHouseLeader(ctx.state, houseId, personId) }
    const result = runManyTicks(ctx, 200)
    const person = result.state.persons[personId]!
    // command は midLifePeak・age45 がピーク → 天井 0.8×100=80
    expect(person.abilities.command).toBeLessThanOrEqual(80)
    expect(person.abilities.command).toBeGreaterThan(70) // 0.8 近傍までは到達する
  })

  it('成長イベントの sourceKind は常に natural (duty を出さない)', () => {
    const ctx = makeCtx({ age: 30, ability: 0, aptitude: 100 })
    const result = runPersonGrowthSystem(ctx)
    const grew = result.events.filter((e) => e.type === 'PERSON_ABILITY_GREW')
    expect(grew.length).toBeGreaterThan(0)
    for (const e of grew) {
      expect(e.messageParams.sourceKind).toBe('natural')
    }
  })

  it('0.8 超〜天賦の dead band は成長も衰退もしない (award 由来能力を保持)', () => {
    // age 30 ≤ 各ピーク。aptitude 100・ability 90 (= award で 0.8 超に押し上げ済みを想定)。
    // 成長: 90 > naturalCeil(=0.8×shape×100) → 伸びない。
    // 衰退: declineRef = aptitude×shape (taper 前)。age≤peak では shape≈1 → declineRef≈100 >
    //       90 → 衰退しない。よって全能力 90 を保持する。
    const ctx = makeCtx({ age: 30, ability: 90, aptitude: 100 })
    const result = runManyTicks(ctx, 200)
    const person = result.state.persons[personId]!
    for (const value of Object.values(person.abilities)) {
      expect(value).toBe(90)
    }
  })
})
