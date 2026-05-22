export const WEEKS_PER_YEAR = 48
export const WEEKS_PER_PSEUDO_MONTH = 4
export const WEEKS_PER_SEASON = 12

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
  if (weekOfYear <= 12) return 'spring'
  if (weekOfYear <= 24) return 'summer'
  if (weekOfYear <= 36) return 'autumn'
  return 'winter'
}

export type SeasonPhase = 'early' | 'mid' | 'late'

export function getSeasonPhase(weekOfYear: number): SeasonPhase {
  const weekInSeason = ((weekOfYear - 1) % WEEKS_PER_SEASON) + 1
  if (weekInSeason <= 4) return 'early'
  if (weekInSeason <= 8) return 'mid'
  return 'late'
}

export function getPseudoMonthFromWeek(weekOfYear: number): number {
  return Math.floor((weekOfYear - 1) / WEEKS_PER_PSEUDO_MONTH) + 1
}

export function getWeekOfPseudoMonth(weekOfYear: number): number {
  return ((weekOfYear - 1) % WEEKS_PER_PSEUDO_MONTH) + 1
}

export function weekToYearMonthWeek(absoluteWeek: number): {
  year: number
  month: number
  weekOfMonth: number
} {
  const { year, weekOfYear } = weekToYearWeek(absoluteWeek)
  return {
    year,
    month: getPseudoMonthFromWeek(weekOfYear),
    weekOfMonth: getWeekOfPseudoMonth(weekOfYear),
  }
}
