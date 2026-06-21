import type { PopType } from '../types/popGroup'
import type { NeedCategory } from '../types/needCategory'

// v0.55 §15.2 PopNeedProfile: PopType ごとの NeedCategory 別 size あたり月次需要 (amountPerPop)。
//   wealth による購買力補正は NeedTier ごとに別途掛ける (§15.3)。数値は初期値 (150 年で調整)。
//   列順: staple_food / protein / basic_drink / basic_clothing / fine_food /
//         luxury_drink / luxury_clothing / luxury_goods。
export type PopNeedProfile = Record<NeedCategory, number>

function profile(
  staple_food: number,
  protein: number,
  basic_drink: number,
  basic_clothing: number,
  fine_food: number,
  luxury_drink: number,
  luxury_clothing: number,
  luxury_goods: number,
): PopNeedProfile {
  return {
    staple_food,
    protein,
    basic_drink,
    basic_clothing,
    fine_food,
    luxury_drink,
    luxury_clothing,
    luxury_goods,
  }
}

export const POP_NEED_PROFILES: Record<PopType, PopNeedProfile> = {
  // lower
  laborers: profile(1.0, 0.15, 0.45, 0.12, 0.0, 0.0, 0.0, 0.0),
  peasants: profile(1.0, 0.12, 0.4, 0.1, 0.0, 0.0, 0.0, 0.0),
  artisans: profile(0.9, 0.2, 0.45, 0.18, 0.03, 0.0, 0.0, 0.0),
  scribes: profile(0.85, 0.2, 0.35, 0.18, 0.04, 0.0, 0.0, 0.0),
  soldiers: profile(1.15, 0.3, 0.55, 0.15, 0.0, 0.0, 0.0, 0.0),
  // middle
  freeholders: profile(1.05, 0.25, 0.45, 0.18, 0.08, 0.03, 0.0, 0.0),
  masters: profile(0.95, 0.3, 0.45, 0.22, 0.1, 0.05, 0.0, 0.0),
  merchants: profile(0.95, 0.35, 0.4, 0.24, 0.15, 0.1, 0.02, 0.04),
  bureaucrats: profile(0.9, 0.3, 0.35, 0.22, 0.12, 0.08, 0.02, 0.03),
  ministeriales: profile(1.0, 0.4, 0.45, 0.25, 0.15, 0.1, 0.04, 0.04),
  // upper
  nobles: profile(1.0, 0.5, 0.45, 0.25, 0.25, 0.2, 0.12, 0.08),
  patricians: profile(0.95, 0.45, 0.4, 0.25, 0.25, 0.2, 0.14, 0.1),
}
