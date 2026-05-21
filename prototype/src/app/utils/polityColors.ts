export const POLITY_COLORS = [
  '#3b6ea8',
  '#a83b3b',
  '#3ba87a',
  '#a87e3b',
  '#7a3ba8',
  '#2e8b8b',
  '#b85c8a',
  '#6b8e23',
  '#cd6839',
  '#4682b4',
  '#8b4513',
  '#5f9ea0',
  '#d4a017',
  '#8a2be2',
  '#3cb371',
  '#c04040',
  '#4169e1',
  '#b8860b',
  '#6a5acd',
  '#2e8b57',
  '#d2691e',
  '#7b68ee',
  '#228b22',
  '#b22222',
  '#20b2aa',
]

export const HOUSE_COLORS = [
  '#5d80c4',
  '#c45d5d',
  '#5dc497',
  '#c49a5d',
  '#9a5dc4',
  '#5dc4c4',
  '#c45d97',
  '#b1c45d',
  '#4a9ec4',
  '#c47a5d',
  '#5dc4b1',
  '#c4b15d',
  '#7a5dc4',
  '#5d97c4',
  '#c45d7a',
  '#97c45d',
  '#5d5dc4',
  '#c4975d',
  '#5dc45d',
  '#c45db1',
  '#5db1c4',
  '#b1c4a0',
  '#c46b5d',
  '#6bc45d',
  '#a05dc4',
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
