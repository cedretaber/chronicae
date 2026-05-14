export type RngState = { seedText: string; state: number }
export type RngResult<T> = { value: T; rng: RngState }

export function hashSeedToUint32(seedText: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seedText.length; i++) {
    hash ^= seedText.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function createRng(seedText: string): RngState {
  return { seedText, state: hashSeedToUint32(seedText) }
}

function mulberry32(state: number): { value: number; nextState: number } {
  let z = (state + 0x6d2b79f5) | 0
  z = Math.imul(z ^ (z >>> 15), z | 1)
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
  const value = ((z ^ (z >>> 14)) >>> 0) / 0x100000000
  const nextState = (state + 0x6d2b79f5) >>> 0
  return { value, nextState }
}

export function randomFloat(rng: RngState): RngResult<number> {
  const { value, nextState } = mulberry32(rng.state)
  return { value, rng: { ...rng, state: nextState } }
}

export function randomInt(rng: RngState, min: number, max: number): RngResult<number> {
  const { value: float, rng: floatRng } = randomFloat(rng)
  const value = min + Math.floor(float * (max - min + 1))
  return { value, rng: floatRng }
}

export function chooseOne<T>(rng: RngState, items: readonly T[]): RngResult<T> {
  if (items.length === 0) {
    throw new Error('Cannot choose from an empty array')
  }
  const { value: index, rng: indexRng } = randomInt(rng, 0, items.length - 1)
  const value = items[index]
  if (value === undefined) {
    throw new Error('Unexpected undefined value from array access')
  }
  return { value, rng: indexRng }
}

export function shuffle<T>(rng: RngState, items: readonly T[]): RngResult<T[]> {
  const array = [...items]
  for (let i = array.length - 1; i > 0; i--) {
    const { value: index, rng: stepRng } = randomInt(rng, 0, i)
    const temp = array[i]
    if (temp === undefined) continue
    const swap = array[index]
    if (swap === undefined) continue
    array[i] = swap
    array[index] = temp
    rng = stepRng
  }
  return { value: array, rng }
}
