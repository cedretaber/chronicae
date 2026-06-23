import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId } from '../types/ids'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import { IMPROVEMENT_DEFINITIONS } from '../config/improvementDefinitions'
import { IMPROVEMENT_BOOSTED_REAL_ESTATE_KINDS } from '../config/resourceEconomyDefinitions'
import { getHoldingProducedResourcesByAssetKind } from './resourceProductionSelectors'
import { getResourceBottleneckSeverity } from './resourceRevenueSelectors'
import {
  canBuildHoldingImprovement,
  getHoldingImprovementLevel,
} from './holdingImprovementSelectors'

// v0.59 追補③: 「ボトルネック資源 (市場 shortage または食料 pressure) を生産し、その生産を boost する
//   buildable な production_quality 改良がある」場合に、その改良 kind を返す (汎用)。capacity 増設より
//   優先すべき状況の検出。複数候補は severity 最大 → level 最小 → kind 名昇順で決定的に選ぶ。RNG 非消費。
//   aim 候補生成 (goalSelectors) と project 種別決定 (taskProjectCompletion) の双方が使う。
export function selectProductivityImprovementForBottleneck(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): HoldingImprovementKind | undefined {
  const holding = ws.holdings[holdingId]
  if (!holding) return undefined
  const province = ws.provinces[holding.provinceId]
  if (!province) return undefined
  const stateId = province.stateId

  const producedByKind = getHoldingProducedResourcesByAssetKind(ws, holdingId)
  if (producedByKind.size === 0) return undefined

  const threshold = config.bottleneckShortageSeverityThreshold
  let best: { kind: HoldingImprovementKind; severity: number; level: number } | undefined
  for (const kind of Object.keys(IMPROVEMENT_DEFINITIONS) as HoldingImprovementKind[]) {
    if (IMPROVEMENT_DEFINITIONS[kind].capacityRole !== 'production_quality') continue
    if (!canBuildHoldingImprovement(ws, config, holdingId, kind)) continue
    const boostedKinds = IMPROVEMENT_BOOSTED_REAL_ESTATE_KINDS[kind]
    if (!boostedKinds) continue
    // この改良が boost する asset 種別のうち holding に存在するものの産出資源で、ボトルネック度の最大値。
    let maxSeverity = 0
    for (const reKind of boostedKinds) {
      const resources = producedByKind.get(reKind)
      if (!resources) continue
      for (const r of resources) {
        const sev = getResourceBottleneckSeverity(ws, config, province.id, stateId, r)
        if (sev > maxSeverity) maxSeverity = sev
      }
    }
    if (maxSeverity < threshold) continue
    const level = getHoldingImprovementLevel(ws, holdingId, kind)
    if (
      !best ||
      maxSeverity > best.severity ||
      (maxSeverity === best.severity && level < best.level) ||
      (maxSeverity === best.severity && level === best.level && kind < best.kind)
    ) {
      best = { kind, severity: maxSeverity, level }
    }
  }
  return best?.kind
}
