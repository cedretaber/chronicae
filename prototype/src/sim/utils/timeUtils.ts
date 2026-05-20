export const WEEKS_PER_YEAR = 52
export const WEEKS_PER_PSEUDO_MONTH = 4
export const WEEKS_PER_SEASON = 13

export function weekToYearWeek(absoluteWeek: number): {
  year: number
  weekOfYear: number
} {
  return {
    year: Math.floor(absoluteWeek / WEEKS_PER_YEAR),
    weekOfYear: (absoluteWeek % WEEKS_PER_YEAR) + 1,
  }
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export function getSeason(weekOfYear: number): Season {
  if (weekOfYear <= 13) return 'spring'
  if (weekOfYear <= 26) return 'summer'
  if (weekOfYear <= 39) return 'autumn'
  return 'winter'
}

export type SeasonPhase = 'early' | 'mid' | 'late'

export function getSeasonPhase(weekOfYear: number): SeasonPhase {
  const weekInSeason = ((weekOfYear - 1) % 13) + 1
  if (weekInSeason <= 4) return 'early'
  if (weekInSeason <= 9) return 'mid'
  return 'late'
}

export function getPseudoMonthFromWeek(weekOfYear: number): number {
  return Math.floor((weekOfYear - 1) / WEEKS_PER_PSEUDO_MONTH) + 1
}
