import type { TickContext } from './context'
import type { PersonId, FactionMembershipId } from '../types/ids'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import { makeEventId } from './context'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import { getActiveFactions } from '../selectors/factionSelectors'
import { removeFactionMembership } from '../mutations/factionMutations'
import { adjustPersonAttitudeIfExists } from '../mutations/attitudeMutations'
import { randomFloat } from '../rng/rng'

// v0.17.4 §13.9: FactionDefectionSystem
// 派閥所属しているのに「利益 (= active な Office 在任)」のない時間が長期化した
// member が確率的に派閥を抜ける。leader は対象外。
// 年 1 回 (1 月) のみ実行。tick.ts では factionPatronage の直後に走らせ、
// 同年の patronage 結果 (donation/stipend) を反映した上で判定する。
//
// 設計判断 (2026-05-19): stipend 受領は「利益」に含めない。リッチな leader が
// 機械的に stipend を払い続けるパターンで defection が無効化される問題を回避するため、
// 利益判定は active Office (Polity/House/Bailiff) のみに限定する。stipend は member への
// ギフトに留まり、引き留め力を持たない設計とする。lastBenefitYear cache は導入しない。
export function runFactionDefectionSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  for (const faction of getActiveFactions(currentCtx.state)) {
    const leader = currentCtx.state.persons[faction.leaderPersonId]
    if (!leader || !leader.alive) continue

    // この faction に属する全 active membership を deterministic 順で iterate。
    // removeFactionMembership が byMember を破壊的に書き換えるため、id を先に snapshot する。
    const targetMembershipIds = (
      Object.keys(currentCtx.state.factionMemberships).sort() as FactionMembershipId[]
    ).filter((mid) => {
      const m = currentCtx.state.factionMemberships[mid]
      return Boolean(
        m && m.active && m.factionId === faction.id && m.personId !== faction.leaderPersonId,
      )
    })

    for (const membershipId of targetMembershipIds) {
      const membership = currentCtx.state.factionMemberships[membershipId]
      if (!membership || !membership.active) continue
      const member = currentCtx.state.persons[membership.personId]
      if (!member || !member.alive) continue

      // (a) Office 保有チェック — 利益あり → skip
      if (hasActiveOfficeOrBailiff(currentCtx.state, membership.personId)) continue

      // (b) idle 計算 — joinedWeek を起点とする
      const idle = Math.floor(
        (currentCtx.state.absoluteWeek - membership.joinedWeek) / WEEKS_PER_YEAR,
      )
      if (idle < currentCtx.config.factionDefectionGraceYears) continue

      // 確率判定
      const prob = Math.min(
        1,
        (idle - currentCtx.config.factionDefectionGraceYears) *
          currentCtx.config.factionDefectionProbPerYear,
      )
      const { value: roll, rng: nextRng } = randomFloat(currentCtx.rng)
      currentCtx = { ...currentCtx, rng: nextRng }
      if (roll >= prob) continue

      // 離脱実行: membership 削除 → attitude penalty → event emit
      const removed = removeFactionMembership(currentCtx.state, membershipId)
      if (!removed.ok) continue
      let stateAfter = removed.value

      const attitudeResult = adjustPersonAttitudeIfExists(
        stateAfter,
        membership.personId,
        { kind: 'person', id: faction.leaderPersonId },
        {
          affection: -currentCtx.config.factionDefectionAttitudeAffectionPenalty,
          respect: -currentCtx.config.factionDefectionAttitudeRespectPenalty,
        },
      )
      if (attitudeResult.ok) stateAfter = attitudeResult.value

      currentCtx = { ...currentCtx, state: stateAfter }

      const { id: eventId, ctx: ec } = makeEventId(currentCtx)
      const event: SimEvent = {
        id: eventId,
        year: ec.state.currentYear,
        weekOfYear: ec.state.currentWeekOfYear,
        type: 'FACTION_MEMBER_ABANDONED',
        importance: 'minor',
        actorIds: [membership.personId, faction.leaderPersonId],
        houseIds: [member.houseId],
        polityIds: [],
        provinceIds: [],
        holdingIds: [],
        summary: `${member.name} abandoned ${faction.name}.`,
        reasons: [],
        effects: [],
      }
      currentCtx = { ...ec, events: [...ec.events, event] }
    }
  }
  return currentCtx
}

function hasActiveOfficeOrBailiff(state: WorldState, personId: PersonId): boolean {
  const ids = state.officeIndex.byHolderPerson[personId] ?? []
  for (const id of ids) {
    const o = state.officeAssignments[id]
    if (o && o.active && o.role !== 'leader') return true
  }
  const hIds = state.holdingOfficeIndex.byHolderPerson[personId] ?? []
  for (const id of hIds) {
    const a = state.holdingOfficeAssignments[id]
    if (a && a.active) return true
  }
  return false
}
