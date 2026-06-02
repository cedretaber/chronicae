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
