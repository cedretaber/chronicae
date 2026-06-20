import type { SimError } from '../mutations/errors'

// v0.53 §18: active-only の配列 index を rebuilt と set 比較する共通ヘルパー。
//   index の構築順と Object.entries の列挙順は一致しないため、順序非依存で照合する。
//   id は branded string なので string 化して比較する。
export function assertArrayIndexMatches(
  errors: SimError[],
  label: string,
  index: Record<string, readonly { toString(): string }[]>,
  rebuilt: Record<string, readonly { toString(): string }[]>,
): void {
  const keys = new Set<string>([...Object.keys(index), ...Object.keys(rebuilt)])
  for (const key of keys) {
    const a = (index[key] ?? []).map((x) => String(x))
    const b = (rebuilt[key] ?? []).map((x) => String(x))
    const sa = [...a].sort().join(',')
    const sb = [...b].sort().join(',')
    if (sa !== sb) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `${label}[${key}] index=[${sa}] does not match active entities [${sb}]`,
      })
    }
  }
}
