import { describe, expect, it } from 'vitest'
import type { PersonId } from '../types/ids'
import type { AbilityScores } from '../types/person'
import { createRng } from '@sim/rng/rng'
import { defaultConfig } from '@sim/config/defaultConfig'
import {
  ABILITY_GENERATION_MAX,
  ABILITY_HARD_CAP,
  ABILITY_KEYS,
} from '@sim/constants/abilityConstants'
import {
  sampleAptitudes,
  inheritAptitudes,
  sampleAbilitiesFromAptitudes,
  getRoleScore,
} from './abilitySelectors'

const DEFAULT_ABILITIES: AbilityScores = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makeAptitudeOnlyPerson(aptitudes: AbilityScores): import('../types/person').Person {
  return {
    id: 'pe-0' as PersonId,
    name: 'Dummy',
    sex: 'male',
    age: 30,
    alive: true,
    houseId: 'dh-0' as import('../types/ids').HouseId,
    countryId: 'dc-0' as import('../types/ids').CountryId,
    abilities: { ...DEFAULT_ABILITIES },
    aptitudes,
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 0,
    wealth: 0,
    attitudes: {},
    childIds: [],
    birthStatus: 'unknown',
  }
}

describe('sampleAptitudes', () => {
  it('all generated values are in [0, ABILITY_GENERATION_MAX]', () => {
    const samples: AbilityScores[] = []
    let rng = createRng('sampleAptitudes-range')
    for (let i = 0; i < 200; i++) {
      const { value, rng: nextRng } = sampleAptitudes(rng, defaultConfig)
      samples.push(value)
      rng = nextRng
    }
    for (const sample of samples) {
      for (const key of ABILITY_KEYS) {
        expect(sample[key]).toBeGreaterThanOrEqual(0)
        expect(sample[key]).toBeLessThanOrEqual(ABILITY_GENERATION_MAX)
      }
    }
  })

  it('mean converges near abilityAptitudeMean (50) for large sample', () => {
    let rng = createRng('sampleAptitudes-mean')
    const sums: Record<string, number> = {}
    for (const key of ABILITY_KEYS) {
      sums[key as string] = 0
    }
    for (let i = 0; i < 500; i++) {
      const { value, rng: nextRng } = sampleAptitudes(rng, defaultConfig)
      for (const key of ABILITY_KEYS) {
        sums[key as string]! += value[key]
      }
      rng = nextRng
    }
    for (const key of ABILITY_KEYS) {
      const avg = (sums[key as string] ?? 0) / 500
      expect(avg).toBeGreaterThan(40)
      expect(avg).toBeLessThan(60)
    }
  })
})

describe('inheritAptitudes', () => {
  it('regression toward mean from high aptitudes', () => {
    const highAptitudes: AbilityScores = {
      valor: 90,
      command: 90,
      numeracy: 90,
      learning: 90,
      charisma: 90,
      insight: 90,
    }
    const father = makeAptitudeOnlyPerson({ ...highAptitudes })
    const mother = makeAptitudeOnlyPerson({ ...highAptitudes })
    const rng = createRng('inheritAptitudes-regression')

    const key = 'valor' as import('../types/person').AbilityKey
    const sums: number[] = []
    let currentRng = rng
    for (let i = 0; i < 200; i++) {
      const { value, rng: nextRng } = inheritAptitudes(father, mother, currentRng, defaultConfig)
      sums.push(value[key])
      currentRng = nextRng
    }
    const avg = sums.reduce((a, b) => a + b, 0) / sums.length
    expect(avg).toBeGreaterThan(55)
    expect(avg).toBeLessThan(85)
  })

  it('all generated values are in [0, ABILITY_GENERATION_MAX]', () => {
    const highAptitudes: AbilityScores = {
      valor: 90,
      command: 90,
      numeracy: 90,
      learning: 90,
      charisma: 90,
      insight: 90,
    }
    const father = makeAptitudeOnlyPerson({ ...highAptitudes })
    const mother = makeAptitudeOnlyPerson({ ...highAptitudes })
    let rngState = createRng('inheritAptitudes-range')

    for (let i = 0; i < 200; i++) {
      const { value, rng: nextRng } = inheritAptitudes(father, mother, rngState, defaultConfig)
      for (const key of ABILITY_KEYS) {
        expect(value[key]).toBeGreaterThanOrEqual(0)
        expect(value[key]).toBeLessThanOrEqual(ABILITY_GENERATION_MAX)
      }
      rngState = nextRng
    }
  })
})

describe('sampleAbilitiesFromAptitudes', () => {
  it('every ability is <= corresponding aptitude (invariant)', () => {
    const aptitudes: AbilityScores = {
      valor: 80,
      command: 80,
      numeracy: 80,
      learning: 80,
      charisma: 80,
      insight: 80,
    }
    let rng = createRng('sampleAbilities-invariant')
    for (let i = 0; i < 100; i++) {
      const result = sampleAbilitiesFromAptitudes(aptitudes, 30, rng, defaultConfig)
      for (const key of ABILITY_KEYS) {
        expect(result.value[key]).toBeLessThanOrEqual(aptitudes[key])
      }
      rng = result.rng
    }
  })

  it('all values are in [0, ABILITY_HARD_CAP]', () => {
    const aptitudes: AbilityScores = {
      valor: 80,
      command: 80,
      numeracy: 80,
      learning: 80,
      charisma: 80,
      insight: 80,
    }
    let rng = createRng('sampleAbilities-range')
    for (let i = 0; i < 100; i++) {
      const result = sampleAbilitiesFromAptitudes(aptitudes, 30, rng, defaultConfig)
      for (const key of ABILITY_KEYS) {
        expect(result.value[key]).toBeGreaterThanOrEqual(0)
        expect(result.value[key]).toBeLessThanOrEqual(ABILITY_HARD_CAP)
      }
      rng = result.rng
    }
  })

  it('older age produces higher command on average (midLifePeak curve)', () => {
    const aptitudes: AbilityScores = {
      valor: 80,
      command: 80,
      numeracy: 80,
      learning: 80,
      charisma: 80,
      insight: 80,
    }

    let rngLow = createRng('sampleAbilities-age-low')
    let rngHigh = createRng('sampleAbilities-age-high')
    let sumLow = 0
    let sumHigh = 0
    const n = 200
    for (let i = 0; i < n; i++) {
      const resultLow = sampleAbilitiesFromAptitudes(aptitudes, 5, rngLow, defaultConfig)
      sumLow += resultLow.value.command
      rngLow = resultLow.rng

      const resultHigh = sampleAbilitiesFromAptitudes(aptitudes, 50, rngHigh, defaultConfig)
      sumHigh += resultHigh.value.command
      rngHigh = resultHigh.rng
    }
    const avgLow = sumLow / n
    const avgHigh = sumHigh / n
    expect(avgHigh).toBeGreaterThan(avgLow)
  })
})

describe('getRoleScore', () => {
  it('governance score matches expected weighted sum', () => {
    const personId = 'pe-0' as PersonId
    const state = {
      persons: {
        [personId]: {
          id: personId,
          name: 'Test',
          sex: 'male',
          age: 30,
          alive: true,
          houseId: 'dh-0' as import('../types/ids').HouseId,
          countryId: 'dc-0' as import('../types/ids').CountryId,
          abilities: {
            valor: 100,
            command: 80,
            numeracy: 60,
            learning: 40,
            charisma: 20,
            insight: 10,
          },
          aptitudes: DEFAULT_ABILITIES,
          traits: { ambition: 0.5, caution: 0.5 },
          legacyPrestige: 0,
          wealth: 0,
          attitudes: {},
          childIds: [],
          birthStatus: 'unknown',
        },
      },
    } as unknown as import('../types/world').WorldState

    const score = getRoleScore(state, personId, 'governance')
    expect(score).toBe(36)
  })

  it('warCommand score matches expected weighted sum', () => {
    const personId = 'pe-0' as PersonId
    const state = {
      persons: {
        [personId]: {
          id: personId,
          name: 'Test',
          sex: 'male',
          age: 30,
          alive: true,
          houseId: 'dh-0' as import('../types/ids').HouseId,
          countryId: 'dc-0' as import('../types/ids').CountryId,
          abilities: {
            valor: 100,
            command: 80,
            numeracy: 60,
            learning: 40,
            charisma: 20,
            insight: 10,
          },
          aptitudes: DEFAULT_ABILITIES,
          traits: { ambition: 0.5, caution: 0.5 },
          legacyPrestige: 0,
          wealth: 0,
          attitudes: {},
          childIds: [],
          birthStatus: 'unknown',
        },
      },
    } as unknown as import('../types/world').WorldState

    const score = getRoleScore(state, personId, 'warCommand')
    expect(score).toBe(64)
  })

  it('returns 0 for nonexistent person', () => {
    const state = { persons: {} } as unknown as import('../types/world').WorldState
    const score = getRoleScore(state, 'nonexistent' as PersonId, 'governance')
    expect(score).toBe(0)
  })

  it('caps at ABILITY_HARD_CAP when weighted sum exceeds cap', () => {
    const personId = 'pe-0' as PersonId
    const state = {
      persons: {
        [personId]: {
          id: personId,
          name: 'Test',
          sex: 'male',
          age: 30,
          alive: true,
          houseId: 'dh-0' as import('../types/ids').HouseId,
          countryId: 'dc-0' as import('../types/ids').CountryId,
          abilities: {
            valor: 120,
            command: 120,
            numeracy: 120,
            learning: 120,
            charisma: 120,
            insight: 120,
          },
          aptitudes: DEFAULT_ABILITIES,
          traits: { ambition: 0.5, caution: 0.5 },
          legacyPrestige: 0,
          wealth: 0,
          attitudes: {},
          childIds: [],
          birthStatus: 'unknown',
        },
      },
    } as unknown as import('../types/world').WorldState

    const score = getRoleScore(state, personId, 'governance')
    expect(score).toBe(ABILITY_HARD_CAP)
  })
})
