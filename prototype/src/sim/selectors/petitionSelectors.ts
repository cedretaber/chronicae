import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, PersonId } from '../types/ids'
import type { PolityRank } from '../types/polity'
import { getPolityTerritorialStatus } from '../types/polity'
import {
  getPolityHoldingCount,
  getGrantorRank,
  getLandContractGrantor,
} from './landContractSelectors'
import { getPolityLeader } from './officeSelectors'

// v0.47 §5: 陞爵 (rank promotion) の HARD gate / 同意者選定。
// petition Project (request_rank_promotion / request_land_grant 等) 共通の read-only selector 群。
// 本ファイルの selector は純粋関数であり mutation を行わない。

// §5.3 補助: 対象 Polity が grantee である全 LandContract について、grantor rank が
// newRank より上位 (= 数値が小さい。root は rank 0) であることを要求する。
// LandContract 不変条件 (grantor rank < grantee rank) を陞爵後も保つための事前検査。
export function allGrantorRanksAreAboveNewRank(
  state: WorldState,
  polityId: PolityId,
  newRank: PolityRank,
): boolean {
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  for (const cid of contractIds) {
    const grantor = getLandContractGrantor(state, cid)
    if (!grantor) return false
    const grantorRank = getGrantorRank(state, grantor)
    if (!(grantorRank < newRank)) return false
  }
  return true
}

// §5.3 HARD gate: 対象 Polity が rank を 1 段昇格できるか。
// per-rank config が undefined (要件未定義) の newRank は保守的に昇格不可とする。
export function canPromotePolityRank(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  newRank: PolityRank,
): boolean {
  const polity = state.polities[polityId]
  if (!polity) return false

  const minHolding = config.rankPromotionMinHoldingCountByRank[newRank]
  const minTreasury = config.rankPromotionMinTreasuryByRank[newRank]
  const minPrestige = config.rankPromotionMinPrestigeByRank[newRank]
  const minAdmin = config.rankPromotionMinAdminPowerByRank[newRank]
  if (
    minHolding === undefined ||
    minTreasury === undefined ||
    minPrestige === undefined ||
    minAdmin === undefined
  ) {
    return false
  }

  return (
    polity.active &&
    polity.kind !== 'commonwealth' &&
    getPolityTerritorialStatus(polity) === 'territorial' &&
    newRank === polity.rank - 1 &&
    polity.rank >= 3 &&
    polity.rank <= 5 &&
    newRank >= 2 &&
    allGrantorRanksAreAboveNewRank(state, polityId, newRank) &&
    getPolityHoldingCount(state, polityId) >= minHolding &&
    polity.treasury >= minTreasury &&
    polity.legacyPrestige >= minPrestige &&
    polity.adminPower >= minAdmin
  )
}

// §5.4 SOFT 同意者: 陞爵を承認する宗主の leader。
// grantee である contract のうち polity grantor を持つものを列挙し、最も多くの holding を
// grant している grantor polity を選ぶ (同数なら PolityId 昇順)。その leader を approver とする。
// polity grantor が 0 件 (root 直属のみ) なら undefined = 宗主不在 → SOFT 判定は auto-grant。
export function selectRankPromotionApprover(
  state: WorldState,
  polityId: PolityId,
): PersonId | undefined {
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  const grantCountByPolity = new Map<PolityId, number>()
  for (const cid of contractIds) {
    const grantor = getLandContractGrantor(state, cid)
    if (!grantor || grantor.kind !== 'polity') continue
    grantCountByPolity.set(grantor.id, (grantCountByPolity.get(grantor.id) ?? 0) + 1)
  }
  if (grantCountByPolity.size === 0) return undefined

  let bestPolity: PolityId | undefined
  let bestCount = -1
  const sorted = [...grantCountByPolity.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [gpid, count] of sorted) {
    if (count > bestCount) {
      bestCount = count
      bestPolity = gpid
    }
  }
  if (!bestPolity) return undefined
  return getPolityLeader(state, bestPolity)
}
