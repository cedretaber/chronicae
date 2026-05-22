import type { TickContext } from './context'
import type { PersonId } from '../types/ids'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import { getActiveFactions, getFactionActiveMemberIds } from '../selectors/factionSelectors'
import { addPersonWealth } from '../mutations/personMutations'
import { adjustPersonAttitudeIfExists } from '../mutations/attitudeMutations'

// v0.17 §11 + v0.17.4 §13.11: FactionPatronageSystem (毎年 1 月)
// 派閥 leader と member 間の献金 / 小遣いを処理する。
// attitude 更新は updateAttitudeIfExists で既存 key のみ (新規 key は作らない)。
// v0.17.4: stipend を払えなかった member が >= 1 かつ leader.wealth が解散閾値を上回る場合
// FACTION_FUNDS_SHORTAGE event を 1 派閥 1 年 1 回 emit する。
export function runFactionPatronageSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const config = ctx.config

  for (const faction of getActiveFactions(currentCtx.state)) {
    const leader = currentCtx.state.persons[faction.leaderPersonId]
    if (!leader || !leader.alive) continue

    const memberIds = getFactionActiveMemberIds(currentCtx.state, faction.id).filter(
      (mid) => mid !== faction.leaderPersonId,
    )

    // 1. 献金: office 持ち member → leader
    for (const memberId of memberIds) {
      const member = currentCtx.state.persons[memberId]
      if (!member || !member.alive) continue
      if (member.wealth <= config.factionDonationPersonalReserve) continue

      const hasOffice = hasActiveNonLeaderOffice(currentCtx.state, memberId)
      if (!hasOffice) continue

      const donationCap = member.wealth - config.factionDonationPersonalReserve
      const donationDesired = Math.floor(member.wealth * config.factionDonationRate)
      const donation = Math.max(1, Math.min(donationCap, donationDesired))
      if (donation <= 0) continue

      const minusResult = addPersonWealth(currentCtx.state, memberId, -donation)
      if (!minusResult.ok) continue
      currentCtx = { ...currentCtx, state: minusResult.value }
      const plusResult = addPersonWealth(currentCtx.state, faction.leaderPersonId, donation)
      if (plusResult.ok) currentCtx = { ...currentCtx, state: plusResult.value }

      let s = applyAttitudeIfPresent(currentCtx.state, faction.leaderPersonId, memberId, {
        affection: config.factionDonationAffectionGain,
        respect: config.factionDonationRespectGain,
      })
      s = applyAttitudeIfPresent(s, memberId, faction.leaderPersonId, {
        affection: config.factionDonationAffectionGainSmall,
      })
      currentCtx = { ...currentCtx, state: s }
    }

    // 2. 小遣い: leader → office なし member
    let unpaidCount = 0
    for (const memberId of memberIds) {
      const member = currentCtx.state.persons[memberId]
      if (!member || !member.alive) continue
      if (hasActiveNonLeaderOffice(currentCtx.state, memberId)) continue

      const leaderNow = currentCtx.state.persons[faction.leaderPersonId]
      if (!leaderNow) break

      const stipend = config.factionStipendBase
      if (leaderNow.wealth >= config.factionLeaderReserveWealth + stipend) {
        const lResult = addPersonWealth(currentCtx.state, faction.leaderPersonId, -stipend)
        if (!lResult.ok) continue
        currentCtx = { ...currentCtx, state: lResult.value }
        const mResult = addPersonWealth(currentCtx.state, memberId, stipend)
        if (mResult.ok) currentCtx = { ...currentCtx, state: mResult.value }

        const s = applyAttitudeIfPresent(currentCtx.state, memberId, faction.leaderPersonId, {
          affection: config.factionStipendAffectionGain,
          respect: config.factionStipendRespectGain,
        })
        currentCtx = { ...currentCtx, state: s }
      } else {
        unpaidCount++
        // 資金不足: 既存 attitude key があれば負方向
        const s = applyAttitudeIfPresent(currentCtx.state, memberId, faction.leaderPersonId, {
          affection: -config.factionStipendShortageAffectionPenalty,
          respect: -config.factionStipendShortageRespectPenalty,
        })
        currentCtx = { ...currentCtx, state: s }
      }
    }

    // v0.17.4 §13.11: FACTION_FUNDS_SHORTAGE — 1 派閥 1 年 1 回
    // 完全破産 (LEADER_BANKRUPT) は factionLifecycleSystem 側で扱うので除外する。
    if (unpaidCount >= 1) {
      const leaderAfter = currentCtx.state.persons[faction.leaderPersonId]
      if (leaderAfter && leaderAfter.wealth >= config.factionDisbandWealthFloor) {
        const { event, ctx: ec } = createSimEvent(currentCtx, {
          type: 'FACTION_FUNDS_SHORTAGE',
          importance: 'normal',
          messageKey: 'faction.funds_shortage',
          messageParams: {
            person: nameParam('person', leaderAfter.nameKey),
            factionLeader: nameParam(
              'person',
              currentCtx.state.persons[faction.leaderPersonId]?.nameKey ?? 'unknown',
            ),
          },
          entityRefs: [
            entityRef('person', faction.leaderPersonId, 'leader', leaderAfter.nameKey),
            entityRef('faction', faction.id, 'faction'),
          ],
        })
        currentCtx = { ...ec, events: [...ec.events, event] }
      }
    }
  }

  return currentCtx
}

function hasActiveNonLeaderOffice(state: WorldState, personId: PersonId): boolean {
  const ids = state.officeIndex.byHolderPerson[personId] ?? []
  for (const id of ids) {
    const o = state.officeAssignments[id]
    if (o && o.active && o.role !== 'leader') return true
  }
  // v0.17.1 §15.3: Bailiff (HoldingOffice) 持ちも献金経路に乗せる
  const hIds = state.holdingOfficeIndex.byHolderPerson[personId] ?? []
  for (const id of hIds) {
    const a = state.holdingOfficeAssignments[id]
    if (a && a.active) return true
  }
  return false
}

function applyAttitudeIfPresent(
  state: WorldState,
  sourcePersonId: PersonId,
  targetPersonId: PersonId,
  delta: { affection?: number; respect?: number },
): WorldState {
  const result = adjustPersonAttitudeIfExists(
    state,
    sourcePersonId,
    { kind: 'person', id: targetPersonId },
    delta,
  )
  return result.ok ? result.value : state
}
