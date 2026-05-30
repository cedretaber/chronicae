import type { WorldState } from '@sim/types/world'
import type { War, WarSideKey } from '@sim/types/war'
import type { PersonId, PolityId, ProvinceId } from '@sim/types/ids'
import { getActiveOfficeHolders, getPolityLeader } from '@sim/selectors/officeSelectors'
import { getRoleScore } from '@sim/selectors/abilitySelectors'

// v0.35 Phase A: 「誰が指揮するか / どの province で戦うか」の構造 selector。
//   pure / config 非依存 / sim 層 (i18n・app 非依存)。WarManeuverSystem (Phase B) が消費する。
//   captainGeneral / commander は soft reference のため、ここでは「現時点で適格な候補」を都度算出する
//   (毎週 lazy 再選出する前提。state に保存された ID の生存保証はしない)。

// --- eligibility ---

// 総大将 / 指揮官候補になれる人物の最小条件: 実在・生存・非 placeholder。
//   getActiveOfficeHolders は office.active のみで filter し死亡者を除外しないため、ここで明示する。
function isEligibleWarPerson(state: WorldState, personId: PersonId): boolean {
  const p = state.persons[personId]
  return Boolean(p && p.alive && p.kind !== 'placeholder')
}

// warCommand 降順 → personId 昇順で安定ソートする (replay 決定性のための tie-break)。
function sortByWarCommandThenId(state: WorldState, ids: PersonId[]): PersonId[] {
  return [...ids].sort((a, b) => {
    const scoreB = getRoleScore(state, b, 'warCommand')
    const scoreA = getRoleScore(state, a, 'warCommand')
    if (scoreB !== scoreA) return scoreB - scoreA // warCommand desc
    return a.localeCompare(b) // personId asc
  })
}

// --- selectors ---

// WarSide の primary participant が polity actor ならその PolityId を返す。
//   War は polity-polity 固定 (WarCreationSystem が strict polity-polity) なので実質常に解決する。
export function getWarSidePrimaryPolityActor(war: War, sideKey: WarSideKey): PolityId | undefined {
  const side = sideKey === 'attacker' ? war.attacker : war.defender
  const actor = side.participants.find((p) => p.primary)?.actor
  return actor?.kind === 'polity' ? actor.id : undefined
}

// その polity の総大将を選出する。
//   優先順: active military office holder (warCommand 最高) → polity leader → undefined。
//   leader は総大将としては除外しない (commander 候補とは異なり、総大将は leader 親征を許容する)。
export function selectCaptainGeneralForWarSide(
  state: WorldState,
  polityId: PolityId,
): PersonId | undefined {
  const military = getActiveOfficeHolders(
    state,
    { kind: 'polity', id: polityId },
    'military',
  ).filter((id) => isEligibleWarPerson(state, id))
  if (military.length > 0) {
    return sortByWarCommandThenId(state, military)[0]
  }
  const leader = getPolityLeader(state, polityId)
  if (leader !== undefined && isEligibleWarPerson(state, leader)) return leader
  return undefined
}

// 指定人物が現場指揮官として適格か。
//   条件: 適格人物 (生存・非placeholder) かつ active military office holder。
//   leader 除外: polity leader は「総大将を兼ねる」場合を除き commander 候補にならない (§5.4)。
export function isEligibleBattleCommander(
  state: WorldState,
  polityId: PolityId,
  personId: PersonId,
  captainGeneralId: PersonId | undefined,
): boolean {
  if (!isEligibleWarPerson(state, personId)) return false
  const military = getActiveOfficeHolders(state, { kind: 'polity', id: polityId }, 'military')
  if (!military.includes(personId)) return false
  const leader = getPolityLeader(state, polityId)
  if (leader !== undefined && personId === leader) {
    // leader は captainGeneral を兼ねる時のみ commander 候補に残る。
    if (captainGeneralId === undefined || personId !== captainGeneralId) return false
  }
  return true
}

// その polity の現場指揮官候補リストを構築する (leader 除外 + 重複排除 + warCommand desc / personId asc)。
export function buildWarSideCommanderCandidates(
  state: WorldState,
  polityId: PolityId,
  captainGeneralId: PersonId | undefined,
): PersonId[] {
  const military = getActiveOfficeHolders(state, { kind: 'polity', id: polityId }, 'military')
  const eligible = military.filter((id) =>
    isEligibleBattleCommander(state, polityId, id, captainGeneralId),
  )
  const deduped = [...new Set(eligible)]
  return sortByWarCommandThenId(state, deduped)
}

// War の係争 province を warGoals[0] から解決する。未解決 (goal / holding 不在) は undefined。
export function getWarGoalProvince(state: WorldState, war: War): ProvinceId | undefined {
  const goal = war.warGoals[0]
  if (!goal) return undefined
  return state.holdings[goal.holdingId]?.provinceId
}
