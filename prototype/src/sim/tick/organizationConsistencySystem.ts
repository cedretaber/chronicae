import type { TickContext } from './context'

// v0.15 §11.4: OrganizationRef Share / Office の整合性を毎月補正する system。
// Stage A では空関数（既存挙動を変えない）。Phase 7 で本実装される。
//
// 本実装で行うべきこと:
//   - 不適格 Share の削除（Polity 内に Province を持たない House の Polity Share 等）
//   - 不適格 Office の revoke（Person の所属 House が当該 Organization に Share を持たない場合等）
export function runOrganizationConsistencySystem(ctx: TickContext): TickContext {
  return ctx
}
