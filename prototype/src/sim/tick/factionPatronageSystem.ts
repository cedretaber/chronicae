import type { TickContext } from './context'
import type { PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import { getActiveFactions, getFactionActiveMemberIds } from '../selectors/factionSelectors'
import { addPersonWealth } from '../mutations/personMutations'
import { adjustPersonAttitudeIfExists } from '../mutations/attitudeMutations'

// v0.17 §11: FactionPatronageSystem (毎年 1 月)
// 派閥 leader と member 間の献金 / 小遣いを処理する。
// attitude 更新は updateAttitudeIfExists で既存 key のみ (新規 key は作らない)。
// Stage B B2 段階では FACTION_FUNDS_SHORTAGE / FACTION_LEADER_BANKRUPT /
// FACTION_MEMBER_ABANDONED 等の年次集計イベントは発火しない (Stage B B3 で派閥が
// 結成されるようになってから扱う)。
export function runFactionPatronageSystem(ctx: TickContext): TickContext {
  if (ctx.state.currentMonth !== 1) return ctx
  let state = ctx.state
  const config = ctx.config

  for (const faction of getActiveFactions(state)) {
    const leader = state.persons[faction.leaderPersonId]
    if (!leader || !leader.alive) continue

    const memberIds = getFactionActiveMemberIds(state, faction.id).filter(
      (mid) => mid !== faction.leaderPersonId,
    )

    // 1. 献金: office 持ち member → leader
    for (const memberId of memberIds) {
      const member = state.persons[memberId]
      if (!member || !member.alive) continue
      if (member.wealth <= config.factionDonationPersonalReserve) continue

      const hasOffice = hasActiveNonLeaderOffice(state, memberId)
      if (!hasOffice) continue

      const donationCap = member.wealth - config.factionDonationPersonalReserve
      const donationDesired = Math.floor(member.wealth * config.factionDonationRate)
      const donation = Math.max(1, Math.min(donationCap, donationDesired))
      if (donation <= 0) continue

      // member → leader 振替
      const minusResult = addPersonWealth(state, memberId, -donation)
      if (!minusResult.ok) continue
      state = minusResult.value
      const plusResult = addPersonWealth(state, faction.leaderPersonId, donation)
      if (plusResult.ok) state = plusResult.value

      // attitude: 既存 key のみ更新
      state = applyAttitudeIfPresent(state, faction.leaderPersonId, memberId, {
        affection: config.factionDonationAffectionGain,
        respect: config.factionDonationRespectGain,
      })
      state = applyAttitudeIfPresent(state, memberId, faction.leaderPersonId, {
        affection: config.factionDonationAffectionGainSmall,
      })
    }

    // 2. 小遣い: leader → office なし member
    for (const memberId of memberIds) {
      const member = state.persons[memberId]
      if (!member || !member.alive) continue
      if (hasActiveNonLeaderOffice(state, memberId)) continue

      const leaderNow = state.persons[faction.leaderPersonId]
      if (!leaderNow) break

      const stipend = config.factionStipendBase
      if (leaderNow.wealth >= config.factionLeaderReserveWealth + stipend) {
        const lResult = addPersonWealth(state, faction.leaderPersonId, -stipend)
        if (!lResult.ok) continue
        state = lResult.value
        const mResult = addPersonWealth(state, memberId, stipend)
        if (mResult.ok) state = mResult.value

        state = applyAttitudeIfPresent(state, memberId, faction.leaderPersonId, {
          affection: config.factionStipendAffectionGain,
          respect: config.factionStipendRespectGain,
        })
      } else {
        // 資金不足: 既存 attitude key があれば負方向
        state = applyAttitudeIfPresent(state, memberId, faction.leaderPersonId, {
          affection: -config.factionStipendShortageAffectionPenalty,
          respect: -config.factionStipendShortageRespectPenalty,
        })
      }
    }
  }

  return { ...ctx, state }
}

function hasActiveNonLeaderOffice(state: WorldState, personId: PersonId): boolean {
  const ids = state.officeIndex.byHolderPerson[personId] ?? []
  for (const id of ids) {
    const o = state.officeAssignments[id]
    if (o && o.active && o.role !== 'leader') return true
  }
  // v0.17.1 §15.3: Bailiff (ProvinceOffice) 持ちも献金経路に乗せる
  const pIds = state.provinceOfficeIndex.byHolderPerson[personId] ?? []
  for (const id of pIds) {
    const a = state.provinceOfficeAssignments[id]
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
