import type { TickContext } from './context'
import type { HouseId } from '../types/ids'
import { extinctHouse } from '../mutations/worldStructureMutations'
import { getHousePolityIds } from '../selectors/polityRelations'

export function extinctHouseAfterFailedSuccession(ctx: TickContext, houseId: HouseId): TickContext {
  // v0.15 §22.3: 所領喪失前の Polity 集合をスナップショット
  const affectedCountryIds = getHousePolityIds(ctx.state, houseId)
  const result = extinctHouse(ctx, { houseId, affectedCountryIds })
  if (!result.ok) return ctx
  return result.value.ctx
}
