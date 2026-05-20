import type { RngState } from '../rng/rng'
import { randomInt } from '../rng/rng'
import {
  COUNTRY_NAMES,
  HOUSE_NAMES,
  MALE_NAMES,
  FEMALE_NAMES,
  PROVINCE_NAMES,
  STATE_NAMES,
} from './namePool'

export function pickUniqueName(
  pool: string[],
  used: Set<string>,
  fallback: (index: number) => string,
  fallbackIndex: number,
  rng: RngState,
): { name: string; rng: RngState } {
  const available = pool.filter((n) => !used.has(n))
  if (available.length === 0) {
    return { name: fallback(fallbackIndex), rng }
  }
  const { value: idx, rng: nextRng } = randomInt(rng, 0, available.length - 1)
  const name = available[idx]!
  used.add(name)
  return { name, rng: nextRng }
}

export function pickName(pool: string[], rng: RngState): { name: string; rng: RngState } {
  const { value: idx, rng: nextRng } = randomInt(rng, 0, pool.length - 1)
  return { name: pool[idx]!, rng: nextRng }
}

export function pickNameBySex(
  sex: 'male' | 'female',
  rng: RngState,
): { name: string; rng: RngState } {
  return pickName(sex === 'male' ? MALE_NAMES : FEMALE_NAMES, rng)
}

export function houseNamePool(): string[] {
  return HOUSE_NAMES
}
export function maleNamePool(): string[] {
  return MALE_NAMES
}
export function femaleNamePool(): string[] {
  return FEMALE_NAMES
}
export function provinceNamePool(): string[] {
  return PROVINCE_NAMES
}
export function polityNamePool(): string[] {
  return COUNTRY_NAMES
}

export function stateNamePool(): string[] {
  return STATE_NAMES
}

export function stateName(index: number): string {
  return `State-${index}`
}

// Keep old functions for fallback use only
export function provinceName(index: number): string {
  return `Province-${index}`
}
export function polityName(index: number): string {
  return `Country-${index}`
}
export function houseName(index: number): string {
  return `House-${index}`
}
export function personName(index: number): string {
  return `Person-${index}`
}
