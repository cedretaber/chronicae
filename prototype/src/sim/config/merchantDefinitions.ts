import type { PopType } from '../types/popGroup'
import type { MerchantEstablishmentKind } from '../types/merchant'

// v0.61 商会施設の構造的テーブル (realEstateDefinitions / improvementDefinitions と同位置)。
//   tunable な rate / throughput / grace 等は defaultConfig (§23) 側に置く。

// 施設の popType 別雇用枠 (level 1 あたり)。実際の枠 = この値 × establishment.level。
//   本店: patricians:merchants:scribes:laborers = 1:3:3:3 (§11.1)
//   支店: merchants:scribes:laborers = 2:2:2
export const MERCHANT_EMPLOYMENT_SLOTS_PER_LEVEL: Record<
  MerchantEstablishmentKind,
  Partial<Record<PopType, number>>
> = {
  headquarters: { patricians: 1, merchants: 3, scribes: 3, laborers: 3 },
  branch: { merchants: 2, scribes: 2, laborers: 2 },
}

// 施設が level 1 あたり提供する popType 別雇用枠。dormant/closed では 0 (呼び出し側で status 判定)。
export function getMerchantEstablishmentEmploymentSlots(
  kind: MerchantEstablishmentKind,
  popType: PopType,
  level: number,
): number {
  const perLevel = MERCHANT_EMPLOYMENT_SLOTS_PER_LEVEL[kind][popType] ?? 0
  return perLevel * Math.max(0, level)
}
