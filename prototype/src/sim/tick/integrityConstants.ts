import { ABILITY_KEYS } from '../constants/abilityConstants'
import { IMPROVEMENT_DEFINITIONS } from '../config/improvementDefinitions'

// integritySystem の collectIntegrityErrors を domain 別ファイルへ分割した際に
// 複数 domain (Core / Geography / Goals) から参照される妥当値セットを集約する。
export const VALID_ABILITY_KEYS: ReadonlySet<string> = new Set(ABILITY_KEYS)

// v0.33 §5.3: IMPROVEMENT_DEFINITIONS のキーから導出し二重管理を解消
export const VALID_HOLDING_IMPROVEMENT_KINDS: ReadonlySet<string> = new Set(
  Object.keys(IMPROVEMENT_DEFINITIONS),
)

// v0.33 §13.1: Province terrain / features の妥当性検証
export const VALID_PROVINCE_TERRAINS: ReadonlySet<string> = new Set([
  'plains',
  'forest',
  'hills',
  'mountains',
  'wetlands',
])

export const VALID_PROVINCE_FEATURES: ReadonlySet<string> = new Set([
  'coastal',
  'major_river',
  'lake',
])
