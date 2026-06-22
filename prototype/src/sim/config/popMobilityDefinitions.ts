import type { PopType, PopStratum } from '../types/popGroup'
import { getPopStratum } from '../types/popGroup'
import type { PopMobilityKind } from '../types/popMobility'

// v0.56 §4: PopType 間の許可遷移。数値バランス (rate/threshold/cap) は config、
//   「どの PopType→PopType が意味的に許されるか」はこのデータ定義に置く。
//   kind (lateral/promotion/demotion) は §4.3 の stratum 順序から導出する。

const STRATUM_ORDER: Record<PopStratum, number> = { lower: 0, middle: 1, upper: 2 }

// §4.2 lateral: 同一 stratum 内の職種変更 (双方向)。
const LATERAL_PAIRS: ReadonlyArray<readonly [PopType, PopType]> = [
  ['laborers', 'peasants'],
  ['laborers', 'artisans'],
  ['artisans', 'scribes'],
  ['soldiers', 'laborers'],
  ['freeholders', 'masters'],
  ['masters', 'merchants'],
  ['bureaucrats', 'merchants'],
  ['ministeriales', 'bureaucrats'],
  ['nobles', 'patricians'],
]

// §4.2 promotion: 下位→上位 (有向)。
const PROMOTION_PAIRS: ReadonlyArray<readonly [PopType, PopType]> = [
  ['peasants', 'freeholders'],
  ['laborers', 'freeholders'],
  ['artisans', 'masters'],
  ['scribes', 'bureaucrats'],
  ['soldiers', 'ministeriales'],
  ['freeholders', 'nobles'],
  ['masters', 'patricians'],
  ['merchants', 'patricians'],
  ['bureaucrats', 'patricians'],
  ['ministeriales', 'nobles'],
]

// §4.2 demotion: 上位→下位 (有向)。
const DEMOTION_PAIRS: ReadonlyArray<readonly [PopType, PopType]> = [
  ['freeholders', 'peasants'],
  ['masters', 'artisans'],
  ['merchants', 'laborers'],
  ['bureaucrats', 'scribes'],
  ['ministeriales', 'soldiers'],
  ['nobles', 'ministeriales'],
  ['patricians', 'merchants'],
]

// §4.3: kind は stratum 順序ではなく **エッジの所属 (lateral/promotion/demotion pair)** から判定する。
//   POP の「移動」は PopType (Class) 単位で見るのが正であり、stratum は集計・社会構造の記述専用 (v0.57.1)。
//   lateral pair は双方向、promotion/demotion pair は有向。
const KIND_BY_EDGE: Readonly<Record<string, PopMobilityKind>> = (() => {
  const m: Record<string, PopMobilityKind> = {}
  for (const [a, b] of LATERAL_PAIRS) {
    m[`${a}:${b}`] = 'lateral'
    m[`${b}:${a}`] = 'lateral'
  }
  for (const [from, to] of PROMOTION_PAIRS) m[`${from}:${to}`] = 'promotion'
  for (const [from, to] of DEMOTION_PAIRS) m[`${from}:${to}`] = 'demotion'
  return m
})()

export function classifyMobilityKind(from: PopType, to: PopType): PopMobilityKind {
  const k = KIND_BY_EDGE[`${from}:${to}`]
  if (k) return k
  // 定義済みエッジ以外 (allowedTargetsFor 経由なら到達しない防御的フォールバック) は
  //   stratum 順序で導出する。stratum はここでも判定の主体ではなく最終手段。
  const sf = STRATUM_ORDER[getPopStratum(from)]
  const st = STRATUM_ORDER[getPopStratum(to)]
  if (st === sf) return 'lateral'
  return st > sf ? 'promotion' : 'demotion'
}

// source PopType → 許可 target PopType[] の index (決定論: source 昇順・target 挿入順)。
//   lateral は双方向に展開。
export const ALLOWED_TARGETS_BY_POP_TYPE: Readonly<Record<PopType, readonly PopType[]>> = (() => {
  const map = new Map<PopType, PopType[]>()
  const add = (from: PopType, to: PopType) => {
    const list = map.get(from)
    if (list) {
      if (!list.includes(to)) list.push(to)
    } else {
      map.set(from, [to])
    }
  }
  for (const [a, b] of LATERAL_PAIRS) {
    add(a, b)
    add(b, a)
  }
  for (const [from, to] of [...PROMOTION_PAIRS, ...DEMOTION_PAIRS]) add(from, to)
  const result = {} as Record<PopType, PopType[]>
  for (const [from, list] of map) result[from] = list
  return result
})()

export function allowedTargetsFor(popType: PopType): readonly PopType[] {
  return ALLOWED_TARGETS_BY_POP_TYPE[popType] ?? []
}
