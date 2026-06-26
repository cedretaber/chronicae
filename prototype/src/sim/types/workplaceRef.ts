import type {
  RealEstateAssetId,
  HoldingImprovementId,
  MerchantCompanyEstablishmentId,
  RegimentBarracksId,
} from './ids'

export type WorkplaceRef =
  | { kind: 'asset'; id: RealEstateAssetId }
  | { kind: 'improvement'; id: HoldingImprovementId }
  | { kind: 'merchant'; id: MerchantCompanyEstablishmentId }
  | { kind: 'barracks'; id: RegimentBarracksId }

// WorkplaceRef を merge key 用の文字列に変換する。null → 'none'。
export function workplaceRefKey(ref: WorkplaceRef | null): string {
  if (ref === null) return 'none'
  return `${ref.kind}:${ref.id as string}`
}

// POP が雇用されているかどうかを返す (employerId !== null)。
export function isEmployed(pop: { employerId: WorkplaceRef | null }): boolean {
  return pop.employerId !== null
}
