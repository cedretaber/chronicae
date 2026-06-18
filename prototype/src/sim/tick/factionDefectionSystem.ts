import type { TickContext } from './context'
import type { PersonId, FactionMembershipId, ProjectId } from '../types/ids'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import type { WorldState } from '../types/world'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import { getActiveFactions, getFactionActiveMemberIds } from '../selectors/factionSelectors'
import { removeFactionMembership } from '../mutations/factionMutations'
import { adjustPersonAttitudeIfExists } from '../mutations/attitudeMutations'
import { randomFloat } from '../rng/rng'

// v0.51.1: FactionDefectionSystem
// 派閥所属しているのに「利益 (= active な Office/Bailiff 在任、または国・家の
// active Project の supervisor)」のない期間が長期化した member が確率的に離脱する。
// leader は対象外。四半期ごと (12週間隔) に実行。
//
// idle 起点は membership.lastActiveWeek。Office/Bailiff/国家 Project を保持している
// member はチェック時に lastActiveWeek を現在週へ更新しスキップする。
// 無役期間が factionDefectionGraceYears を超えると確率的に離脱する。
//
// 設計判断: stipend 受領は「利益」に含めない (リッチな leader の機械的 stipend で
// defection が無効化される問題を回避)。個人 Project (personal_training 等) も
// 派閥としての「仕事」ではないため除外する。
export function runFactionDefectionSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  for (const faction of getActiveFactions(currentCtx.state)) {
    const leader = currentCtx.state.persons[faction.leaderPersonId]
    if (!leader || !leader.alive) continue

    // 崩壊2: 派閥の placement ratio (役職を配れた member 比) を 1 回算出。
    const overreach = currentCtx.config.factionCollapseOverreachEnabled
      ? 1 - computePlacementRatio(currentCtx.state, faction.id)
      : 0

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

      // (a) 「仕事」保有チェック — Office/Bailiff または国・家 Project の supervisor
      if (hasActiveWork(currentCtx.state, membership.personId)) {
        // lastActiveWeek を現在週に更新してスキップ
        currentCtx = updateLastActiveWeek(currentCtx, membershipId)
        continue
      }

      // (b) idle 計算 — lastActiveWeek を起点とする無役期間
      const idle = Math.floor(
        (currentCtx.state.absoluteWeek - membership.lastActiveWeek) / WEEKS_PER_YEAR,
      )
      if (idle < currentCtx.config.factionDefectionGraceYears) continue

      // 確率判定
      const base =
        (idle - currentCtx.config.factionDefectionGraceYears) *
        currentCtx.config.factionDefectionProbPerYear
      const ambitionMult = currentCtx.config.factionCollapseOverreachEnabled
        ? 1 + currentCtx.config.factionAmbitionDefectionWeight * member.traits.ambition
        : 1
      const overreachMult = 1 + currentCtx.config.factionOverreachDefectionWeight * overreach
      const prob = Math.min(1, base * overreachMult * ambitionMult)
      const { value: roll, rng: nextRng } = randomFloat(currentCtx.rng)
      currentCtx = { ...currentCtx, rng: nextRng }
      if (roll >= prob) continue

      // 離脱実行
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

      const { event, ctx: ec } = createSimEvent(currentCtx, {
        type: 'FACTION_MEMBER_ABANDONED',
        importance: 'minor',
        messageKey: 'faction.member_abandoned',
        messageParams: {
          person: nameParam('person', member.nameKey),
          leader: nameParam(
            'person',
            currentCtx.state.persons[faction.leaderPersonId]?.nameKey ?? 'unknown',
          ),
        },
        entityRefs: [
          entityRef('person', membership.personId, 'defector', member.nameKey),
          entityRef('person', faction.leaderPersonId, 'leader'),
          entityRef('faction', faction.id, 'faction'),
        ],
      })
      currentCtx = { ...ec, events: [...ec.events, event] }
    }
  }
  return currentCtx
}

// 崩壊2: 派閥 member のうち active な「仕事」を持つ比率。
function computePlacementRatio(
  state: WorldState,
  factionId: import('../types/ids').FactionId,
): number {
  const memberIds = getFactionActiveMemberIds(state, factionId)
  if (memberIds.length === 0) return 1
  let placed = 0
  for (const mid of memberIds) {
    if (hasActiveWork(state, mid)) placed++
  }
  return placed / memberIds.length
}

// Office/Bailiff または国・家の active Project supervisor を持つか
function hasActiveWork(state: WorldState, personId: PersonId): boolean {
  if (hasActiveOfficeOrBailiff(state, personId)) return true
  if (hasActiveOrgProject(state, personId)) return true
  return false
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

// 国 (polity) または家 (house) が owner の active Project で supervisor を務めているか。
// 個人 Project (personal_training, enfeoffment_petition 等) は派閥としての「仕事」ではないため除外。
function hasActiveOrgProject(state: WorldState, personId: PersonId): boolean {
  const projectIds: ProjectId[] = state.projectIndex.bySupervisorPerson[personId as string] ?? []
  for (const pid of projectIds) {
    const project = state.projects[pid]
    if (!project || project.status !== 'active') continue
    if (project.owner.kind === 'polity' || project.owner.kind === 'house') return true
  }
  return false
}

function updateLastActiveWeek(ctx: TickContext, membershipId: FactionMembershipId): TickContext {
  const membership = ctx.state.factionMemberships[membershipId]
  if (!membership) return ctx
  return {
    ...ctx,
    state: {
      ...ctx.state,
      factionMemberships: {
        ...ctx.state.factionMemberships,
        [membershipId]: { ...membership, lastActiveWeek: ctx.state.absoluteWeek },
      },
    },
  }
}
