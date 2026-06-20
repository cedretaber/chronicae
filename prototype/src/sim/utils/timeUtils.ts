export const WEEKS_PER_YEAR = 48
const WEEKS_PER_PSEUDO_MONTH = 4
// v0.54: 1年=48週=12擬似月。月次 (4週) 値を年額換算する際に使う。
export const MONTHS_PER_YEAR = WEEKS_PER_YEAR / WEEKS_PER_PSEUDO_MONTH

function weekToYearWeek(absoluteWeek: number): {
  year: number
  weekOfYear: number
} {
  return {
    year: Math.floor(absoluteWeek / WEEKS_PER_YEAR),
    weekOfYear: (absoluteWeek % WEEKS_PER_YEAR) + 1,
  }
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
