import type { TickContext } from './context'

// v0.16 Stage B 廃止予定 (§15.1): House actor の Polity rebellion で house.provinceIds に依存し、
// LandContract 一本化 (§8) と House actor 排除原則 (§15) と正面から矛盾するため。
// Stage A では tick から残しつつ identity (no-op) として動作させる。
// House 内乱・派閥反乱・王朝復古は将来の Faction / DiplomaticIssue / War system で再導入する。
export function runRebellionSystem(ctx: TickContext): TickContext {
  return ctx
}
