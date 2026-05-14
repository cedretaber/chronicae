import { clamp } from '../utils/math'
import type { Province } from '../types/province'

export function getProvinceDevelopmentMultiplier(province: Province): number {
  return clamp(1 + province.development / 100, 0, 2)
}

export function getEffectiveProvinceTax(province: Province): number {
  return province.baseTax * (1 - province.unrest / 100) * getProvinceDevelopmentMultiplier(province)
}

export function getEffectiveProvinceManpower(province: Province): number {
  return (
    province.manpower * (1 - province.unrest / 200) * getProvinceDevelopmentMultiplier(province)
  )
}
