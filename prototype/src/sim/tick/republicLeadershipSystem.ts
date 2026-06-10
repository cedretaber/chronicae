// v0.46 §5.2 RepublicLeadershipSystem (任期 leader 交代)
//
// 共和国 leader を、死亡時 emergency 補充だけでなく任期により交代可能にする。議会 entity は
// 作らず、OfficeAssignment.startYear から任期切れを導出する軽量 system。leader 不在の polity は
// skip し、bootstrap は emergency 補充 (selectOrCreateCommonwealthLeader) に委ねる
// (§15.1 の性別ゲート非対称: 初期 leader は ungated を保つ)。

import type { TickContext } from './context'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import type { PersonId, PolityId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { OfficeAssignment } from '../types/office'
import { assignOffice, revokeOfficeAssignment } from '../mutations/officeMutations'
import { getOfficeAssignments } from '../selectors/officeSelectors'
import { isRoleEligibleBySex } from '../selectors/roleEligibilitySelectors'
import { getPolityNameRefForEmit } from '../selectors/nameRefSelectors'
import {
  isEstablishedCommonwealthRepublic,
  getRepublicPoliticalCandidatePersons,
  scoreRepublicLeaderCandidate,
} from '../selectors/republicSelectors'

// 候補集合に性別ゲートを gated-first 適用する (leader role も例外にしない・§5.2.5)。
function applySexGate(
  state: WorldState,
  config: SimulationConfig,
  candidates: PersonId[],
): PersonId[] {
  const gated = candidates.filter((id) => isRoleEligibleBySex(state, config, id))
  if (gated.length > 0) return gated
  if (config.allowFemaleRolesWhenNoMaleCandidate) return candidates
  return gated
}

// election scoring: 共通 leader 適性 (scoreRepublicLeaderCandidate) + 現職補正
// (incumbency bonus − 在任年数比例の fatigue)。終身 leader を防ぐため fatigue で相殺する。
function scoreWithIncumbency(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  polityId: PolityId,
  currentLeaderId: PersonId,
  tenureYears: number,
): number {
  let score = scoreRepublicLeaderCandidate(state, config, personId, polityId)
  if (personId === currentLeaderId) {
    score +=
      config.republicLeaderIncumbencyBonus - tenureYears * config.republicLeaderFatiguePerYear
  }
  return score
}

function pickWinner(
  state: WorldState,
  config: SimulationConfig,
  candidates: PersonId[],
  polityId: PolityId,
  currentLeaderId: PersonId,
  tenureYears: number,
): PersonId | undefined {
  let best: { id: PersonId; score: number } | undefined
  for (const id of candidates) {
    const score = scoreWithIncumbency(state, config, id, polityId, currentLeaderId, tenureYears)
    if (
      !best ||
      score > best.score ||
      (score === best.score && (id as string).localeCompare(best.id) < 0)
    ) {
      best = { id, score }
    }
  }
  return best?.id
}

function runElection(ctx: TickContext, polityId: PolityId): TickContext {
  const state = ctx.state
  const org = { kind: 'polity' as const, id: polityId }

  // active leader OfficeAssignment (startYear が必要)。
  let leaderOffice: OfficeAssignment | undefined
  for (const office of getOfficeAssignments(state, org)) {
    if (office.active && office.role === 'leader') {
      leaderOffice = office
      break
    }
  }
  // leader 不在は skip (bootstrap は emergency 補充の責務)。
  if (!leaderOffice) return ctx

  const tenureYears = state.currentYear - leaderOffice.startYear
  if (tenureYears < ctx.config.republicLeaderTermYears) return ctx // 任期未満

  const currentLeaderId = leaderOffice.holderPersonId
  const candidates = applySexGate(
    state,
    ctx.config,
    getRepublicPoliticalCandidatePersons(state, ctx.config, polityId),
  )
  if (candidates.length === 0) return ctx

  const winnerId = pickWinner(state, ctx.config, candidates, polityId, currentLeaderId, tenureYears)
  if (!winnerId) return ctx

  // 再任 (winner == 現 leader): office を据え置き startYear を保持 (fatigue を累積させる)。event 無し。
  if (winnerId === currentLeaderId) return ctx

  // --- 交代 (winner != 現 leader) ---
  let nextState = state

  // winner が同 polity の non-leader polity office を持つなら、それだけ revoke (兼任防止)。
  // house office (house:leader 等) は残す。revokeOfficesByHolder は使わない。
  for (const officeId of nextState.officeIndex.byHolderPerson[winnerId as string] ?? []) {
    const o = nextState.officeAssignments[officeId]
    if (!o || !o.active) continue
    if (o.organization.kind === 'polity' && o.organization.id === polityId && o.role !== 'leader') {
      nextState = revokeOfficeAssignment(nextState, officeId)
    }
  }

  // 旧 leader を外して winner を leader に (replaceExisting が leader role を revoke)。
  const assignResult = assignOffice(nextState, {
    organization: org,
    role: 'leader',
    holderPersonId: winnerId,
    replaceExisting: true,
  })
  if (!assignResult.ok) return ctx
  nextState = assignResult.value

  let nextCtx: TickContext = { ...ctx, state: nextState }

  const polityRef = getPolityNameRefForEmit(nextState, polityId)
  const newLeader = nextState.persons[winnerId]
  const oldLeader = nextState.persons[currentLeaderId]
  const entityRefs = [
    entityRef('polity', polityId, 'polity', polityRef.nameKey),
    entityRef('person', winnerId, 'new_leader', newLeader?.nameKey),
    entityRef('person', currentLeaderId, 'old_leader', oldLeader?.nameKey),
  ]
  if (newLeader?.houseId) {
    const house = nextState.houses[newLeader.houseId]
    entityRefs.push(entityRef('house', newLeader.houseId, 'new_leader_house', house?.nameKey))
  }
  const { event, ctx: eventCtx } = createSimEvent(nextCtx, {
    type: 'REPUBLIC_LEADER_ELECTED',
    importance: 'major',
    messageKey: 'republic.leader_elected',
    messageParams: {
      polity: nameParam(polityRef.category, polityRef.nameKey),
      newLeader: nameParam('person', newLeader?.nameKey ?? ''),
      oldLeader: nameParam('person', oldLeader?.nameKey ?? ''),
    },
    entityRefs,
  })
  nextCtx = { ...eventCtx, state: nextState, events: [...eventCtx.events, event] }

  return nextCtx
}

export function runRepublicLeadershipSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  for (const polityId of Object.keys(currentCtx.state.polities) as PolityId[]) {
    if (!isEstablishedCommonwealthRepublic(currentCtx.state, polityId)) continue
    currentCtx = runElection(currentCtx, polityId)
  }
  return currentCtx
}
