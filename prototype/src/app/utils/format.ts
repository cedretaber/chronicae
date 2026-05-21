import i18next from 'i18next'

const dash = '—'

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
  5: 'Rebel Domain',
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
