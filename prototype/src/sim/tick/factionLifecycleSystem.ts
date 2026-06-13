import type { TickContext } from './context'
import type { PersonId, FactionId, HouseId } from '../types/ids'
import type { Faction } from '../types/faction'
import { createSimEvent } from './context'
import { isLifeStageAtLeast } from '../types/person'
import { nameParam, entityRef } from '../types/event'
import {
  getFactionByLeader,
  getActiveFactionMembership,
  getFactionActiveMemberIds,
  getFactionOpportunityScore,
  getFactionViabilityScore,
  getBestRoleScore,
  getActiveFactions,
  getFactionNominationPower,
} from '../selectors/factionSelectors'
import { getTopShareholders, getPersonHouseSharePercent } from '../selectors/shareSelectors'
import {
  createFaction,
  addFactionMembership,
  deactivateFaction,
  transitionFactionLeader,
  removeFactionMembership,
  setFactionParent,
} from '../mutations/factionMutations'
import { setPersonAttitude } from '../mutations/attitudeMutations'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'
import { isRoleEligibleBySex } from '../selectors/roleEligibilitySelectors'
import { getProvinceTerminalPolityId } from '../selectors/landContractSelectors'

// v0.19: FactionLifecycleYearlySystem (intervalWeeks=52)
// Dissolution checks + new faction formation. Runs once per year.
// Leader vacancy + dead member cleanup is handled by FactionMaintenanceSystem (intervalWeeks=4).
export function runFactionLifecycleSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  currentCtx = checkDissolutions(currentCtx)
  currentCtx = formNewFactions(currentCtx)
  currentCtx = formNestedFactions(currentCtx)

  return currentCtx
}

// 入れ子 (Phase 2-a 形成): 低迷した弱小 root 派閥 W が、同一 polity の強い root 派閥 P の
// 傘下に入る (§4.0)。「席を獲得できず低迷した庇護者が、強い庇護者に従属する」。
// case X = 同一 polity 限定 (越境 case Y は defer)。RNG 非消費・deterministic。
function formNestedFactions(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const config = currentCtx.config
  const week = currentCtx.state.absoluteWeek
  const minAgeWeeks = config.factionNestingMinAgeYears * 48

  // 強い root 候補 P を polity ごとに 1 回列挙する (NP>=閾値・root・分岐余裕)。
  const rootFactions = getActiveFactions(currentCtx.state).filter(
    (f) => f.parentFactionId === undefined,
  )
  const npOf = (f: Faction) =>
    getFactionNominationPower(
      currentCtx.state,
      config,
      f.id,
      { kind: 'polity', id: f.polityId },
      'advisor',
    )

  // 弱小 W: root・NP<閾値・存続 minAge 超。id 昇順で処理 (deterministic)。
  const weakIds = rootFactions
    .filter(
      (f) =>
        week - f.foundingWeek >= minAgeWeeks && npOf(f) < config.factionNominationPowerThreshold,
    )
    .map((f) => f.id)
    .sort()

  for (const wid of weakIds) {
    const w = currentCtx.state.factions[wid]
    if (!w || !w.active || w.parentFactionId !== undefined) continue
    const wLeader = currentCtx.state.persons[w.leaderPersonId]
    if (!wLeader) continue

    // P は root (深さ 0) に attach するので、結果ツリーの最大深さ = 1 + W の subtree 深さ。
    // これが maxDepth を超える W は傘下入りさせない (W が既に深い木を持つ場合)。
    if (1 + subtreeDepth(currentCtx.state, wid) > config.factionNestingMaxDepth) continue

    // 候補 P: 同一 polity・root・P!=W・NP>=閾値・分岐余裕。
    let best: { id: FactionId; score: number } | undefined
    for (const p of getActiveFactions(currentCtx.state)) {
      if (p.id === wid) continue
      if (p.parentFactionId !== undefined) continue
      if (p.polityId !== w.polityId) continue
      const branches = currentCtx.state.factionIndex.byParent[p.id]?.length ?? 0
      if (branches >= config.factionNestingMaxBranches) continue
      const pNp = npOf(p)
      if (pNp < config.factionNominationPowerThreshold) continue
      const pLeader = currentCtx.state.persons[p.leaderPersonId]
      if (!pLeader) continue
      // スコア: W リーダー → P リーダーの attitude + P の NP (強く・親しい庇護者を選ぶ)。
      const att = getAttitudeOrDefault(currentCtx.state, wLeader, {
        kind: 'person',
        id: p.leaderPersonId,
      })
      const score = (att.affection + att.respect) / 100 + pNp
      if (
        !best ||
        score > best.score ||
        (score === best.score && (p.id as string) < (best.id as string))
      ) {
        best = { id: p.id, score }
      }
    }
    if (!best) continue

    const result = setFactionParent(currentCtx.state, wid, best.id)
    if (!result.ok) continue
    currentCtx = { ...currentCtx, state: result.value }
    const patronLeader =
      currentCtx.state.persons[currentCtx.state.factions[best.id]?.leaderPersonId ?? wLeader.id]
    const { event, ctx: ec } = createSimEvent(currentCtx, {
      type: 'FACTION_NESTED',
      importance: 'normal',
      messageKey: 'faction.nested',
      messageParams: {
        leader: nameParam('person', wLeader.nameKey),
        patron: nameParam('person', patronLeader?.nameKey ?? 'unknown'),
      },
      entityRefs: [
        entityRef('faction', wid, 'faction'),
        entityRef('faction', best.id, 'parent'),
        entityRef('person', w.leaderPersonId, 'leader', wLeader.nameKey),
      ],
    })
    currentCtx = { ...ec, events: [...ec.events, event] }
  }

  return currentCtx
}

// 入れ子: faction の subtree 深さ (子なし=0、子があれば 1 + max(子の subtree 深さ))。
// byParent を辿る。循環は guard で防ぐ (整合状態では発生しない)。
function subtreeDepth(
  state: TickContext['state'],
  factionId: FactionId,
  guard: Set<string> = new Set(),
): number {
  if (guard.has(factionId)) return 0
  guard.add(factionId)
  const children = state.factionIndex.byParent[factionId] ?? []
  let best = 0
  for (const cid of children) {
    const d = 1 + subtreeDepth(state, cid, guard)
    if (d > best) best = d
  }
  return best
}

function checkDissolutions(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const factionIds = (Object.keys(currentCtx.state.factions).sort() as FactionId[]).filter(
    (fid) => currentCtx.state.factions[fid]?.active,
  )
  for (const factionId of factionIds) {
    const faction = currentCtx.state.factions[factionId]
    if (!faction || !faction.active) continue

    const leader = currentCtx.state.persons[faction.leaderPersonId]
    if (!leader || !leader.alive || leader.kind === 'placeholder') continue

    const memberIds = getFactionActiveMemberIds(currentCtx.state, factionId)
    const viability = getFactionViabilityScore(currentCtx.state, currentCtx.config, factionId)
    const config = currentCtx.config

    if (!leader.houseId) continue
    const leaderHouse = currentCtx.state.houses[leader.houseId]

    // 解散理由は enum コードで保持し、表示ラベルは events ns の
    // enum.factionDissolveReason.* (eventRenderer) に解決させる
    const reasonsToDissolve: string[] = []
    if (!leaderHouse || !leaderHouse.active || leaderHouse.kind === 'system')
      reasonsToDissolve.push('leader_unaffiliated')
    // v0.42 §12.3: anchor polity inactive の安全網 (主処理は polityOwnerConsistency の即時 cascade)
    const anchorPolity = currentCtx.state.polities[faction.polityId]
    if (!anchorPolity || !anchorPolity.active) reasonsToDissolve.push('anchor_polity_dissolved')
    if (memberIds.length < config.minimumFactionMembers)
      reasonsToDissolve.push('insufficient_members')
    if (viability < config.factionDisbandThreshold) reasonsToDissolve.push('low_viability')
    if (leader.wealth < config.factionDisbandWealthFloor) reasonsToDissolve.push('leader_bankrupt')

    if (reasonsToDissolve.length > 0) {
      if (reasonsToDissolve.includes('leader_bankrupt')) {
        const { event, ctx: ec } = createSimEvent(currentCtx, {
          type: 'FACTION_LEADER_BANKRUPT',
          importance: 'normal',
          messageKey: 'faction.leader_bankrupt',
          messageParams: {
            person: nameParam('person', leader.nameKey),
          },
          entityRefs: [
            entityRef('person', faction.leaderPersonId, 'leader', leader.nameKey),
            entityRef('faction', factionId, 'faction'),
          ],
        })
        currentCtx = { ...ec, events: [...ec.events, event] }
      }
      // 複数該当時は優先順 (判定順) の先頭 1 つを代表理由として表示する
      currentCtx = dissolveFaction(currentCtx, factionId, reasonsToDissolve[0] ?? 'low_viability')
    }
  }
  return currentCtx
}

// Exported for use by FactionMaintenanceSystem
export function handleFactionLeaderVacancy(ctx: TickContext, factionId: FactionId): TickContext {
  const faction = ctx.state.factions[factionId]
  if (!faction) return ctx

  const memberIds = getFactionActiveMemberIds(ctx.state, factionId).filter(
    (id) => id !== faction.leaderPersonId,
  )
  const oldLeader = ctx.state.persons[faction.leaderPersonId]

  // v0.45.3 性別役職適格ゲート: gated で候補ゼロの場合のみ ungated 再試行
  // (fallback off だと男性候補の居ない派閥は従来より解散しやすくなる — 仕様変更)。
  const collect = (gate: boolean): { personId: PersonId; score: number }[] => {
    const candidates: { personId: PersonId; score: number }[] = []
    for (const candidateId of memberIds) {
      const candidate = ctx.state.persons[candidateId]
      if (!candidate || !candidate.alive) continue
      if (candidate.kind === 'placeholder') continue
      if (!candidate.houseId) continue
      const candidateHouse = ctx.state.houses[candidate.houseId]
      if (!candidateHouse || !candidateHouse.active || candidateHouse.kind === 'system') continue
      if (gate && !isRoleEligibleBySex(ctx.state, ctx.config, candidateId)) continue

      let attitudeProduct = 0
      if (oldLeader) {
        const att = getAttitudeOrDefault(ctx.state, candidate, {
          kind: 'person',
          id: faction.leaderPersonId,
        })
        attitudeProduct = ((att.affection + 100) * (att.respect + 100)) / 1000
      }
      const oppScore = getFactionOpportunityScore(ctx.state, ctx.config, candidateId)
      const wealthScore = candidate.wealth / 100
      const prestigeScore = (candidate.legacyPrestige / 100) * 5
      const score = attitudeProduct + oppScore * 2 + wealthScore + prestigeScore
      candidates.push({ personId: candidateId, score })
    }
    candidates.sort((a, b) => b.score - a.score)
    return candidates
  }

  let candidates = collect(true)
  if (candidates.length === 0 && ctx.config.allowFemaleRolesWhenNoMaleCandidate) {
    candidates = collect(false)
  }

  if (candidates.length === 0 || !candidates[0]) {
    return dissolveFaction(ctx, factionId, 'leader_died')
  }

  const newLeaderId = candidates[0].personId
  const result = transitionFactionLeader(ctx.state, { factionId, newLeaderPersonId: newLeaderId })
  if (!result.ok) {
    return dissolveFaction(ctx, factionId, 'leader_transition_failed')
  }
  const ctx1: TickContext = { ...ctx, state: result.value }
  const newLeader = ctx1.state.persons[newLeaderId]
  const { event, ctx: ec } = createSimEvent(ctx1, {
    type: 'FACTION_LEADER_CHANGED',
    importance: 'normal',
    messageKey: 'faction.leader_changed',
    messageParams: {
      newLeader: nameParam('person', newLeader?.nameKey ?? 'unknown'),
      oldLeader: nameParam('person', oldLeader?.nameKey ?? 'unknown'),
    },
    entityRefs: [
      entityRef('person', newLeaderId, 'newLeader', newLeader?.nameKey),
      entityRef('person', faction.leaderPersonId, 'oldLeader', oldLeader?.nameKey),
      entityRef('faction', factionId, 'faction'),
    ],
  })
  const ctx2: TickContext = { ...ec, events: [...ec.events, event] }

  // 派閥拡大 WI-3 崩壊1: 不完全な継承。求心力の弱い跡継ぎ (newLeader) に対し、
  // 高野望・高才能・低忠誠の member は離散する (pool へ戻り再結集・rival 募集の素材になる)。
  // 「先代のスター子飼いが跡継ぎを認めず独立する」= 集積を有限化する最強のブレーキ (SR-5)。
  if (ctx2.config.factionCollapseSuccessionEnabled) {
    return applySuccessionScatter(ctx2, factionId, newLeaderId)
  }
  return ctx2
}

// 崩壊1: 新 leader 着座後、忠誠の薄い高野望・高才能 member を離散させる (deterministic・RNG 非消費)。
//   scatterScore = ambition × (1 − loyaltyToNewLeader) × (0.5 + talent)
//   loyalty は newLeader への attitude (affection/respect) を 0-1 化。talent は bestRoleScore/100。
function applySuccessionScatter(
  ctx: TickContext,
  factionId: FactionId,
  newLeaderId: PersonId,
): TickContext {
  let currentCtx = ctx
  const threshold = ctx.config.factionSuccessionScatterThreshold
  // member 集合を id 昇順で snapshot (removeFactionMembership が byMember を書き換えるため)。
  const memberIds = getFactionActiveMemberIds(ctx.state, factionId).filter(
    (id) => id !== newLeaderId,
  )
  for (const memberId of memberIds) {
    const member = currentCtx.state.persons[memberId]
    if (!member || !member.alive || member.kind === 'placeholder') continue
    const att = getAttitudeOrDefault(currentCtx.state, member, { kind: 'person', id: newLeaderId })
    const loyalty = Math.max(0, Math.min(1, (att.affection + att.respect + 200) / 400))
    const talent = getBestRoleScore(currentCtx.state, memberId) / 100
    const scatterScore = member.traits.ambition * (1 - loyalty) * (0.5 + talent)
    if (scatterScore <= threshold) continue

    const membership = getActiveFactionMembership(currentCtx.state, memberId)
    if (!membership || membership.factionId !== factionId) continue
    const removed = removeFactionMembership(currentCtx.state, membership.id)
    if (!removed.ok) continue
    currentCtx = { ...currentCtx, state: removed.value }

    const newLeaderName = currentCtx.state.persons[newLeaderId]?.nameKey ?? 'unknown'
    const { event, ctx: ec } = createSimEvent(currentCtx, {
      type: 'FACTION_MEMBER_ABANDONED',
      importance: 'minor',
      messageKey: 'faction.member_abandoned',
      messageParams: {
        person: nameParam('person', member.nameKey),
        leader: nameParam('person', newLeaderName),
      },
      entityRefs: [
        entityRef('person', memberId, 'defector', member.nameKey),
        entityRef('person', newLeaderId, 'leader', newLeaderName),
        entityRef('faction', factionId, 'faction'),
      ],
    })
    currentCtx = { ...ec, events: [...ec.events, event] }
  }
  return currentCtx
}

// reason は enum コード ('leader_died' 等) — 表示ラベル解決は eventRenderer
// (enum.factionDissolveReason.*)。英文をここで組み立てない (sim 層はロケール中立)
function dissolveFaction(ctx: TickContext, factionId: FactionId, reason: string): TickContext {
  const faction = ctx.state.factions[factionId]
  if (!faction) return ctx
  const result = deactivateFaction(ctx.state, factionId)
  if (!result.ok) return ctx
  const ctx1: TickContext = { ...ctx, state: result.value }
  const oldLeader = ctx1.state.persons[faction.leaderPersonId]
  const { event, ctx: ec } = createSimEvent(ctx1, {
    type: 'FACTION_DISSOLVED',
    importance: 'normal',
    messageKey: 'faction.dissolved',
    messageParams: {
      leader: nameParam('person', ctx1.state.persons[faction.leaderPersonId]?.nameKey ?? 'unknown'),
      reason,
    },
    entityRefs: [
      entityRef('person', faction.leaderPersonId, 'leader', oldLeader?.nameKey),
      entityRef('faction', factionId, 'faction'),
    ],
  })
  return { ...ec, events: [...ec.events, event] }
}

function formNewFactions(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const config = currentCtx.config

  const topShareholderCache = new Map<
    string,
    Array<{ holderPersonId: PersonId; rawPower: number; percent: number }>
  >()
  function getTopShareholdersForHouse(houseId: HouseId) {
    const cached = topShareholderCache.get(houseId)
    if (cached) return cached
    const result = getTopShareholders(currentCtx.state, houseId, config.factionFounderShareRank)
    topShareholderCache.set(houseId, result)
    return result
  }

  const founders: { personId: PersonId; score: number }[] = []
  for (const pid of currentCtx.state.livingPersonIds) {
    const person = currentCtx.state.persons[pid]
    if (!person) continue
    if (person.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(person.lifeStage, 'young_adulthood')) continue
    if (!person.houseId) continue

    const house = currentCtx.state.houses[person.houseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue
    if (getFactionByLeader(currentCtx.state, pid)) continue
    if (getActiveFactionMembership(currentCtx.state, pid)) continue
    if (person.wealth < config.minimumFactionFounderWealth) continue
    // v0.45.3 性別役職適格ゲート: founder は即派閥首領となるため適格者のみ。
    // 設立は欠員補充でなく裁量行為なので ungated 再試行はしない (結成数が減るだけ)。
    if (!isRoleEligibleBySex(currentCtx.state, config, pid)) continue

    const topHolders = getTopShareholdersForHouse(house.id)
    const isTopShareHolder = topHolders.some((s) => s.holderPersonId === pid)
    if (!isTopShareHolder) continue

    const sharePercent = getPersonHouseSharePercent(currentCtx.state, house.id, pid)
    const score =
      sharePercent * 0.1 + person.traits.ambition * 5 + (person.legacyPrestige / 100) * 3
    founders.push({ personId: pid, score })
  }
  founders.sort((a, b) => b.score - a.score)

  const maxFoundersPerYear = 3
  let formed = 0
  for (const { personId: leaderId } of founders) {
    if (formed >= maxFoundersPerYear) break
    currentCtx = tryFoundFaction(currentCtx, leaderId)
    if (getFactionByLeader(currentCtx.state, leaderId)) formed++
  }

  return currentCtx
}

function tryFoundFaction(ctx: TickContext, leaderId: PersonId): TickContext {
  const config = ctx.config
  const leader = ctx.state.persons[leaderId]
  if (!leader) return ctx
  if (!leader.houseId) return ctx

  // v0.42 §12.2: anchor Polity を founding 前に決定する。
  //   1. leader の家の primary polity
  //   2. 家の seatProvince の terminal polity
  //   3. どちらも無ければ Faction を作らない
  // 注: この判定は本フローの RNG 消費より前 (founding フロー全体が RNG 非消費) なので、
  //   不成立でも下流 RNG ストリームは drift しない。
  const leaderHouse = ctx.state.houses[leader.houseId]
  if (!leaderHouse) return ctx
  const anchorCandidate =
    getHousePrimaryPolityId(ctx.state, leader.houseId) ??
    getProvinceTerminalPolityId(ctx.state, leaderHouse.seatProvinceId)
  const anchorPolity =
    anchorCandidate !== undefined ? ctx.state.polities[anchorCandidate] : undefined
  if (anchorCandidate === undefined || !anchorPolity || !anchorPolity.active) return ctx

  const candidates = pickInitialMemberCandidates(ctx, leaderId)
  const slots = config.initialFactionMemberMax
  const selected = candidates.slice(0, slots)

  if (selected.length < config.minimumInitialFactionMembers) {
    return ctx
  }

  const createResult = createFaction(ctx, {
    leaderPersonId: leaderId,
    polityId: anchorCandidate,
    week: ctx.state.absoluteWeek,
  })
  if (!createResult.ok) return ctx
  let currentCtx = createResult.value.ctx
  const factionId = createResult.value.value.factionId

  const initialMemberIds: PersonId[] = []
  for (const memberId of selected) {
    const addResult = addFactionMembership(currentCtx.state, {
      factionId,
      personId: memberId,
      week: currentCtx.state.absoluteWeek,
    })
    if (!addResult.ok) continue
    currentCtx = { ...currentCtx, state: addResult.value.state }
    initialMemberIds.push(memberId)

    const leaderToMember = setPersonAttitude(
      currentCtx.state,
      leaderId,
      { kind: 'person', id: memberId },
      {
        affection: config.recruitmentInitialAffection,
        respect: config.recruitmentInitialRespect,
      },
    )
    if (leaderToMember.ok) currentCtx = { ...currentCtx, state: leaderToMember.value }
    const memberToLeader = setPersonAttitude(
      currentCtx.state,
      memberId,
      { kind: 'person', id: leaderId },
      {
        affection: config.recruitmentInitialAffection,
        respect: config.recruitmentInitialRespect,
      },
    )
    if (memberToLeader.ok) currentCtx = { ...currentCtx, state: memberToLeader.value }
  }

  const housesInvolved: HouseId[] = leader.houseId ? [leader.houseId] : []
  for (const mid of initialMemberIds) {
    const m = currentCtx.state.persons[mid]
    if (m && m.houseId && !housesInvolved.includes(m.houseId)) housesInvolved.push(m.houseId)
  }

  const { event, ctx: ec } = createSimEvent(currentCtx, {
    type: 'FACTION_FOUNDED',
    importance: 'normal',
    messageKey: 'faction.founded',
    messageParams: {
      person: nameParam('person', leader.nameKey),
    },
    entityRefs: [
      entityRef('person', leaderId, 'leader', leader.nameKey),
      entityRef('faction', factionId, 'faction'),
      ...initialMemberIds.map((mid) => entityRef('person', mid, 'member')),
    ],
  })
  return { ...ec, events: [...ec.events, event] }
}

function pickInitialMemberCandidates(ctx: TickContext, leaderId: PersonId): PersonId[] {
  const leader = ctx.state.persons[leaderId]
  if (!leader) return []
  const candidates: { personId: PersonId; score: number }[] = []

  for (const pid of ctx.state.livingPersonIds) {
    if (pid === leaderId) continue
    const p = ctx.state.persons[pid]
    if (!p) continue
    if (p.kind === 'placeholder') continue
    if (!isLifeStageAtLeast(p.lifeStage, 'young_adulthood')) continue
    if (getActiveFactionMembership(ctx.state, pid)) continue
    if (getFactionByLeader(ctx.state, pid)) continue
    // v0.45.3 性別役職適格ゲートを派閥加入にも適用 (派閥=任官のためのネットワークなので、
    // 任官適格な者のみ入れる)。設立者同様 ungated 再試行はしない (女性ネットワークは将来サロンで)。
    if (!isRoleEligibleBySex(ctx.state, ctx.config, pid)) continue

    let bias = 0
    if (p.houseId === leader.houseId) bias += 10
    const lToP = getAttitudeOrDefault(ctx.state, leader, { kind: 'person', id: pid })
    const pToL = getAttitudeOrDefault(ctx.state, p, { kind: 'person', id: leaderId })
    bias += (lToP.affection / 100) * 3
    bias += (pToL.affection / 100) * 3

    candidates.push({ personId: pid, score: bias })
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates.map((c) => c.personId)
}
