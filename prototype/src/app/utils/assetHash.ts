import type { ProvinceTerrain, ProvinceFeature } from '@sim/types/province'
import type { HoldingKind } from '@sim/types/landContract'
import type { HoldingImprovementKind } from '@sim/types/holdingImprovement'

// Province ヘッダー画像（terrain 5 × 水状態 4 = 20）。
import provincePlain from '@/assets/province/province_plain.png'
import provincePlainRiver from '@/assets/province/province_plain_river.png'
import provincePlainCoast from '@/assets/province/province_plain_coast.png'
import provincePlainCoastRiver from '@/assets/province/province_plain_coast_river.png'
import provinceForest from '@/assets/province/province_forest.png'
import provinceForestRiver from '@/assets/province/province_forest_river.png'
import provinceForestCoast from '@/assets/province/province_forest_coast.png'
import provinceForestCoastRiver from '@/assets/province/province_forest_coast_river.png'
import provinceHill from '@/assets/province/province_hill.png'
import provinceHillRiver from '@/assets/province/province_hill_river.png'
import provinceHillCoast from '@/assets/province/province_hill_coast.png'
import provinceHillCoastRiver from '@/assets/province/province_hill_coast_river.png'
import provinceMountain from '@/assets/province/province_mountain.png'
import provinceMountainRiver from '@/assets/province/province_mountain_river.png'
import provinceMountainCoast from '@/assets/province/province_mountain_coast.png'
import provinceMountainCoastRiver from '@/assets/province/province_mountain_coast_river.png'
import provinceWetland from '@/assets/province/province_wetland.png'
import provinceWetlandRiver from '@/assets/province/province_wetland_river.png'
import provinceWetlandCoast from '@/assets/province/province_wetland_coast.png'
import provinceWetlandCoastRiver from '@/assets/province/province_wetland_coast_river.png'

// Holding ヘッダー画像（manor 2 + city 4 = 6）。
import holdingManorWheat from '@/assets/holding/holding_manor_wheat.png'
import holdingManorPasture from '@/assets/holding/holding_manor_pasture.png'
import holdingCitySmall from '@/assets/holding/holding_city_small.png'
import holdingCityMarket from '@/assets/holding/holding_city_market.png'
import holdingCityWorkshops from '@/assets/holding/holding_city_workshops.png'
import holdingCityLarge from '@/assets/holding/holding_city_large.png'

/**
 * v0.33: terrain → ファイル名 tag の対応（sim enum は複数形、アセットは単数形）。
 * forest のみ同名。
 */
const TERRAIN_TAG: Record<ProvinceTerrain, string> = {
  plains: 'plain',
  forest: 'forest',
  hills: 'hill',
  mountains: 'mountain',
  wetlands: 'wetland',
}

/** `${terrainTag}${waterTag}` → 画像。waterTag ∈ '' | '_river' | '_coast' | '_coast_river'。 */
const PROVINCE_IMAGES: Record<string, string> = {
  plain: provincePlain,
  plain_river: provincePlainRiver,
  plain_coast: provincePlainCoast,
  plain_coast_river: provincePlainCoastRiver,
  forest: provinceForest,
  forest_river: provinceForestRiver,
  forest_coast: provinceForestCoast,
  forest_coast_river: provinceForestCoastRiver,
  hill: provinceHill,
  hill_river: provinceHillRiver,
  hill_coast: provinceHillCoast,
  hill_coast_river: provinceHillCoastRiver,
  mountain: provinceMountain,
  mountain_river: provinceMountainRiver,
  mountain_coast: provinceMountainCoast,
  mountain_coast_river: provinceMountainCoastRiver,
  wetland: provinceWetland,
  wetland_river: provinceWetlandRiver,
  wetland_coast: provinceWetlandCoast,
  wetland_coast_river: provinceWetlandCoastRiver,
}

/**
 * Province ヘッダー画像を terrain と水の有無から決定する。
 * 沿岸（coastal）と河川（major_river | lake）は独立軸。両方無ければ terrain ベース。
 */
export function getProvinceImage(
  terrain: ProvinceTerrain,
  features: ReadonlyArray<ProvinceFeature>,
): string {
  const terrainTag = TERRAIN_TAG[terrain]
  const hasCoast = features.includes('coastal')
  const hasRiver = features.includes('major_river') || features.includes('lake')
  const waterTag =
    hasCoast && hasRiver ? '_coast_river' : hasCoast ? '_coast' : hasRiver ? '_river' : ''
  // フォールバック: 万一キーが無ければ terrain ベースへ。
  return PROVINCE_IMAGES[`${terrainTag}${waterTag}`] ?? PROVINCE_IMAGES[terrainTag]!
}

type HoldingImprovementSummary = {
  kind: HoldingImprovementKind
  level: number
}

/**
 * Holding ヘッダー画像を kind と代表設備から決定する。
 *
 * - 荘園: 牧畜（pastoral）の level が農地系（field_system | irrigation）の最大 level を
 *   上回るときのみ pasture、それ以外は wheat（農地が荘園の既定。設備なしも農地扱い）。
 * - 都市: market と workshop の両方あり → large、market のみ → market、
 *   workshop のみ → workshops、どちらも無し → small。
 * - storage / transport（生産品質系）は見た目を支配しないため判定に使わない。
 */
export function getHoldingImage(
  kind: HoldingKind,
  improvements: ReadonlyArray<HoldingImprovementSummary>,
): string {
  const levelOf = (k: HoldingImprovementKind): number =>
    improvements.find((imp) => imp.kind === k && imp.level >= 1)?.level ?? 0

  if (kind === 'manor') {
    const hasIrrigation = levelOf('irrigation_infrastructure') >= 1
    return hasIrrigation ? holdingManorWheat : holdingManorPasture
  }

  const hasMarket = levelOf('market_infrastructure') >= 1
  const hasWorkshop = levelOf('workshop_infrastructure') >= 1
  if (hasMarket && hasWorkshop) return holdingCityLarge
  if (hasMarket) return holdingCityMarket
  if (hasWorkshop) return holdingCityWorkshops
  return holdingCitySmall
}
