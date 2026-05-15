import { clamp } from '../utils/math'
import type { Province } from '../types/province'

export function getProvinceDevelopmentMultiplier(province: Province): number {
  return clamp(1 + province.development / 100, 0, 2)
}
