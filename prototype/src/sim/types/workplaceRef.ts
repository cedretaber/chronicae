import type { RealEstateAssetId, HoldingImprovementId, MerchantCompanyEstablishmentId } from './ids'

// v0.63: POP の雇用主参照。どの施設が POP を雇用しているかを表す tagged union。
//   null = 失業 (どの施設にも紐付いていない)。
//   kind 'asset'       : RealEstateAsset (農地・工房 etc.)
//   kind 'improvement' : HoldingImprovement (鉱山・製材所 etc.)
//   kind 'merchant'    : MerchantCompanyEstablishment (商会拠点)
export type WorkplaceRef =
  | { kind: 'asset'; id: RealEstateAssetId }
  | { kind: 'improvement'; id: HoldingImprovementId }
  | { kind: 'merchant'; id: MerchantCompanyEstablishmentId }

// WorkplaceRef を merge key 用の文字列に変換する。null → 'none'。
export function workplaceRefKey(ref: WorkplaceRef | null): string {
  if (ref === null) return 'none'
  return `${ref.kind}:${ref.id as string}`
}

// POP が雇用されているかどうかを返す (employerId !== null)。
export function isEmployed(pop: { employerId: WorkplaceRef | null }): boolean {
  return pop.employerId !== null
}
