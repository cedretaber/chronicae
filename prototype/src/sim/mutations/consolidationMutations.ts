import type { WorldState } from '../types/world'
import type { PolityId, HouseId, HoldingId } from '../types/ids'
import { eliminateContractFromChain } from './landContractMutations'
import {
  getPolityTerminalProvinceIds,
  getHouseOwnedPolityIds,
} from '../selectors/landContractSelectors'

// v0.47 §12.7: House 一円支配の自家内 collapse。sink Polity が直接掌握できる holding について、
// sink〜terminal 間の同家・非 special contract を terminal 側から順に eliminateContractFromChain で
// 畳む。所有者 guard (同家・specialStatus なし) は本関数で行う (helper は所有者を見ない)。
// 戻り値: { ws, consolidatedCount } (集約した holding 数)。
export function applyConsolidationMut(
  ws: WorldState,
  houseId: HouseId,
  sinkPolityId: PolityId,
): { ws: WorldState; consolidatedCount: number } {
  let state = ws
  let consolidatedCount = 0

  // sink 以外の自家 owned polity が terminal 支配する holding を候補にする。
  const candidateHoldings = new Set<HoldingId>()
  for (const pid of getHouseOwnedPolityIds(state, houseId)) {
    if (pid === sinkPolityId) continue
    for (const provinceId of getPolityTerminalProvinceIds(state, pid)) {
      const province = state.provinces[provinceId]
      if (!province) continue
      for (const holdingId of province.holdingIds) {
        if (state.holdingTerminalPolityCache[holdingId] === pid) candidateHoldings.add(holdingId)
      }
    }
  }

  for (const holdingId of candidateHoldings) {
    const before = state.holdingTerminalPolityCache[holdingId]
    state = consolidateHolding(state, holdingId, sinkPolityId, houseId)
    if (state.holdingTerminalPolityCache[holdingId] === sinkPolityId && before !== sinkPolityId) {
      consolidatedCount++
    }
  }

  return { ws: state, consolidatedCount }
}

// 1 holding の chain を sink まで畳む。sink が chain に居ない / 既に terminal / 他家が挟まる場合は
// その時点で停止する (no-op を含む)。
function consolidateHolding(
  state: WorldState,
  holdingId: HoldingId,
  sinkPolityId: PolityId,
  houseId: HouseId,
): WorldState {
  let guard = 0
  while (guard++ < 50) {
    const chainIds = state.landContractIndex.byHolding[holdingId] ?? []
    // この holding における sink の contract を探す。
    const sinkContract = chainIds
      .map((id) => state.landContracts[id])
      .find((c) => c && c.granteePolityId === sinkPolityId)
    if (!sinkContract) return state // sink が chain に居ない → 対象外。

    // sink の直下 contract (parent === sink contract)。
    const childId = state.landContractIndex.byParent[sinkContract.id]
    if (childId === undefined) return state // sink が terminal → 完了。
    const child = state.landContracts[childId]
    if (!child) return state

    // 所有者 guard: 直下 contract の grantee が同家・specialStatus なし (§12.7 step3)。
    const childPolity = state.polities[child.granteePolityId]
    if (!childPolity || childPolity.ownerHouseId !== houseId) return state // 他家挟在 → 停止。
    if (child.specialStatus !== undefined) return state

    // sink→child contract を畳む。child の子は sink に繋ぎ替わり chain が 1 段浅くなる。
    state = eliminateContractFromChain(state, childId)
  }
  return state
}
