import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { PersonId, FactionId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import type { Person } from '../types/person'
import { isLifeStageAtLeast } from '../types/person'
import {
  getActiveFactions,
  getActiveFactionMembership,
  getFactionByLeader,
  getFactionActiveMemberIds,
  getFactionMemberCap,
  getBestRoleScore,
  getOccupationRoleFitBonus,
  getFactionLeaderPatronPower,
} from '../selectors/factionSelectors'
import { isHouselessPerson, isLandlessHouseMember } from '../selectors/availabilitySelectors'
import { isRoleEligibleBySex } from '../selectors/roleEligibilitySelectors'
import { addFactionMembership } from '../mutations/factionMutations'
import { addPersonWealth } from '../mutations/personMutations'
import { setPersonAttitude } from '../mutations/attitudeMutations'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'

function personHasActiveOffice(ctx: TickContext, pid: PersonId): boolean {
  const officeIds = ctx.state.officeIndex.byHolderPerson[pid] ?? []
  for (const oid of officeIds) {
    const o = ctx.state.officeAssignments[oid]
    if (o && o.active) return true
  }
  return false
}

// 派閥拡大 WI-2: 無役待機トラッカーを更新しながら募集 base pool を構築する (single scan)。
//
// 設計の「office assign/revoke mutation サイトで set/clear」案ではなく lazy sweep を採る:
//   - 募集は既に livingPersonIds を 12 週ごとに全走査するため、その 1 パスに idle 追跡を畳み込む。
//   - never-employed (一度も着任しない housed 成人) も自然に clock 開始でき、office mutation 側の
//     「最後の 1 職を失ったか」判定 (revoke は 1 職ずつ) を持ち込まずに済む。
//   - 12 週粒度の誤差は多年閾値に対して無視できる。employed を見たら clear するので
//     就職→失職を跨ぐ stale clock も次の sweep で補正される。
// idleSinceWeek は変化した person のみ immutable に書き換える (mutable-draft パターン)。
function maintainIdleAndBuildPool(ctx: TickContext): { ctx: TickContext; basePool: PersonId[] } {
  const { state, config } = ctx
  const week = state.absoluteWeek
  const result: PersonId[] = []
  let idleUpdates: Record<string, number | undefined> | null = null

  for (const pid of state.livingPersonIds) {
    const p = state.persons[pid]
    if (!p) continue
    if (p.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(p.lifeStage, 'young_adulthood')) continue

    const employed = personHasActiveOffice(ctx, pid)

    // idle 追跡: 無役で clock 未設定なら開始、有役で clock 残存なら解除。
    if (employed) {
      if (p.idleSinceWeek !== undefined) {
        idleUpdates ??= {}
        idleUpdates[pid as string] = undefined
      }
    } else if (p.idleSinceWeek === undefined) {
      idleUpdates ??= {}
      idleUpdates[pid as string] = week
    }

    // base pool 判定 (有役・既所属・leader・性別不適格は除外)。
    if (employed) continue
    if (getActiveFactionMembership(state, pid)) continue
    if (getFactionByLeader(state, pid)) continue
    // v0.45.3 性別役職適格ゲートを派閥募集にも適用 (派閥=任官のためのネットワーク)。
    // ungated 再試行はしない (女性ネットワークは将来サロンで受ける)。
    if (!isRoleEligibleBySex(state, config, pid)) continue

    // 従来 pool: houseless or landless は無条件で対象。
    if (isHouselessPerson(state, pid) || isLandlessHouseMember(state, pid)) {
      result.push(pid)
      continue
    }

    // WI-2: housed+landed 無役は待機期間が閾値を超えた時のみ解禁。
    //   閾値 = baseIdleYears × (1 − ambitionReduction × ambition)。野望高→短い。
    //   この tick で clock を set した者は idleSince=week → duration 0 で未解禁 (正しい)。
    const idleSince = p.idleSinceWeek ?? week
    const idleWeeks = week - idleSince
    const ambition = p.traits.ambition
    const thresholdYears =
      config.factionCrossHouseBaseIdleYears *
      (1 - config.factionCrossHouseAmbitionReduction * ambition)
    if (idleWeeks >= thresholdYears * 48) {
      result.push(pid)
    }
  }

  if (!idleUpdates) return { ctx, basePool: result }

  const nextPersons = { ...state.persons }
  for (const key of Object.keys(idleUpdates)) {
    const pid = key as PersonId
    const p = nextPersons[pid]
    if (!p) continue
    const newVal = idleUpdates[key]
    if (newVal === undefined) {
      const { idleSinceWeek: _omit, ...rest } = p
      void _omit
      nextPersons[pid] = rest
    } else {
      nextPersons[pid] = { ...p, idleSinceWeek: newVal }
    }
  }
  return { ctx: { ...ctx, state: { ...state, persons: nextPersons } }, basePool: result }
}

// v0.17 §12: FactionRecruitmentSystem (yearly, Jan, after FactionLifecycle)
// 派閥拡大 WI-0(b): faction の処理順を patron attractiveness 降順に並べ替える。
// shared base pool は先着消費 (二重所属は §4.4 invariant が弾く) なので、強く・優秀で
// prestige の高い patron が才能 pool から先に選ぶ = 引力勾配。RNG 非消費なので順序変更は
// 他 system の RNG ストリームを壊さない (recruitForFaction は wealth/attitude/membership/event のみ)。
export function runFactionRecruitmentSystem(ctx: TickContext): TickContext {
  // WI-2: idle トラッカー更新 + base pool 構築 (single scan・housed 無役を待機連動で解禁)。
  const { ctx: maintained, basePool } = maintainIdleAndBuildPool(ctx)
  let currentCtx = maintained
  const ordered = orderFactionsByAttractiveness(currentCtx)
  for (const factionId of ordered) {
    currentCtx = recruitForFaction(currentCtx, factionId, basePool)
  }
  return currentCtx
}

// attractiveness = w_power·(patronPower/10) + w_merit·(leaderScore/100) + w_prestige·(prestige/100)。
// 各項を 0-1 付近に正規化し config 重みを共通footingに。merit が load-bearing (M1≈0 是正)。
// tiebreak は faction-id 昇順。ループ前に 1 回 snapshot する (patronPower/merit は recruit 中不変)。
function orderFactionsByAttractiveness(ctx: TickContext): FactionId[] {
  const config = ctx.config
  const scored = getActiveFactions(ctx.state).map((f) => {
    const leader = ctx.state.persons[f.leaderPersonId]
    const patronPower = getFactionLeaderPatronPower(ctx.state, config, f.id)
    const merit = getBestRoleScore(ctx.state, f.leaderPersonId)
    const prestige = leader ? leader.legacyPrestige : 0
    const attractiveness =
      config.recruitAttractivenessPowerWeight * (patronPower / 10) +
      config.recruitAttractivenessMeritWeight * (merit / 100) +
      config.recruitAttractivenessPrestigeWeight * (prestige / 100)
    return { id: f.id, attractiveness }
  })
  scored.sort((a, b) =>
    b.attractiveness !== a.attractiveness
      ? b.attractiveness - a.attractiveness
      : (a.id as string) < (b.id as string)
        ? -1
        : 1,
  )
  return scored.map((s) => s.id)
}

function recruitForFaction(
  ctx: TickContext,
  factionId: FactionId,
  basePool: PersonId[],
): TickContext {
  const faction = ctx.state.factions[factionId]
  if (!faction || !faction.active) return ctx
  const leader = ctx.state.persons[faction.leaderPersonId]
  if (!leader || !leader.alive) return ctx
  const config = ctx.config

  const candidates: { personId: PersonId; score: number }[] = []
  for (const pid of basePool) {
    const p = ctx.state.persons[pid]
    if (!p || !p.alive) continue
    const score = computeRecruitmentScore(ctx, leader, p)
    candidates.push({ personId: pid, score })
  }
  candidates.sort((a, b) => b.score - a.score)

  const memberCap = getFactionMemberCap(ctx.state, config, factionId)
  const currentMemberCount = getFactionActiveMemberIds(ctx.state, factionId).length
  if (currentMemberCount >= memberCap) return ctx

  let currentCtx = ctx
  for (const { personId: candidateId } of candidates) {
    const updatedMemberCount = getFactionActiveMemberIds(currentCtx.state, factionId).length
    if (updatedMemberCount >= memberCap) break

    const candidate = currentCtx.state.persons[candidateId]
    if (!candidate || !candidate.alive) continue

    // cost / signing bonus
    const cost =
      config.baseFactionRecruitmentCost +
      candidate.legacyPrestige * config.factionRecruitmentPrestigeCostFactor +
      getBestRoleScore(currentCtx.state, candidateId) * config.factionRecruitmentAbilityCostFactor
    const signingBonus = Math.floor(cost * config.factionRecruitmentSigningBonusRate)

    const currentLeader = currentCtx.state.persons[faction.leaderPersonId]
    if (!currentLeader || currentLeader.wealth < cost) break

    // wealth transfers
    const lResult = addPersonWealth(currentCtx.state, faction.leaderPersonId, -Math.floor(cost))
    if (!lResult.ok) continue
    currentCtx = { ...currentCtx, state: lResult.value }

    const cResult = addPersonWealth(currentCtx.state, candidateId, signingBonus)
    if (cResult.ok) currentCtx = { ...currentCtx, state: cResult.value }

    // add membership
    const addResult = addFactionMembership(currentCtx.state, {
      factionId,
      personId: candidateId,
      week: currentCtx.state.absoluteWeek,
    })
    if (!addResult.ok) continue
    currentCtx = { ...currentCtx, state: addResult.value.state }

    // initial attitude
    const lToC = setPersonAttitude(
      currentCtx.state,
      faction.leaderPersonId,
      { kind: 'person', id: candidateId },
      {
        affection: config.recruitmentInitialAffection,
        respect: config.recruitmentInitialRespect,
      },
    )
    if (lToC.ok) currentCtx = { ...currentCtx, state: lToC.value }
    const cToL = setPersonAttitude(
      currentCtx.state,
      candidateId,
      { kind: 'person', id: faction.leaderPersonId },
      {
        affection: config.recruitmentInitialAffection,
        respect: config.recruitmentInitialRespect,
      },
    )
    if (cToL.ok) currentCtx = { ...currentCtx, state: cToL.value }

    // event
    const { event, ctx: ec } = createSimEvent(currentCtx, {
      type: 'PERSON_RECRUITED_TO_FACTION',
      importance: 'normal',
      messageKey: 'faction.member_recruited',
      messageParams: {
        person: nameParam('person', candidate.nameKey),
        leader: nameParam(
          'person',
          currentCtx.state.persons[faction.leaderPersonId]?.nameKey ?? 'unknown',
        ),
      },
      entityRefs: [
        entityRef('person', candidateId, 'recruit', candidate.nameKey),
        entityRef('person', faction.leaderPersonId, 'leader'),
        entityRef('faction', factionId, 'faction'),
      ],
    })
    currentCtx = { ...ec, events: [...ec.events, event] }
  }

  return currentCtx
}

function computeRecruitmentScore(ctx: TickContext, leader: Person, candidate: Person): number {
  const leaderToCand = getAttitudeOrDefault(ctx.state, leader, { kind: 'person', id: candidate.id })
  const candToLeader = getAttitudeOrDefault(ctx.state, candidate, { kind: 'person', id: leader.id })
  const occupationFit = getOccupationRoleFitBonus(candidate)
  return (
    leaderToCand.affection * 1.5 +
    leaderToCand.respect * 1.0 +
    candToLeader.affection * 0.8 +
    candToLeader.respect * 0.5 +
    // WI-0(a): talent 比重を 0.3 固定 → config 連動 (既定 1.0)。各 picker が才能を評価する。
    getBestRoleScore(ctx.state, candidate.id) * ctx.config.recruitmentTalentWeight +
    occupationFit * 0.3 +
    (candidate.legacyPrestige / 100) * 5 -
    (candidate.wealth / 100) * 1
  )
}
