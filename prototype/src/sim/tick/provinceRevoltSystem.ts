import type { TickContext } from './context'

// v0.16 Stage A の暫定実装: provinceRevoltSystem は v0.15 の旧 Province.ownerHouseId / polityId /
// houseControl と House.provinceIds に強く依存していたため、Stage A では tick から identity (no-op)
// として動作させる。
// Stage B で createRebelPolity (§17) に置き換えた本格実装を行う。
// 仕様: docs/drafts/spec-v016-update.md §17
export function runProvinceRevoltSystem(ctx: TickContext): TickContext {
  return ctx
}
