import type { WorldState } from '../types/world'
import type { RegimentBarracksId, HoldingId } from '../types/ids'
import type { PopType } from '../types/popGroup'
import { workplaceRefKey } from '../types/workplaceRef'
import { removePopGroupMut } from './popMutations'

// Find and reduce size of POPs in a holding that are bound to a specific barracks and popType.
// Reduces money proportionally (per-capita preservation).
// Removes the pop group if size reaches 0.
// Returns actual amount reduced.
export function reduceBarracksPopSizeMut(
  ws: WorldState,
  holdingId: HoldingId,
  barracksId: RegimentBarracksId,
  popType: PopType,
  amount: number,
): number {
  if (amount <= 0) return 0

  const barracksKey = workplaceRefKey({ kind: 'barracks', id: barracksId })
  const popIds = ws.popIndex.byHolding[holdingId]
  if (!popIds) return 0

  let totalReduced = 0

  for (const popId of popIds) {
    const pop = ws.popGroups[popId]
    if (!pop) continue
    if (pop.popType !== popType) continue
    if (workplaceRefKey(pop.employerId) !== barracksKey) continue

    const oldSize = pop.size
    const actualReduce = Math.min(amount - totalReduced, oldSize)
    if (actualReduce <= 0) break

    const newSize = oldSize - actualReduce

    if (newSize <= 0) {
      removePopGroupMut(ws, popId)
    } else {
      ws.popGroups[popId] = {
        ...pop,
        size: newSize,
        money: oldSize > 0 ? pop.money * (newSize / oldSize) : 0,
      }
    }

    totalReduced += actualReduce
    break // only one pop group per merge key (holdingId + popType + employerId)
  }

  return totalReduced
}

// Apply battle casualties to POPs in a barracks based on strength damage.
// For each popType in barracks.requiredByPopType, kills required * (strengthDamage / 100) POPs.
// local_levy (empty requiredByPopType) → no-op.
export function applyBarracksCasualtyMut(
  ws: WorldState,
  barracksId: RegimentBarracksId,
  strengthDamage: number,
): void {
  if (strengthDamage <= 0) return

  const barracks = ws.regimentBarracks[barracksId]
  if (!barracks) return

  const fraction = strengthDamage / 100
  for (const [popTypeKey, required] of Object.entries(barracks.requiredByPopType)) {
    if (required === undefined || required <= 0) continue
    const popType = popTypeKey as PopType
    const deathAmount = required * fraction
    reduceBarracksPopSizeMut(ws, barracks.holdingId, barracksId, popType, deathAmount)
  }
}
