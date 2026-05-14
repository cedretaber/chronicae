export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

export function clamp100(value: number): number {
  return clamp(value, 0, 100)
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}
