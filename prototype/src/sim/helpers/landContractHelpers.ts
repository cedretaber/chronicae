import type { PolityRank } from '../types/polity'

export function defaultTaxRateByRank(rank: PolityRank): number {
  switch (rank) {
    case 1:
      return 0
    case 2:
      return 0
    case 3:
      return 0.2
    case 4:
      return 0.3
    case 5:
      return 0.25
  }
}

export function clampTaxRate(rate: number): number {
  if (rate < 0) return 0
  if (rate > 1) return 1
  return rate
}
