export const POLITY_COLORS = ['#3b6ea8', '#a83b3b', '#3ba87a', '#a87e3b', '#7a3ba8']

export const HOUSE_COLORS = [
  '#5d80c4',
  '#c45d5d',
  '#5dc497',
  '#c49a5d',
  '#9a5dc4',
  '#5dc4c4',
  '#c45d97',
  '#b1c45d',
]

export function buildPolityColorMap(polityIds: string[]): Record<string, string> {
  const sorted = [...polityIds].sort()
  const map: Record<string, string> = {}
  for (let i = 0; i < sorted.length; i++) {
    const id = sorted[i]
    if (id === undefined) continue
    const color = POLITY_COLORS[i % POLITY_COLORS.length]
    if (color === undefined) continue
    map[id] = color
  }
  return map
}

export function buildHouseColorMap(houseIds: string[]): Record<string, string> {
  const sorted = [...houseIds].sort()
  const map: Record<string, string> = {}
  for (let i = 0; i < sorted.length; i++) {
    const id = sorted[i]
    if (id === undefined) continue
    const color = HOUSE_COLORS[i % HOUSE_COLORS.length]
    if (color === undefined) continue
    map[id] = color
  }
  return map
}

function clamp01(v: number): number {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

export function unrestToColor(value: number): string {
  const v = clamp01(value)
  const sat = Math.round(20 + v * 70)
  const light = Math.round(70 - v * 35)
  return `hsl(0, ${sat}%, ${light}%)`
}
