export const COUNTRY_COLORS = ['#3b6ea8', '#a83b3b', '#3ba87a', '#a87e3b', '#7a3ba8']

export function buildCountryColorMap(countryIds: string[]): Record<string, string> {
  const sorted = [...countryIds].sort()
  const map: Record<string, string> = {}
  for (let i = 0; i < sorted.length; i++) {
    const id = sorted[i]
    if (id === undefined) continue
    const color = COUNTRY_COLORS[i % COUNTRY_COLORS.length]
    if (color === undefined) continue
    map[id] = color
  }
  return map
}
