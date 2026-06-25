import type { RealEstateKind } from '../types/realEstateAsset'
import type { HoldingKind } from '../types/landContract'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { PopType } from '../types/popGroup'

// v0.57 §雇用細分化: employment slot を PopType 単位で持つ (施設駆動の職能構成)。
//   capacityPerLevel は施設容量 × その PopType の構成比を事前計算した値。
//   stratum は getPopStratum(popType) で導出 (容量セレクタが stratum 集計に使う)。
//   maxRatioTo: 熟練職 (親方/自作農) の「同数上限」。主要職能の実雇用数 × ratio を雇用上限とする
//     (主要職能が労働力不足で埋まらないとき補助職能を実数までキャップする動的制限 §雇用細分化)。
export type RealEstateEmploymentSlot = {
  popType: PopType
  capacityPerLevel: number
  maxRatioTo?: { popType: PopType; ratio: number }
}

export type RealEstateInfrastructureModifier = {
  infraKind: import('../types/holdingImprovement').HoldingImprovementKind
  modifierPerLevel: number
}

export type RealEstateDefinition = {
  realEstateKind: RealEstateKind
  allowedHoldingKinds: HoldingKind[]
  allowedTerrains?: ProvinceTerrain[]
  requiredAnyFeatures?: ProvinceFeature[]
  maxLevelByHoldingKind: Partial<Record<HoldingKind, number>>
  employmentSlots: RealEstateEmploymentSlot[]
  developmentScorePerLevel: number
}

// v0.57 §雇用細分化: 4 kind 定義。employmentSlots は施設駆動の PopType 構成 (比率を容量へ展開)。
//   slot[0] は primary producer (production の primaryClass 導出に使う)。
//   allowedTerrains が RealEstateKind 単位の terrain gate
//   (recipe 側 terrain gate §8.1 は型のみで enforce しないのと混同しない)。
export const REAL_ESTATE_DEFINITIONS: Record<RealEstateKind, RealEstateDefinition> = {
  farm: {
    realEstateKind: 'farm',
    // v0.55: 一次産業 (農園/鉱山/林地) は荘園 holding のみ。都市は工房専業とする。
    allowedHoldingKinds: ['manor'],
    // v0.59: 農園はどこでも作れる。山岳は容量倍率 0.25 (realEstateTerrainCapacityMultiplier)
    //   で「土地が狭く雇用が少ない」を表現する。World 単位の地形保証で山岳偏重 state が
    //   生じても食料生産が >0 になる安全弁を兼ねる。
    allowedTerrains: ['plains', 'wetlands', 'hills', 'forest', 'mountains'],
    maxLevelByHoldingKind: { manor: 3 },
    // 農園: 小作農:自作農 = 7:3 (total 50)。自作農は小作農と同数まで。
    employmentSlots: [
      { popType: 'peasants', capacityPerLevel: 35 },
      {
        popType: 'freeholders',
        capacityPerLevel: 15,
        maxRatioTo: { popType: 'peasants', ratio: 1 },
      },
    ],
    developmentScorePerLevel: 3,
  },
  mountain: {
    realEstateKind: 'mountain',
    allowedHoldingKinds: ['manor'],
    allowedTerrains: ['mountains', 'hills'],
    maxLevelByHoldingKind: { manor: 3 },
    // 鉱山: 労働者:書記:家士 = 8:1:1 (total 35)。
    employmentSlots: [
      { popType: 'laborers', capacityPerLevel: 28 },
      { popType: 'scribes', capacityPerLevel: 3.5 },
      { popType: 'ministeriales', capacityPerLevel: 3.5 },
    ],
    developmentScorePerLevel: 3,
  },
  woodland: {
    realEstateKind: 'woodland',
    allowedHoldingKinds: ['manor'],
    allowedTerrains: ['forest', 'hills'],
    maxLevelByHoldingKind: { manor: 3 },
    // 山林: 労働者:書記:家士 = 8:1:1 (total 40)。
    employmentSlots: [
      { popType: 'laborers', capacityPerLevel: 32 },
      { popType: 'scribes', capacityPerLevel: 4 },
      { popType: 'ministeriales', capacityPerLevel: 4 },
    ],
    developmentScorePerLevel: 3,
  },
  workshop: {
    realEstateKind: 'workshop',
    allowedHoldingKinds: ['city'],
    maxLevelByHoldingKind: { city: 3 },
    // 工房: 職人:親方:書記 = 6:3:1 (total 50)。親方は職人と同数まで。
    // 生産性が農村の 2 倍以上あるため、雇用人数は farm と同等に抑える。
    employmentSlots: [
      { popType: 'artisans', capacityPerLevel: 30 },
      { popType: 'masters', capacityPerLevel: 15, maxRatioTo: { popType: 'artisans', ratio: 1 } },
      { popType: 'scribes', capacityPerLevel: 5 },
    ],
    developmentScorePerLevel: 4,
  },
}

// v0.57 §雇用細分化: PopType → 同数上限 (refPopType, ratio) の導出マップ。
//   熟練職 (親方→職人 / 自作農→小作農) の雇用上限を rebalance が動的に適用する。
export const POP_TYPE_MAX_RATIO: Partial<Record<PopType, { popType: PopType; ratio: number }>> =
  (() => {
    const m: Partial<Record<PopType, { popType: PopType; ratio: number }>> = {}
    for (const kind of Object.keys(REAL_ESTATE_DEFINITIONS) as RealEstateKind[]) {
      for (const slot of REAL_ESTATE_DEFINITIONS[kind].employmentSlots) {
        if (slot.maxRatioTo) m[slot.popType] = slot.maxRatioTo
      }
    }
    return m
  })()
