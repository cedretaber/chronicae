import type { ResourceKind } from './resource'

// v0.55 §5: NeedTier / NeedCategory。POP は NeedCategory 単位で需要を持ち、市場では
//   ResourceKind の buyOrders へ比率配分する (§5.4)。
export type NeedTier = 'essential' | 'ordinary' | 'luxury'

export type NeedCategory =
  | 'staple_food'
  | 'protein'
  | 'basic_drink'
  | 'basic_fabric'
  | 'clothing'
  | 'fine_food'
  | 'luxury_drink'
  | 'luxury_clothing'
  | 'luxury_goods'

// §5.2: NeedCategory → NeedTier。
export const NEED_CATEGORY_TIER: Record<NeedCategory, NeedTier> = {
  staple_food: 'essential',
  protein: 'essential',
  basic_drink: 'essential',
  basic_fabric: 'essential',
  clothing: 'ordinary',
  fine_food: 'ordinary',
  luxury_drink: 'luxury',
  luxury_clothing: 'luxury',
  luxury_goods: 'luxury',
}

// §5.3 ResourceNeedContribution: 各 NeedCategory を満たす ResourceKind と contributionValue
//   ("1 単位がどれだけ need を満たすか")。加工品は高 contribution で効率の良い選択肢になる (§5.4)。
export const NEED_CATEGORY_CONTRIBUTIONS: Record<
  NeedCategory,
  Partial<Record<ResourceKind, number>>
> = {
  staple_food: { grain: 1.0 },
  protein: { fish: 1.0, meat: 1.0, smoked_fish: 1.5, processed_meat: 1.5 },
  basic_drink: { beer: 1.0 },
  basic_fabric: { fabric: 1.0 },
  clothing: { clothes: 1.0 },
  fine_food: { fruit: 1.0 },
  luxury_drink: { wine: 1.0 },
  luxury_clothing: { luxury_clothes: 1.0 },
  luxury_goods: { jewelry: 1.0 },
}

// determinism: NeedCategory を sorted key 順反復するための列挙。
export const NEED_CATEGORIES: readonly NeedCategory[] = [
  'basic_drink',
  'basic_fabric',
  'clothing',
  'fine_food',
  'luxury_clothing',
  'luxury_drink',
  'luxury_goods',
  'protein',
  'staple_food',
]
