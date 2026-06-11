import type { TickContext } from './context'
import type { WorldState } from '@sim/types/world'
import type { HouseId, ClanId, PersonId } from '@sim/types/ids'
import { isRulingHouse, isInfluentialHouse } from '@sim/selectors/availabilitySelectors'
import { createClan, addHouseToClan, syncClanActive } from '@sim/mutations/clanMutations'
import { createSimEvent } from './context'
import { entityRef } from '@sim/types/event'
import { houseNameParam } from '@sim/selectors/nameRefSelectors'

function collectMemberHouseIds(state: WorldState, rootHouseId: HouseId): HouseId[] {
  const result: HouseId[] = []
  const visited = new Set<string>()
  const stack: HouseId[] = [rootHouseId]
  while (stack.length > 0) {
    const houseId = stack.pop()!
    if (visited.has(houseId)) continue
    visited.add(houseId)
    const house = state.houses[houseId]
    if (!house) continue
    if (house.kind === 'system') continue
    if (house.clanId !== undefined && houseId !== rootHouseId) continue
    // 調査 §1 (low): inactive (断絶) house を clan メンバーに含めない (clanId 付与・
    // カウント汚染を防ぐ)。ただし配下の active 子家へ到達するため traversal は継続する。
    if (house.active) result.push(houseId)
    for (const cadetId of house.cadetHouseIds) {
      if (!visited.has(cadetId)) {
        const cadet = state.houses[cadetId]
        if (cadet && cadet.clanId !== undefined) continue
        stack.push(cadetId)
      }
    }
  }
  return result
}

export function runClanFormationSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const config = currentCtx.config

  // --- Part 1: New clan formation ---
  const houseIds = Object.keys(currentCtx.state.houses).sort() as HouseId[]
  for (const houseId of houseIds) {
    const house = currentCtx.state.houses[houseId]
    if (!house) continue
    if (!house.active) continue
    if (house.kind === 'system') continue
    if (house.clanId !== undefined) continue

    const formationGroup: HouseId[] = [houseId]
    for (const cadetId of house.cadetHouseIds) {
      const cadet = currentCtx.state.houses[cadetId]
      if (!cadet) continue
      if (!cadet.active) continue
      if (cadet.kind === 'system') continue
      if (cadet.clanId !== undefined) continue
      formationGroup.push(cadetId)
    }

    const directCadetCount = formationGroup.length - 1
    if (directCadetCount < config.clanFormationMinDirectCadetHouses) continue

    let hasInfluence = false
    for (const fid of formationGroup) {
      if (isRulingHouse(currentCtx.state, fid)) {
        hasInfluence = true
        break
      }
    }
    if (!hasInfluence) {
      let influentialCount = 0
      for (const fid of formationGroup) {
        if (isInfluentialHouse(currentCtx.state, config, fid)) influentialCount++
      }
      if (influentialCount < config.clanFormationMinInfluentialHouses) continue
    }

    let totalLiving = 0
    let totalWealth = 0
    let totalPrestige = 0
    for (const fid of formationGroup) {
      const fHouse = currentCtx.state.houses[fid]
      if (!fHouse || !fHouse.active) continue
      totalLiving += fHouse.memberIds.length
      totalWealth += fHouse.wealth
      totalPrestige += fHouse.legacyPrestige
    }
    const quantityPass =
      totalLiving >= config.clanFormationMinTotalLivingMembers ||
      totalWealth >= config.clanFormationMinTotalWealth ||
      totalPrestige >= config.clanFormationMinTotalLegacyPrestige
    if (!quantityPass) continue

    const memberHouseIds = collectMemberHouseIds(currentCtx.state, houseId)
    const rootHouse = currentCtx.state.houses[houseId]
    const createParams: {
      rootHouseId: HouseId
      memberHouseIds: HouseId[]
      founderPersonId?: PersonId
      createdWeek: number
    } = {
      rootHouseId: houseId,
      memberHouseIds,
      createdWeek: currentCtx.state.absoluteWeek,
    }
    if (rootHouse?.founderId !== undefined) {
      createParams.founderPersonId = rootHouse.founderId
    }
    const result = createClan(currentCtx.state, createParams)
    currentCtx = { ...currentCtx, state: result.state }

    const rootHouseForEvent = currentCtx.state.houses[houseId]
    const rootHouseNameKey = rootHouseForEvent?.nameKey ?? ''
    const activeCount = memberHouseIds.filter((mid) => {
      const h = currentCtx.state.houses[mid]
      return h !== undefined && h.active
    }).length

    const { event, ctx: ec } = createSimEvent(currentCtx, {
      type: 'CLAN_FOUNDED',
      importance: 'major',
      messageKey: 'clan.founded',
      messageParams: {
        rootHouseName: houseNameParam(rootHouseForEvent, houseId),
        memberHouseCount: memberHouseIds.length,
        activeHouseCount: activeCount,
      },
      entityRefs: [
        entityRef('clan', result.clan.id, 'clan'),
        entityRef('house', houseId, 'rootHouse', rootHouseNameKey),
        ...(createParams.founderPersonId !== undefined
          ? [
              entityRef(
                'person',
                createParams.founderPersonId,
                'founder',
                currentCtx.state.persons[createParams.founderPersonId]?.nameKey,
              ),
            ]
          : []),
      ],
    })
    currentCtx = { ...ec, events: [...ec.events, event] }
  }

  // --- Part 2: Existing clan maintenance ---
  const clanIds = Object.keys(currentCtx.state.clans).sort() as ClanId[]
  for (const clanId of clanIds) {
    const clan = currentCtx.state.clans[clanId]
    if (!clan) continue

    for (const memberHouseId of [...clan.memberHouseIds]) {
      const memberHouse = currentCtx.state.houses[memberHouseId]
      if (!memberHouse) continue
      for (const cadetId of memberHouse.cadetHouseIds) {
        const cadet = currentCtx.state.houses[cadetId]
        if (cadet && cadet.clanId === undefined && cadet.kind !== 'system') {
          currentCtx = { ...currentCtx, state: addHouseToClan(currentCtx.state, clanId, cadetId) }
        }
      }
    }

    currentCtx = { ...currentCtx, state: syncClanActive(currentCtx.state, clanId) }
  }

  return currentCtx
}
