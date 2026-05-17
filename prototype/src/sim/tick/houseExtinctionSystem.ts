import type { TickContext } from './context'
import type { HouseId } from '../types/ids'
import { extinctHouse } from '../mutations/worldStructureMutations'

export function extinctHouseAfterFailedSuccession(ctx: TickContext, houseId: HouseId): TickContext {
  const result = extinctHouse(ctx, houseId)
  if (!result.ok) return ctx
  return result.value.ctx
}
