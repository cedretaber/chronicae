// Detail パネル共通の表示用定数。
// コンポーネントと同居すると react-refresh/only-export-components 警告が出るため
// 非コンポーネント定数はこの .ts に分離する。

/** AbilityRadarChart / 能力表示で使う 6 能力のキー順。 */
export const ABILITY_KEYS = [
  'valor',
  'command',
  'numeracy',
  'learning',
  'charisma',
  'insight',
] as const

/** ShareDonutChart / 株主表示で使う配色パレット。 */
export const SHARE_COLORS = ['#60a5fa', '#f59e0b', '#34d399', '#f87171', '#a78bfa', '#9ca3af']

/**
 * Polity 影響力の二重円: 家グループごとの基準色相 (HSL hue)。
 * 外周リング = 家の支配率 (この色相)、内周リング = 家本体 + メンバーの内訳 (同色相の濃淡)。
 */
export const INFLUENCE_GROUP_HUES = [210, 38, 150, 352, 265, 95] as const

/** 「その他」グループ / 内訳の残余に使う無彩色。 */
export const INFLUENCE_OTHERS_COLOR = '#9ca3af'

/**
 * 影響力リストで個別表示する家グループの下限 (家の支配率%)。
 * これ未満のグループ (小家門・家無し小物) は「その他」に集約する。config 化せず UI 定数で持つ。
 */
export const INFLUENCE_LIST_MIN_GROUP_PERCENT = 3

/** 家グループ i の外周リング色 (家の支配率を表す)。 */
export function influenceGroupColor(i: number): string {
  const h = INFLUENCE_GROUP_HUES[i % INFLUENCE_GROUP_HUES.length]!
  return `hsl(${h}, 60%, 50%)`
}

/**
 * 家グループ i の内訳セグメント (segIndex 番目) の色。
 * 家本体 (segIndex=0) を濃く、メンバーになるほど明るいトーンにして同一家のかたまりを示す。
 */
export function influenceSegmentColor(groupIndex: number, segIndex: number): string {
  const h = INFLUENCE_GROUP_HUES[groupIndex % INFLUENCE_GROUP_HUES.length]!
  const light = Math.min(74, 44 + segIndex * 9)
  return `hsl(${h}, 55%, ${light}%)`
}
