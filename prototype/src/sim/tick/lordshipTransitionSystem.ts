import type { TickContext } from './context'

// v0.16 Stage B 廃止予定 (§15.1): 旧 Province.ownerHouseId / houseControl 直書きに依存し、
// LandContract 一本化 (§8) と House actor 排除原則 (§15) と矛盾するため。
// Stage A では tick から残しつつ identity (no-op) として動作させる。
export function runLordshipTransitionSystem(ctx: TickContext): TickContext {
  return ctx
}
