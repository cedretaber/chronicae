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
