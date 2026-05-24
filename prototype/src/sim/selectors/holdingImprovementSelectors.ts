import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId } from '../types/ids'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import { clamp } from '../utils/math'

export function getHoldingDevelopment(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): number {
  const improvementIds = state.holdingImprovementIndex.byHolding[holdingId as string]
  if (!improvementIds || improvementIds.length === 0) return 0

  let development = 0
  for (const impId of improvementIds) {
    const imp = state.holdingImprovements[impId]
    if (!imp) continue
    const score = config.holdingImprovementDevelopmentScorePerLevel[imp.kind]
    if (score !== undefined) {
      development += imp.level * score
    }
  }
  return development
}

export function getHoldingDevelopmentModifier(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): number {
  const development = getHoldingDevelopment(state, config, holdingId)
  return clamp(1.0 + development / 150, 0.75, 1.75)
}

export function getHoldingImprovementLevel(
  state: WorldState,
  holdingId: HoldingId,
  kind: HoldingImprovementKind,
): number {
  const improvementIds = state.holdingImprovementIndex.byHolding[holdingId as string]
  if (!improvementIds) return 0
  for (const impId of improvementIds) {
    const imp = state.holdingImprovements[impId]
    if (imp && imp.kind === kind) return imp.level
  }
  return 0
}
