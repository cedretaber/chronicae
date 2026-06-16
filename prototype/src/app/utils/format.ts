import i18next from 'i18next'
import {
  weekToYearMonthWeek,
  getPseudoMonthFromWeek,
  getWeekOfPseudoMonth,
} from '@sim/utils/timeUtils'

const dash = '—'

// UI 共通の時刻表記。時点 (timestamp) を表すものは全てこの「N年M月第W週」形式に揃える。
// 期間・年齢 (「X年前」「残りX年」等) は時点ではないのでこの形式を使わない。
// ns 指定不要 (createI18n の defaultNS = 'ui')。
export function formatYearMonthWeek(year: number, month: number, weekOfMonth: number): string {
  return i18next.t('detail.common.year_month_week', { year, month, week: weekOfMonth })
}

// 絶対週 (createdWeek / deadlineWeek / startedWeek / foundingWeek など) から。
export function formatAbsoluteWeek(absoluteWeek: number): string {
  const { year, month, weekOfMonth } = weekToYearMonthWeek(absoluteWeek)
  return formatYearMonthWeek(year, month, weekOfMonth)
}

// year + weekOfYear のペア (ChronicleEntry / SimEvent など) から。
export function formatYearWeek(year: number, weekOfYear: number): string {
  return formatYearMonthWeek(
    year,
    getPseudoMonthFromWeek(weekOfYear),
    getWeekOfPseudoMonth(weekOfYear),
  )
}

// 年でグルーピング済みの文脈 (timeline の年見出し配下など) で、年を省いた「M月第W週」。
export function formatMonthWeek(weekOfYear: number): string {
  return i18next.t('detail.common.month_week', {
    month: getPseudoMonthFromWeek(weekOfYear),
    week: getWeekOfPseudoMonth(weekOfYear),
  })
}

// 年のみ (週情報を持たない時点。グルーピング見出しなど)。
export function formatYear(year: number): string {
  return i18next.t('detail.common.year_only', { year })
}

export function formatScore(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return dash
  return value.toFixed(1)
}

export function formatAmount(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return dash
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatPower(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return dash
  return value.toFixed(1)
}

export function formatPercent(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return dash
  return `${Math.round(value)}%`
}

export function formatSigned(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return dash
  const formatted = value.toFixed(1)
  return value >= 0 ? `+${formatted}` : formatted
}

const POLITY_RANK_FALLBACK: Record<number, string> = {
  1: 'Empire',
  2: 'Kingdom',
  3: 'Duchy',
  4: 'County',
  5: 'Domain',
}

export function formatPolityRank(rank: number | undefined | null): string {
  if (rank == null) return dash
  if (i18next.isInitialized) {
    const key = `polity_rank.${rank}`
    const translated = i18next.t(key, { ns: 'statuses' })
    if (translated !== key) return translated
  }
  return POLITY_RANK_FALLBACK[rank] ?? `rank ${rank}`
}
