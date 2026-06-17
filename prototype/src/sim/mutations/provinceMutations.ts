import type { ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { StateResult } from './result'
import { ok } from './result'

// v0.27: development is now derived from HoldingImprovement via selectors.
// These functions are kept as no-ops for future devastation/condition system.
export function adjustProvinceDevelopment(
  ...args: [
    state: WorldState,
    provinceId: ProvinceId,
    delta: number,
    options?: { min?: number; max?: number },
  ]
): StateResult {
  return ok(args[0])
}
