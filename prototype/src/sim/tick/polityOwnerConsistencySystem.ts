import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { PolityId, HouseId, ProvinceId, PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import { getPolityTerritorialStatus } from '../types/polity'
import { decisionSubjectKey } from '../types/goal'
import { entityRef, nameParam } from '../types/event'
import {
  getPolityProvinceIds,
  getPolityHouseIds,
  getHouseProvinceIdsByPolity,
  getHouseSeatProvinceInPolity,
} from '../selectors/polityRelations'
import { getHouseLeader, getPolityLeader } from '../selectors/officeSelectors'
import {
  getPolityNameRefForEmit,
  getPolityEmitNameKey,
  houseNameParam,
} from '../selectors/nameRefSelectors'
import { revokeOfficesByOrganization, createOfficeAssignment } from '../mutations/officeMutations'
import { removeRightsByPolity } from '../mutations/politicalRightMutations'
import { eliminateContractFromChain } from '../mutations/landContractMutations'
import { dissolveFactionsAnchoredToPolity } from '../mutations/factionMutations'
import { selectOrCreateCommonwealthLeader } from '../mutations/worldStructureMutations'
import { getProvinceDevelopmentFromHoldings } from '../selectors/landContractSelectors'

// v0.15 §10.2: 新 ownerHouse を選定する。
// 1) Polity 内所有 Province 数 desc
// 2) 同数なら Polity 内 Province の合計 development を local military proxy として desc
// 3) 同値なら house.legacyPrestige desc
// 4) 同値なら HouseId 昇順
function chooseOwner(
  ctx: TickContext,
  polityId: PolityId,
  eligibleHouseIds: HouseId[],
): HouseId | undefined {
  if (eligibleHouseIds.length === 0) return undefined
  const ranked = eligibleHouseIds
    .map((houseId) => {
      const house = ctx.state.houses[houseId]
      const provinceIdsInPolity = getHouseProvinceIdsByPolity(ctx.state, houseId, polityId)
      let holdingCount = 0
      for (const pid of provinceIdsInPolity) {
        holdingCount += ctx.state.provinces[pid]?.holdingIds.length ?? 0
      }
      let devSum = 0
      for (const pid of provinceIdsInPolity) {
        const p = ctx.state.provinces[pid]
        if (p) devSum += getProvinceDevelopmentFromHoldings(ctx.state, pid, ctx.config)
      }
      return {
        houseId,
        holdingCount,
        devSum,
        legacyPrestige: house?.legacyPrestige ?? 0,
      }
    })
    .sort((a, b) => {
      if (b.holdingCount !== a.holdingCount) return b.holdingCount - a.holdingCount
      if (b.devSum !== a.devSum) return b.devSum - a.devSum
      if (b.legacyPrestige !== a.legacyPrestige) return b.legacyPrestige - a.legacyPrestige
      return a.houseId.localeCompare(b.houseId)
    })
  return ranked[0]?.houseId
}

function emitPolityExtinct(
  ctx: TickContext,
  polityId: PolityId,
  _summary: string,
  messageKey: string,
): TickContext {
  const polityRef = getPolityNameRefForEmit(ctx.state, polityId)
  const polityName = nameParam(polityRef.category, polityRef.nameKey)
  const { event, ctx: c1 } = createSimEvent(ctx, {
    type: 'POLITY_EXTINCT',
    importance: 'major',
    messageKey,
    messageParams: { polity: polityName },
    entityRefs: [entityRef('polity', polityId, 'polity', polityRef.nameKey)],
  })
  return { ...c1, events: [...c1.events, event] }
}

function emitPolityLandless(ctx: TickContext, polityId: PolityId): TickContext {
  const polityRef = getPolityNameRefForEmit(ctx.state, polityId)
  const polityName = nameParam(polityRef.category, polityRef.nameKey)
  const { event, ctx: c1 } = createSimEvent(ctx, {
    type: 'POLITY_LANDLESS',
    importance: 'major',
    messageKey: 'polity.landless',
    messageParams: { polity: polityName },
    entityRefs: [entityRef('polity', polityId, 'polity', polityRef.nameKey)],
  })
  return { ...c1, events: [...c1.events, event] }
}

function emitPolityOwnerChanged(
  ctx: TickContext,
  polityId: PolityId,
  oldOwnerId: HouseId | undefined,
  newOwnerId: HouseId,
  newCapitalProvinceId: ProvinceId,
): TickContext {
  const polityRef = getPolityNameRefForEmit(ctx.state, polityId)
  const newHouse = ctx.state.houses[newOwnerId]
  const capProv = ctx.state.provinces[newCapitalProvinceId]
  const polityName = nameParam(polityRef.category, polityRef.nameKey)
  const newHouseName = houseNameParam(newHouse, newOwnerId)
  const capName = nameParam('province', capProv?.nameKey ?? newCapitalProvinceId)
  const messageKey = oldOwnerId ? 'polity.owner_changed' : 'polity.owner_changed_initial'
  const { event, ctx: c1 } = createSimEvent(ctx, {
    type: 'POLITY_OWNER_CHANGED',
    importance: 'major',
    messageKey,
    messageParams: {
      polity: polityName,
      new_owner: newHouseName,
      capital: capName,
    },
    entityRefs: [
      entityRef('polity', polityId, 'polity', polityRef.nameKey),
      entityRef('house', newOwnerId, 'new_owner', newHouse?.nameKey),
      entityRef('province', newCapitalProvinceId, 'capital', capProv?.nameKey),
    ],
  })
  return { ...c1, events: [...c1.events, event] }
}

// owner 交代に伴い polity:leader Office も同月内に補充する（plan / §25.2 #10 を当月内成立させる）。
function replacePolityLeader(
  ctx: TickContext,
  polityId: PolityId,
  newOwnerHouseId: HouseId,
): TickContext {
  let state = revokeOfficesByOrganization(ctx.state, { kind: 'polity', id: polityId }, 'leader')
  const newLeaderId: PersonId | undefined = getHouseLeader(state, newOwnerHouseId)
  if (newLeaderId) {
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', newLeaderId)
  }
  return { ...ctx, state }
}

// v0.16: chain length 1 だと Polity 関連 House は ownerHouse 1 つだけになる。
// その owner が滅んで eligibleHouseIds が空になっても、Polity に granteed Province が残るなら
// LandContract grantee 不整合を防ぐため、世界中から active な通常 House を 1 つ拾って ownerHouse に
// 任命する。これにより「王朝交代」が常に起き、Polity 自体は landless になるまで存続する。
function findFallbackOwnerHouse(state: WorldState, excludeHouseId?: HouseId): HouseId | undefined {
  let best: { houseId: HouseId; legacyPrestige: number } | undefined
  for (const houseId of Object.keys(state.houses).sort()) {
    if (excludeHouseId !== undefined && houseId === excludeHouseId) continue
    const house = state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue
    // ownerHouse は seatProvinceId を持っているはず (chain length 1 想定では undefined 不可)
    if (!best || house.legacyPrestige > best.legacyPrestige) {
      best = { houseId: house.id, legacyPrestige: house.legacyPrestige }
    }
  }
  return best?.houseId
}

// polityIndex.byOwnerHouse を更新する: oldOwner から外し newOwner に追加。
function reassignPolityOwnership(
  state: WorldState,
  polityId: PolityId,
  oldOwnerId: HouseId | undefined,
  newOwnerId: HouseId,
): WorldState {
  const byOwnerHouse = { ...state.polityIndex.byOwnerHouse }
  if (oldOwnerId !== undefined) {
    const oldSlot = byOwnerHouse[oldOwnerId] ?? []
    byOwnerHouse[oldOwnerId] = oldSlot.filter((p: PolityId) => p !== polityId)
  }
  const newSlot = byOwnerHouse[newOwnerId] ?? []
  if (!newSlot.includes(polityId)) {
    byOwnerHouse[newOwnerId] = [...newSlot, polityId]
  }
  return {
    ...state,
    polityIndex: { byOwnerHouse },
  }
}

function emitPolityTitularized(ctx: TickContext, polityId: PolityId): TickContext {
  const polityRef = getPolityNameRefForEmit(ctx.state, polityId)
  const polityName = nameParam(polityRef.category, polityRef.nameKey)
  const { event, ctx: c1 } = createSimEvent(ctx, {
    type: 'POLITY_TITULARIZED',
    importance: 'normal',
    messageKey: 'polity.titularized',
    messageParams: { polity: polityName },
    entityRefs: [entityRef('polity', polityId, 'polity', polityRef.nameKey)],
  })
  return { ...c1, events: [...c1.events, event] }
}

function emitPolityAbolished(ctx: TickContext, polityId: PolityId): TickContext {
  const polityRef = getPolityNameRefForEmit(ctx.state, polityId)
  const polityName = nameParam(polityRef.category, polityRef.nameKey)
  const { event, ctx: c1 } = createSimEvent(ctx, {
    type: 'POLITY_ABOLISHED',
    importance: 'normal',
    messageKey: 'polity.abolished',
    messageParams: { polity: polityName },
    entityRefs: [entityRef('polity', polityId, 'polity', polityRef.nameKey)],
  })
  return { ...c1, events: [...c1.events, event] }
}

// v0.47.5: owner に紐づく active な decision artifact (Project / Aim / Goal) を terminal 化する
//   共通ヘルパー。byOwner index から id を引き、active のものだけ terminalize で書き換えた新 map を
//   返す (変更が無ければ undefined → 呼出側で state spread を省略)。Project/Aim/Goal で同型だった
//   3 ループを 1 本に集約する (terminalReason 等の terminal 仕様は terminalize callback が供給)。
function terminalizeActiveByOwner<K extends string, T extends { status: string }>(
  entities: Record<K, T>,
  ids: readonly K[],
  terminalize: (entity: T) => T,
): Record<K, T> | undefined {
  let next: Record<K, T> | undefined
  for (const id of ids) {
    const e = entities[id]
    if (!e || e.status !== 'active') continue
    if (!next) next = { ...entities }
    next[id] = terminalize(e)
  }
  return next
}

// v0.47 §6.2: landless rank 2〜4 normal Polity を称号 (titular) 化する単一 choke point。
// active / ownerHouseId / capitalProvinceId は維持し、leader 以外の office / right / faction anchor /
// territorial 前提の polity-owned Project・Aim を cleanup する。Regiment は明示 disband せず
// regimentMaintenanceSystem の owner reassign に委ねる (§6.2)。
function titularizePolityInline(ctx: TickContext, polityId: PolityId): TickContext {
  const polity = ctx.state.polities[polityId]
  if (!polity) return ctx
  let state = ctx.state

  // 5. leader 以外の polity office を revoke
  for (const role of ['administrator', 'treasurer', 'military', 'advisor'] as const) {
    state = revokeOfficesByOrganization(state, { kind: 'polity', id: polityId }, role)
  }
  // 6. polity に紐づく PoliticalRight を remove
  state = removeRightsByPolity(state, polityId)

  // 1-4. territorialStatus=titular。active / ownerHouseId / capitalProvinceId は維持
  const cur = state.polities[polityId]
  if (cur) {
    state = {
      ...state,
      polities: { ...state.polities, [polityId]: { ...cur, territorialStatus: 'titular' } },
    }
  }

  // 8. territorial 前提の polity-owned Project / Aim / Goal を打ち切る。titular は active のため
  //    projectMaintenance の owner_inactive cascade / goalMaintenance の inactive-owner abandon に
  //    乗らず、titular 化後は目標生成対象からも除外されて reviewGoal も走らない (§6.56) →
  //    ここで明示 terminal 化する。Project=cancelled+terminalReason、Aim/Goal=abandoned。
  const ownerKey = decisionSubjectKey({ kind: 'polity', id: polityId })
  const nextProjects = terminalizeActiveByOwner(
    state.projects,
    state.projectIndex.byOwner[ownerKey] ?? [],
    (p) => ({ ...p, status: 'cancelled' as const, terminalReason: 'owner_titularized' as const }),
  )
  if (nextProjects) state = { ...state, projects: nextProjects }
  const nextAims = terminalizeActiveByOwner(
    state.aims,
    state.aimIndex.byOwner[ownerKey] ?? [],
    (a) => ({ ...a, status: 'abandoned' as const }),
  )
  if (nextAims) state = { ...state, aims: nextAims }
  const nextGoals = terminalizeActiveByOwner(
    state.goals,
    state.goalIndex.byOwner[ownerKey] ?? [],
    (g) => ({ ...g, status: 'abandoned' as const }),
  )
  if (nextGoals) state = { ...state, goals: nextGoals }

  // v0.50 fix: titular Polity は LandContract を持たない (§19.1)。titular 化時に grantee 契約を除去。
  const granteeContracts = state.landContractIndex.byGranteePolity[polityId] ?? []
  for (const contractId of [...granteeContracts]) {
    state = eliminateContractFromChain(state, contractId)
  }

  let next: TickContext = { ...ctx, state }
  // 7. Faction anchor cleanup
  next = dissolveFactionsAnchoredToPolity(next, polityId)
  // 9. POLITY_TITULARIZED
  next = emitPolityTitularized(next, polityId)
  return next
}

function deactivatePolityInline(ctx: TickContext, polityId: PolityId): TickContext {
  const polity = ctx.state.polities[polityId]
  if (!polity) return ctx
  let state = ctx.state
  state = revokeOfficesByOrganization(state, { kind: 'polity', id: polityId })
  // v0.42c: polity share は全廃済 (旧 removeSharesByOrganization 呼出は不要)
  // v0.42 §6.4: polity inactive で当該 polity の right を全削除 (office revoke と co-locate — §3.4 (b))
  state = removeRightsByPolity(state, polityId)
  state = {
    ...state,
    polities: { ...state.polities, [polityId]: { ...polity, active: false } },
  }
  // v0.42 §12.3: anchor された active Faction を即時解散する (F8 を年末 integrity 前に守る)。
  //   factionLifecycleSystem は年次 (weekOfYear 1) 実行のため安全網にしかならない (§3.4)。
  return dissolveFactionsAnchoredToPolity({ ...ctx, state }, polityId)
}

export function runPolityOwnerConsistencySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const polityIds = (Object.keys(currentCtx.state.polities) as PolityId[]).sort()

  for (const polityId of polityIds) {
    const polity = currentCtx.state.polities[polityId]
    if (!polity || !polity.active) continue

    // v0.50 fix: titular Polity に LandContract が残っている場合は除去 (§19.1 安全網)。
    // peaceSettlement が戦争結果で titular polity に land を移転した場合に発生する。
    if (getPolityTerritorialStatus(polity) === 'titular') {
      const granteeContracts = currentCtx.state.landContractIndex.byGranteePolity[polityId] ?? []
      if (granteeContracts.length > 0) {
        let state = currentCtx.state
        for (const contractId of [...granteeContracts]) {
          state = eliminateContractFromChain(state, contractId)
        }
        currentCtx = { ...currentCtx, state }
      }
    }

    // Step 1: landless 検出。v0.47 §6.1: normal rank 2〜4 → titular 化、rank 5 → 廃止、
    //   commonwealth → 従来の extinct 経路 (titular 化の対象外・§2.1)。
    const provinceIds = getPolityProvinceIds(currentCtx.state, polityId)
    if (provinceIds.length === 0) {
      if (polity.kind === 'commonwealth' && polity.revoltState != null) continue

      // v0.47 §6.4: 既に titular の Polity は安定状態。ownerHouse が断絶 (inactive/extinct) した場合のみ
      //   abolish する。fallback owner 補充は行わない (territorial のみ)。leader 補充は successionSystem
      //   が ownerHouse leader を選ぶため不要。
      if (getPolityTerritorialStatus(polity) === 'titular') {
        const oh =
          polity.ownerHouseId !== undefined
            ? currentCtx.state.houses[polity.ownerHouseId]
            : undefined
        if (!oh || !oh.active) {
          currentCtx = deactivatePolityInline(currentCtx, polityId)
          currentCtx = emitPolityAbolished(currentCtx, polityId)
        }
        continue
      }

      // commonwealth (titular 非対象) は従来の extinct 経路
      if (polity.kind === 'commonwealth') {
        currentCtx = emitPolityLandless(currentCtx, polityId)
        currentCtx = deactivatePolityInline(currentCtx, polityId)
        currentCtx = emitPolityExtinct(
          currentCtx,
          polityId,
          `${getPolityEmitNameKey(currentCtx.state, polityId)} has dissolved without remaining provinces.`,
          'polity.extinct_no_provinces',
        )
        continue
      }

      // v0.47 §6.1: normal landless。rank 5 → abolish (Polity のみ inactive・house 巻き込みなし)、
      //   rank 2〜4 → titular 化。
      if (polity.rank === 5) {
        currentCtx = emitPolityLandless(currentCtx, polityId)
        currentCtx = deactivatePolityInline(currentCtx, polityId)
        currentCtx = emitPolityAbolished(currentCtx, polityId)
      } else {
        currentCtx = titularizePolityInline(currentCtx, polityId)
      }
      continue
    }

    const eligibleHouseIds = getPolityHouseIds(currentCtx.state, polityId)

    // v0.39 D-2: established commonwealth の emergency leader 補充
    if (polity.kind === 'commonwealth' && polity.revoltState?.kind === 'established') {
      const leaderId = getPolityLeader(currentCtx.state, polityId)
      if (leaderId === undefined) {
        const { personId: newLeaderId, ctx: leaderCtx } =
          selectOrCreateCommonwealthLeader(currentCtx)
        currentCtx = leaderCtx
        let state = currentCtx.state
        state = createOfficeAssignment(
          state,
          { kind: 'polity', id: polityId },
          'leader',
          newLeaderId,
        )
        // v0.42c §15.1: person-holder polity share (100 固定) は廃止。
        // commonwealth leader の影響力は influence breakdown の ruler domain で表現される。
        currentCtx = { ...currentCtx, state }
      }
      continue
    }

    // Step 2: ownerHouseId が undefined の場合の補充
    if (polity.ownerHouseId === undefined) {
      // v0.18-pre: commonwealth Polity は ownerHouseId === undefined を恒常状態として許容する
      // (Rebel Polity が第三国家に乗っ取られる現象の解消)。Polity.kind === 'commonwealth' なら補充スキップ。
      if (polity.kind === 'commonwealth') continue
      // v0.16: Polity に Province がまだ残っているなら、グローバルに active 通常 House を探して
      // 補充する (LandContract grantee 不整合防止)。それも無ければ POLITY_EXTINCT。
      const newOwnerId =
        eligibleHouseIds.length > 0
          ? chooseOwner(currentCtx, polityId, eligibleHouseIds)!
          : findFallbackOwnerHouse(currentCtx.state)
      if (newOwnerId === undefined) {
        currentCtx = deactivatePolityInline(currentCtx, polityId)
        currentCtx = emitPolityExtinct(
          currentCtx,
          polityId,
          `${getPolityEmitNameKey(currentCtx.state, polityId)} has dissolved without an owning house.`,
          'polity.extinct_no_owner',
        )
        continue
      }
      const newCapital =
        getHouseSeatProvinceInPolity(currentCtx.state, newOwnerId, polityId) ?? provinceIds[0]!
      const updated = currentCtx.state.polities[polityId]
      if (!updated) continue
      const stateWithOwner: WorldState = {
        ...currentCtx.state,
        polities: {
          ...currentCtx.state.polities,
          [polityId]: {
            ...updated,
            ownerHouseId: newOwnerId,
            capitalProvinceId: newCapital,
          },
        },
      }
      currentCtx = {
        ...currentCtx,
        state: reassignPolityOwnership(stateWithOwner, polityId, undefined, newOwnerId),
      }
      currentCtx = replacePolityLeader(currentCtx, polityId, newOwnerId)
      currentCtx = emitPolityOwnerChanged(currentCtx, polityId, undefined, newOwnerId, newCapital)
      continue
    }

    // Step 3: ownerHouse 資格検査
    const ownerHouse = currentCtx.state.houses[polity.ownerHouseId]
    const ownerInvalid =
      !ownerHouse ||
      !ownerHouse.active ||
      !eligibleHouseIds.some((id) => (id as string) === (polity.ownerHouseId as string))

    if (!ownerInvalid) continue

    // v0.18-pre: commonwealth Polity に owner が一時的に set された状態は将来「家の設立」イベント
    // 等で起き得る。kind === 'commonwealth' のままなら invalid 検知でも入れ替えない (defensive)。
    if (polity.kind === 'commonwealth') continue

    // v0.16: eligibleHouseIds が空でも、Polity が provinces を持つ限り別 House を ownerHouse に
    // 任命する (LandContract grantee 不整合防止)。グローバル fallback で active 通常 House を探す。
    const oldOwnerId = polity.ownerHouseId
    const newOwnerId =
      eligibleHouseIds.length > 0
        ? chooseOwner(currentCtx, polityId, eligibleHouseIds)!
        : findFallbackOwnerHouse(currentCtx.state, oldOwnerId)
    if (newOwnerId === undefined) {
      // 世界に active 通常 House が 1 つも残っていない場合のみ extinct
      currentCtx = deactivatePolityInline(currentCtx, polityId)
      currentCtx = emitPolityExtinct(
        currentCtx,
        polityId,
        `${getPolityEmitNameKey(currentCtx.state, polityId)} has dissolved after losing its owning house.`,
        'polity.extinct_lost_owner',
      )
      continue
    }
    const newCapital =
      getHouseSeatProvinceInPolity(currentCtx.state, newOwnerId, polityId) ?? provinceIds[0]!
    const updated = currentCtx.state.polities[polityId]
    if (!updated) continue
    const stateWithOwner: WorldState = {
      ...currentCtx.state,
      polities: {
        ...currentCtx.state.polities,
        [polityId]: {
          ...updated,
          ownerHouseId: newOwnerId,
          capitalProvinceId: newCapital,
        },
      },
    }
    currentCtx = {
      ...currentCtx,
      state: reassignPolityOwnership(stateWithOwner, polityId, oldOwnerId, newOwnerId),
    }
    currentCtx = replacePolityLeader(currentCtx, polityId, newOwnerId)
    currentCtx = emitPolityOwnerChanged(currentCtx, polityId, oldOwnerId, newOwnerId, newCapital)
  }

  return currentCtx
}
