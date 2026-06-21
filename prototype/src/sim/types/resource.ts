// v0.55 資源経済: 資源種別を 21 種へ細分化 (§4)。
//   v0.54 の food/raw_materials/processed_goods 3 種から、具体的な商品経済へ拡張する。
export type ResourceKind =
  // 消費財 (食料・飲料)
  | 'grain'
  | 'fish'
  | 'meat'
  | 'fruit'
  | 'beer'
  | 'wine'
  // 原材料
  | 'flax'
  | 'wool'
  | 'timber'
  | 'stone'
  | 'iron_ore'
  | 'fur'
  | 'gems'
  | 'dye'
  // 加工品
  | 'tools'
  | 'fabric'
  | 'clothes'
  | 'luxury_clothes'
  | 'jewelry'
  | 'smoked_fish'
  | 'processed_meat'

// 全 ResourceKind を sorted key 順反復するための列挙 (determinism §4.1)。
// ResourceEconomySystem は market ごとに resource を跨いで集計するため、反復順を固定する。
export const RESOURCE_KINDS: readonly ResourceKind[] = [
  'beer',
  'clothes',
  'dye',
  'fabric',
  'fish',
  'flax',
  'fruit',
  'fur',
  'gems',
  'grain',
  'iron_ore',
  'jewelry',
  'luxury_clothes',
  'meat',
  'processed_meat',
  'smoked_fish',
  'stone',
  'timber',
  'tools',
  'wine',
  'wool',
]
