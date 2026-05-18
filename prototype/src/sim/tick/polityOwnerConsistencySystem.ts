import type { TickContext } from './context'

// v0.15 §11.3: Polity の ownerHouseId 整合性を毎月補正する system。
// Stage A では空関数（既存挙動を変えない）。Phase 6 で本実装される。
//
// 本実装で行うべきこと:
//   - Polity 内 Province ゼロなら inactive 化 + Share/Office 全削除 + POLITY_EXTINCT 発火
//   - ownerHouseId が undefined / inactive / Polity 内 Province なし → 新 owner 選定
//   - capital 移転、polity:leader 同月補充、POLITY_OWNER_CHANGED 発火
export function runPolityOwnerConsistencySystem(ctx: TickContext): TickContext {
  return ctx
}
