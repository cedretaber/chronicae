import type { TickContext } from './context'
import type { PersonId } from '../types/ids'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import { getActiveFactions, getFactionActiveMemberIds } from '../selectors/factionSelectors'
import { personAttitudeKey, updateAttitudeIfExists } from '../helpers/attitudeHelpers'

// v0.17 §11 + v0.17.4 §13.11: FactionPatronageSystem (毎年 1 月)
// 派閥 leader と member 間の献金 / 小遣いを処理する。
// attitude 更新は updateAttitudeIfExists で既存 key のみ (新規 key は作らない)。
// v0.17.4: stipend を払えなかった member が >= 1 かつ leader.wealth が解散閾値を上回る場合
// FACTION_FUNDS_SHORTAGE event を 1 派閥 1 年 1 回 emit する。
//
// perf (v0.47): mutable-draft パターン (taskSystem v0.23.1 と同型)。
//   かつては per-call の addPersonWealth / adjustPersonAttitudeIfExists が呼び出しごとに
//   persons 全マップを spread しており (年次だが数百回)、decade1→10 で 28-39 倍成長していた。
//   draft は最初の変更時に persons を 1 回だけ浅コピーし、以降は既存キーのオブジェクト置換
//   (クランプ位置・読み書き順序は per-call 版と同一) で bit-identical を保つ。
export function runFactionPatronageSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const config = ctx.config

  // lazy draft: 変更が 1 件も無い run では state をコピーしない。
  let draft: WorldState | undefined
  const ensureDraft = (): WorldState => {
    if (!draft) {
      draft = { ...currentCtx.state, persons: { ...currentCtx.state.persons } }
      currentCtx = { ...currentCtx, state: draft }
    }
    return draft
  }
  const cur = (): WorldState => draft ?? currentCtx.state

  // 旧 addPersonWealth と同一挙動 (person 不在なら no-op、wealth は 0 でクランプ)。
  const addPersonWealthMut = (personId: PersonId, delta: number): boolean => {
    const d = ensureDraft()
    const p = d.persons[personId]
    if (!p) return false
    d.persons[personId] = { ...p, wealth: Math.max(0, p.wealth + delta) }
    return true
  }
  // 旧 adjustPersonAttitudeIfExists と同一挙動 (person 不在 / key 不在は no-op)。
  const applyAttitudeIfPresentMut = (
    sourcePersonId: PersonId,
    targetPersonId: PersonId,
    delta: { affection?: number; respect?: number },
  ): void => {
    const p = cur().persons[sourcePersonId]
    if (!p) return
    const newAttitudes = updateAttitudeIfExists(
      p.attitudes,
      personAttitudeKey(targetPersonId),
      delta,
    )
    if (newAttitudes === p.attitudes) return
    const d = ensureDraft()
    const p2 = d.persons[sourcePersonId]
    if (!p2) return
    d.persons[sourcePersonId] = { ...p2, attitudes: newAttitudes }
  }

  for (const faction of getActiveFactions(currentCtx.state)) {
    const leader = cur().persons[faction.leaderPersonId]
    if (!leader || !leader.alive) continue

    const memberIds = getFactionActiveMemberIds(currentCtx.state, faction.id).filter(
      (mid) => mid !== faction.leaderPersonId,
    )

    // 1. 献金: office 持ち member → leader
    for (const memberId of memberIds) {
      const member = cur().persons[memberId]
      if (!member || !member.alive) continue
      if (member.wealth <= config.factionDonationPersonalReserve) continue

      const hasOffice = hasActiveNonLeaderOffice(currentCtx.state, memberId)
      if (!hasOffice) continue

      const donationCap = member.wealth - config.factionDonationPersonalReserve
      const donationDesired = Math.floor(member.wealth * config.factionDonationRate)
      const donation = Math.max(1, Math.min(donationCap, donationDesired))
      if (donation <= 0) continue

      if (!addPersonWealthMut(memberId, -donation)) continue
      addPersonWealthMut(faction.leaderPersonId, donation)

      applyAttitudeIfPresentMut(faction.leaderPersonId, memberId, {
        affection: config.factionDonationAffectionGain,
        respect: config.factionDonationRespectGain,
      })
      applyAttitudeIfPresentMut(memberId, faction.leaderPersonId, {
        affection: config.factionDonationAffectionGainSmall,
      })
    }

    // 2. 小遣い: leader → office なし member
    let unpaidCount = 0
    for (const memberId of memberIds) {
      const member = cur().persons[memberId]
      if (!member || !member.alive) continue
      if (hasActiveNonLeaderOffice(currentCtx.state, memberId)) continue

      const leaderNow = cur().persons[faction.leaderPersonId]
      if (!leaderNow) break

      const stipend = config.factionStipendBase
      if (leaderNow.wealth >= config.factionLeaderReserveWealth + stipend) {
        if (!addPersonWealthMut(faction.leaderPersonId, -stipend)) continue
        addPersonWealthMut(memberId, stipend)

        applyAttitudeIfPresentMut(memberId, faction.leaderPersonId, {
          affection: config.factionStipendAffectionGain,
          respect: config.factionStipendRespectGain,
        })
      } else {
        unpaidCount++
        // 資金不足: 既存 attitude key があれば負方向
        applyAttitudeIfPresentMut(memberId, faction.leaderPersonId, {
          affection: -config.factionStipendShortageAffectionPenalty,
          respect: -config.factionStipendShortageRespectPenalty,
        })
      }
    }

    // v0.17.4 §13.11: FACTION_FUNDS_SHORTAGE — 1 派閥 1 年 1 回
    // 完全破産 (LEADER_BANKRUPT) は factionLifecycleSystem 側で扱うので除外する。
    if (unpaidCount >= 1) {
      const leaderAfter = cur().persons[faction.leaderPersonId]
      if (leaderAfter && leaderAfter.wealth >= config.factionDisbandWealthFloor) {
        const { event, ctx: ec } = createSimEvent(currentCtx, {
          type: 'FACTION_FUNDS_SHORTAGE',
          importance: 'normal',
          messageKey: 'faction.funds_shortage',
          messageParams: {
            person: nameParam('person', leaderAfter.nameKey),
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
