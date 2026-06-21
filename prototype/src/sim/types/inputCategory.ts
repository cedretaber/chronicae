import type { ResourceKind } from './resource'

// v0.55 §6 InputCategory: recipe の input は具体 ResourceKind ではなく category 参照で持つ。
//   市場 buyOrders へ展開する際に、category を満たす ResourceKind 群へ比率配分する (§6.3)。
//   これにより将来、同 category へ高効率代替材 (steel/lumber 等) を追加しても recipe を壊さない。
export type InputCategory =
  | 'brewing_grain'
  | 'textile_fiber'
  | 'fabric'
  | 'dye_material'
  | 'luxury_trim'
  | 'metal'
  | 'construction_wood'
  | 'construction_stone'
  | 'construction_tools'
  | 'gems'
  | 'raw_fish'
  | 'raw_meat'

// §6.2 InputCategoryContribution: 各 category を満たす ResourceKind と「1 単位がどれだけ
//   category を満たすか」(contributionValue)。fulfillment / buyOrders 変換に使う (§6.3)。
export const INPUT_CATEGORY_CONTRIBUTIONS: Record<
  InputCategory,
  Partial<Record<ResourceKind, number>>
> = {
  brewing_grain: { grain: 1.0 },
  textile_fiber: { flax: 0.9, wool: 1.0 },
  fabric: { fabric: 1.0 },
  dye_material: { dye: 1.0 },
  luxury_trim: { fur: 1.0 },
  metal: { iron_ore: 1.0 },
  construction_wood: { timber: 1.0 },
  construction_stone: { stone: 1.0 },
  construction_tools: { tools: 1.0 },
  gems: { gems: 1.0 },
  raw_fish: { fish: 1.0 },
  raw_meat: { meat: 1.0 },
}

// determinism: category を sorted key 順反復するための列挙。
export const INPUT_CATEGORIES: readonly InputCategory[] = [
  'brewing_grain',
  'construction_stone',
  'construction_tools',
  'construction_wood',
  'dye_material',
  'fabric',
  'gems',
  'luxury_trim',
  'metal',
  'raw_fish',
  'raw_meat',
  'textile_fiber',
]
