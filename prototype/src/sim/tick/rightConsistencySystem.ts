// v0.42 §7 RightConsistencySystem — PoliticalRight の drift を回収する安全網。
//
// 即時 cascade (markPersonDead / worldStructureExtinction / disbandRegimentMut /
// polityOwnerConsistency deactivate) が一次手段で、本 system はそれでも残った不整合
// (regiment owner の terminal 同期による付替・holding terminal polity の変化など、
// mutation では追わないもの) を削除する。
//
// 配置: regimentMaintenanceSystem の直後・cleanup 系の前 (§7.2)。
//   regimentMaintenance が owner を terminal Polity に同期した後でないと、owner 変化による
//   regiment_control right の失効を回収できない。
//
// interval: 1 (weekly — §3.4/§7.3)。年末 tick は absoluteWeek ≡ 47 (mod 48) であり、
//   interval 4 / offset 0 では年末 tick に走らない。weekly の regimentMaintenance が
//   weekOfYear 46-48 に owner を付け替えると R4 drift が年末 integrity に到達するため、
//   cancelOrphanedWarsSystem と同じく weekly が必須。

import type { TickContext } from './context'
import type { PoliticalRightId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PoliticalRight } from '../types/politicalRight'
import { removePoliticalRight } from '../mutations/politicalRightMutations'
import { getEffectiveOfficeMaxHolders } from '../selectors/officeSelectors'
import { emitPoliticalRightRevoked } from './politicalRightEvents'

// REVOKED イベントの reason enum (i18n: political_right.revoke_reason.* に解決)
export type PoliticalRightRevokeReason =
  | 'holder_lost' // holder person 死亡 / house 絶家 (cascade 漏れの回収)
  | 'polity_dissolved' // right.polityId の polity が inactive
  | 'target_lost' // target 消滅 (regiment disbanded / holding 消滅)
  | 'regime_change' // target は存在するが支配 polity が right.polityId と一致しない
  // v0.51 陰謀リファイン: 任命権失効陰謀の成果で剥奪 (revoke_political_right project 完了)
  | 'revoked_by_conspiracy'

// right の不整合を検査し、失効理由を返す (整合していれば undefined)。
// §7.4: holder 有効 / polity active / target 実在 / target と polityId の整合。
export function findRightInconsistency(
  state: WorldState,
  config: SimulationConfig,
  right: PoliticalRight,
): PoliticalRightRevokeReason | undefined {
  if (right.holder.kind === 'person') {
    const person = state.persons[right.holder.id]
    if (!person || !person.alive || person.kind === 'placeholder') return 'holder_lost'
  } else {
    const house = state.houses[right.holder.id]
    if (!house || !house.active) return 'holder_lost'
  }

  const polity = state.polities[right.polityId]
  if (!polity || !polity.active) return 'polity_dissolved'

  switch (right.target.kind) {
    case 'polity_office_role': {
      if (right.target.polityId !== right.polityId) return 'regime_change'
      // v0.42 slot 化: effectiveMax 縮小で slot が消えた right は「列の後ろから」失効する。
      // effectiveMax は rank / 領土数で動的に変わり 0 にもなり得る (その場合 slot 0 も失効)。
      // 失効した right は領土回復で slot が戻っても復活しない (hard-delete 原則)。
      const effectiveMax = getEffectiveOfficeMaxHolders(
        state,
        config,
        { kind: 'polity', id: right.polityId },
        right.target.role,
      )
      if (right.target.slotIndex >= effectiveMax) return 'target_lost'
      return undefined
    }
    case 'holding_office_role': {
      const holding = state.holdings[right.target.holdingId]
      if (!holding) return 'target_lost'
      const terminal = state.holdingTerminalPolityCache[right.target.holdingId]
      if (terminal !== right.polityId) return 'regime_change'
      return undefined
    }
    case 'regiment': {
      const regiment = state.regiments[right.target.regimentId]
      if (!regiment || regiment.status === 'disbanded') return 'target_lost'
      // destroyed は失効しない (§11.4) — owner 整合のみ確認
      if (regiment.owner.kind !== 'polity' || regiment.owner.id !== right.polityId)
        return 'regime_change'
      return undefined
    }
  }
}

export function runRightConsistencySystem(ctx: TickContext): TickContext {
  const rightIds = Object.keys(ctx.state.politicalRights).sort() as PoliticalRightId[]
  if (rightIds.length === 0) return ctx

  let state = ctx.state
  const revoked: { right: PoliticalRight; reason: PoliticalRightRevokeReason }[] = []
  for (const rightId of rightIds) {
    const right = state.politicalRights[rightId]
    if (!right) continue
    const reason = findRightInconsistency(state, ctx.config, right)
    if (reason === undefined) continue
    state = removePoliticalRight(state, rightId)
    revoked.push({ right, reason })
  }
  if (revoked.length === 0) return ctx

  let next: TickContext = { ...ctx, state }
  for (const { right, reason } of revoked) {
    next = emitPoliticalRightRevoked(next, right, reason)
  }
  return next
}
