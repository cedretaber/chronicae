import type { WorldState } from '../types/world'
import type { HoldingId } from '../types/ids'
import type { HoldingImprovementKind } from '../types/holdingImprovement'

export function damageHoldingImprovementConditionMut(
  ws: WorldState,
  holdingId: HoldingId,
  drop: number,
  targetKinds?: readonly HoldingImprovementKind[],
): void {
  const improvementIds = ws.holdingImprovementIndex.byHolding[holdingId]
  if (!improvementIds) return
  for (const impId of improvementIds) {
    const imp = ws.holdingImprovements[impId]
    if (!imp) continue
    if (targetKinds && !targetKinds.includes(imp.kind)) continue
    const newCondition = Math.max(0, imp.condition - drop)
    if (newCondition !== imp.condition) {
      ws.holdingImprovements[impId] = { ...imp, condition: newCondition }
    }
  }
}
