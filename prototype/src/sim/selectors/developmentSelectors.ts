import { clamp } from '../utils/math'

export function getProvinceDevelopmentMultiplier(development: number): number {
  return clamp(1 + development / 100, 0, 2)
}
