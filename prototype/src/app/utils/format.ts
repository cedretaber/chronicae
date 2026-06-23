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

// v0.56 UI: POP の「size」は抽象単位。規模感を出すため UI 上は一律 ×POP_DISPLAY_SCALE で表示する。
// これは純粋な表示スケールで sim 値・balance には一切影響しない。対象は頭数・雇用枠・流動量のみで、
// wealth / unrest / 比率(%) / money / 資源 / manpower はスケールしない (それらは別単位/示強量)。
export const POP_DISPLAY_SCALE = 100

// 頭数・雇用枠 (size / capacity / employed / unemployed / population): 整数・千区切り。
export function formatPopCount(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return dash
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    value * POP_DISPLAY_SCALE,
  )
}

// 流動量 (移住・昇格・降格・転職): 小さい値の比較のため小数1桁を残す。
export function formatPopFlow(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return dash
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value * POP_DISPLAY_SCALE)
}

// v0.59: 人口の純変動 (符号付き)。正は「+」、負は「−」(U+2212) を明示し、流動量と同じ小数1桁。
//   符号は「表示精度に丸めた後」の値で判定し、−0.0 のような微小負値の符号付き表示を避ける。
export function formatPopDelta(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return dash
  const scaled = value * POP_DISPLAY_SCALE
  const rounded = Math.round(scaled * 10) / 10
  const abs = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(scaled))
  if (rounded > 0) return `+${abs}`
  if (rounded < 0) return `−${abs}`
  return abs
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
