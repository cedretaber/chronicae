import type { ResourceKind } from '../types/resource'
import { RESOURCE_KINDS } from '../types/resource'

// v0.55 §5.4 / §6.3: category (NeedCategory / InputCategory) を満たす複数 ResourceKind への比率配分。
//   utility_i = contributionValue_i / smoothedPrice_i
//   share_i  = utility_i^beta / Σ utility_j^beta
//   単一 resource しか持たない category は share 1.0。同点・丸めは RESOURCE_KINDS sorted で deterministic。
//   smoothedPrice 不在時は basePrice fallback (§4.3a) — priceLookup 側で解決する。
export type ResourceShare = {
  resource: ResourceKind
  contributionValue: number
  share: number
}

export function resolveCategoryShares(
  contributions: Partial<Record<ResourceKind, number>>,
  priceLookup: (resource: ResourceKind) => number,
  beta: number,
): ResourceShare[] {
  // RESOURCE_KINDS sorted 順に候補を組み立て determinism を保つ。
  const entries: { resource: ResourceKind; contributionValue: number; utilityPow: number }[] = []
  let totalPow = 0
  for (const resource of RESOURCE_KINDS) {
    const contributionValue = contributions[resource]
    if (contributionValue === undefined || contributionValue <= 0) continue
    const price = priceLookup(resource)
    const utility = price > 0 ? contributionValue / price : 0
    const utilityPow = Math.pow(utility, beta)
    entries.push({ resource, contributionValue, utilityPow })
    totalPow += utilityPow
  }
  if (entries.length === 0) return []
  // utility が全て 0 (価格不正等) の場合は均等配分にフォールバックする。
  if (totalPow <= 0) {
    const eq = 1 / entries.length
    return entries.map((e) => ({
      resource: e.resource,
      contributionValue: e.contributionValue,
      share: eq,
    }))
  }
  return entries.map((e) => ({
    resource: e.resource,
    contributionValue: e.contributionValue,
    share: e.utilityPow / totalPow,
  }))
}
