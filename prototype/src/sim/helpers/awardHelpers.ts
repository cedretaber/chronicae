// v0.44: 成果単位の即時能力成長 + PersonReputation 付与の共通 helper (spec v0.44 §3-§5)。
//
// - 成長 roll は「floor + fractional roll」方式 (§3.2)。経験を ability weight で分配し、
//   整数部は確定 +1、小数部は 1 回だけ追加 roll する。
// - roll 順序は ABILITY_KEYS 定数順に固定 (§3.3)。Set/Map の反復順に依存しない。
// - 各 +1 は ability < min(aptitude, ABILITY_HARD_CAP) の場合のみ適用。
//   aptitude 到達済み ability の経験は他 ability へ再分配しない (§3.2)。
// - 評判は abs(baseScore) <= cleanupThreshold なら作成しない (§4.4)。

import type { WorldState } from '../types/world'
import type { PersonId, EventId, PolityId } from '../types/ids'
import type { AbilityKey } from '../types/person'
import type { Project, ProjectKind } from '../types/project'
import type { DiplomaticPlay, DiplomaticPlayTerminalOutcome } from '../types/diplomaticPlay'
import type { War, WarSide } from '../types/war'
import { personReputationOrganizationKey } from '../types/personReputation'
import type { SimEvent } from '../types/event'
import type {
  ReputationCategory,
  PersonReputationSource,
  PersonReputation,
} from '../types/personReputation'
import type { EntityRef } from '../types/goal'
import type { OrganizationRef } from '../types/office'
import type { SimulationConfig } from '../config/defaultConfig'
import type { RngState } from '../rng/rng'
import type { TickContext, CreateSimEventInput } from '../tick/context'
import { randomFloat } from '../rng/rng'
import { ABILITY_KEYS, ABILITY_HARD_CAP, ROLE_WEIGHTS } from '../constants/abilityConstants'
import { PROJECT_KIND_ROLE_MAP } from '../selectors/projectSelectors'
import { computeReputationExpiryWeek } from '../selectors/personReputationSelectors'
import { addPersonReputationMut } from '../mutations/personReputationMutations'
import { nameParam, entityRef } from '../types/event'
import { isNotablePerson } from '../selectors/notablePersonSelectors'
import { getPolityHouseIds } from '../selectors/polityRelations'
import { getFactionActiveMemberIds } from '../selectors/factionSelectors'
import { getPolityLeader } from '../selectors/officeSelectors'

export type AbilityWeights = Partial<Record<AbilityKey, number>>

// Project 経験の ability weight (§3.1): kind -> role -> ROLE_WEIGHTS。
// personal_training のみ例外で trainingAbilityKey の単一能力に全経験を与える (§3.1)。
export function getProjectExperienceWeights(project: Project): AbilityWeights {
  if (project.kind === 'personal_training') {
    return { [project.trainingAbilityKey]: 1.0 }
  }
  return ROLE_WEIGHTS[PROJECT_KIND_ROLE_MAP[project.kind]]
}

// §5.6: ProjectKind → ReputationCategory。undefined = Project hook では評判を付与しない。
// undefined の振り分けは isDiplomaticProjectKind の実装 (acquire_land / sell_land /
// improve_contract_terms / demand_tax_increase / respond_to_pressure = Play 側で評価) と
// 一致させること。Record<ProjectKind, …> にしておくことで ProjectKind 追加時に
// tsc が entry 追加を強制する。
export const PROJECT_REPUTATION_CATEGORY_MAP: Record<ProjectKind, ReputationCategory | undefined> =
  {
    develop_holding: 'administration',
    acquire_political_right: 'diplomacy',
    promote_policy_shift: 'diplomacy',
    patronize_artist: 'culture',
    commission_chronicle: 'culture',

    // isDiplomaticProjectKind の 5 kind は Play 側で評価する (§5.2)
    acquire_land: undefined,
    sell_land: undefined,
    improve_contract_terms: undefined,
    demand_tax_increase: undefined,
    respond_to_pressure: undefined,

    // personal_training は評判を一切発生させない (§6.8)
    personal_training: undefined,

    // 影響力個人中心化 Phase 1b: 運動は general 評判を発生させる (推薦された個人に付与)
    movement_campaign: 'general',

    // v0.47 称号・分封・領邦再編: petition の成功は請願人物の外交的実績 (diplomacy)、
    // 集約・共和国 House 創設は統治実績 (administration) に集約する。
    request_rank_promotion: 'diplomacy',
    request_land_grant: 'diplomacy',
    request_cadet_branch_title_transfer: 'diplomacy',
    republic_house_foundation: 'administration',
    consolidate_internal_contracts: 'administration',

    // v0.51 陰謀リファイン: 陰謀は covert ゆえ公的評判を発生させない (supervisor の ability 経験のみ)
    undermine_influence: undefined,
    revoke_political_right: undefined,
    replace_house_leader: undefined,

    // v0.48 Crisis: 災害対処は統治実績 (develop_holding と同じ administration)
    handle_crisis: 'administration',
  }

export type AwardSourceKind = PersonReputationSource['kind']

// 即時成長 roll (§3.2)。対象人物の abilities を ws.persons 上で更新し、
// 成長した ability ごとに PERSON_ABILITY_GREW を emit する (§3.4)。
// 呼び出し側は ws.persons を clone 済みであること (mutable draft 規約)。
export function applyImmediateAbilityGrowthMut(
  ws: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  totalExperience: number,
  weights: AbilityWeights,
  sourceKind: AwardSourceKind,
  rng: RngState,
  emitEvent: (input: CreateSimEventInput) => void,
): RngState {
  const person = ws.persons[personId]
  if (!person || !person.alive || person.kind === 'placeholder') return rng
  if (totalExperience <= 0) return rng

  let currentRng = rng
  const newAbilities = { ...person.abilities }
  const grown: { key: AbilityKey; oldValue: number; newValue: number }[] = []

  for (const k of ABILITY_KEYS) {
    const weight = weights[k]
    if (weight === undefined || weight <= 0) continue

    const expectedGain =
      (totalExperience * weight * config.experienceImmediateGrowthChancePerPoint) / 100
    const guaranteedGain = Math.floor(expectedGain)
    const fractionalChance = expectedGain - guaranteedGain

    let attempts = guaranteedGain
    if (fractionalChance > 0) {
      const { value: roll, rng: nextRng } = randomFloat(currentRng)
      currentRng = nextRng
      if (roll < fractionalChance) attempts += 1
    }
    if (attempts === 0) continue

    const cap = Math.min(person.aptitudes[k], ABILITY_HARD_CAP)
    const oldValue = newAbilities[k]
    let value = oldValue
    for (let i = 0; i < attempts; i++) {
      if (value >= cap) break // aptitude/hard cap 到達済みは skip (再分配なし)
      value += 1
    }
    if (value > oldValue) {
      newAbilities[k] = value
      grown.push({ key: k, oldValue, newValue: value })
    }
  }

  if (grown.length === 0) return currentRng

  ws.persons[personId] = { ...person, abilities: newAbilities }

  // 能力成長 (事業・外交交渉を通じた award 経由) は要人でも minor 固定。
  const importance = 'minor'
  for (const g of grown) {
    emitEvent({
      type: 'PERSON_ABILITY_GREW',
      importance,
      messageKey: 'person.ability_grew',
      messageParams: {
        person: nameParam('person', person.nameKey),
        ability: g.key,
        oldValue: g.oldValue,
        newValue: g.newValue,
        sourceKind,
      },
      entityRefs: [entityRef('person', personId, 'subject', person.nameKey)],
    })
  }
  return currentRng
}

// ─── DiplomaticPlay terminal award (§7) ───
//
// initiator / target で評価が反転する (§7.6)。対象は各 side の delegate (§7.4)。
// delegate 不在・死亡は skip (fallback なし — v0.44 初期)。

type PlaySideEvaluation = { experience: number; reputationBase: number | undefined }

// §7.6 の表。undefined = その side には何も付与しない (failed の target)。
function evaluatePlaySide(
  config: SimulationConfig,
  outcome: DiplomaticPlayTerminalOutcome,
  side: 'initiator' | 'target',
): PlaySideEvaluation | undefined {
  const success: PlaySideEvaluation = {
    experience: config.diplomaticPlayExperienceGainSuccess,
    reputationBase: config.personReputationDiplomacySuccessBase,
  }
  const failure: PlaySideEvaluation = {
    experience: config.diplomaticPlayExperienceGainFailure,
    reputationBase: config.personReputationDiplomacyFailureBase,
  }
  const smallSuccess: PlaySideEvaluation = {
    experience: config.diplomaticPlayExperienceGainStatusQuo,
    reputationBase: config.personReputationDiplomacyStatusQuoBase,
  }
  const smallFailure: PlaySideEvaluation = {
    experience: config.diplomaticPlayExperienceGainStatusQuo,
    reputationBase: -Math.abs(config.personReputationDiplomacyStatusQuoFailureBase),
  }
  const voided: PlaySideEvaluation = {
    experience:
      config.diplomaticPlayExperienceGainFailure *
      config.diplomaticPlayExperienceGainCancelledMultiplier,
    reputationBase: undefined,
  }

  switch (outcome) {
    case 'demands_met':
      return side === 'initiator' ? success : failure
    case 'status_quo':
      return side === 'initiator' ? smallFailure : smallSuccess
    // §7.9: initiator から見れば外交失敗。target は「即時受諾せず退けた」小成功だが
    // 戦争回避には失敗しているため demands_met 成功より小さい評価に留める。
    case 'escalated_to_war':
      return side === 'initiator' ? failure : smallSuccess
    case 'revolt_succeeded':
      return side === 'initiator' ? success : failure
    case 'revolt_suppressed':
      return side === 'initiator' ? failure : success
    case 'failed':
      return side === 'initiator' ? failure : undefined
    case 'voided':
      return voided
  }
}

// terminal play の削除直前に呼ぶ (§7.1 / §13.2)。呼び出し側は ws.persons を clone 済みであること。
export function awardDiplomaticPlayOutcomeMut(
  ws: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  rng: RngState,
  emitEvent: (input: CreateSimEventInput) => void,
): RngState {
  const outcome = play.terminalOutcome
  if (outcome === undefined) return rng

  const weights = ROLE_WEIGHTS.diplomacy
  let currentRng = rng

  for (const side of ['initiator', 'target'] as const) {
    const delegateId =
      side === 'initiator' ? play.initiatorDelegatePersonId : play.targetDelegatePersonId
    if (!delegateId) continue
    const evaluation = evaluatePlaySide(config, outcome, side)
    if (!evaluation) continue

    currentRng = applyImmediateAbilityGrowthMut(
      ws,
      config,
      delegateId,
      evaluation.experience,
      weights,
      'diplomatic_play',
      currentRng,
      emitEvent,
    )
    if (evaluation.reputationBase !== undefined) {
      awardPersonReputationMut(
        ws,
        config,
        {
          personId: delegateId,
          source: { kind: 'diplomatic_play', playKind: play.kind, playId: play.id },
          category: 'diplomacy',
          baseScore: evaluation.reputationBase,
          relatedOrganization: side === 'initiator' ? play.initiator : play.target,
        },
        emitEvent,
      )
    }
  }
  return currentRng
}

// ─── War terminal award (§8) ───
//
// 対象 = 両 side の captainGeneral + commanderPersonIds (§8.2)。
// 同一人物が両方に含まれる場合は大きい方 (captain general 満額) のみ。
// white_peace / cancelled は経験のみ・評判なし (§8.4)。
export function awardWarOutcomeCtx(ctx: TickContext, war: War): TickContext {
  const status = war.status
  if (
    status !== 'attacker_won' &&
    status !== 'defender_won' &&
    status !== 'white_peace' &&
    status !== 'cancelled'
  ) {
    return ctx
  }
  const config = ctx.config
  const ws: WorldState = { ...ctx.state, persons: { ...ctx.state.persons } }
  let rng = ctx.rng
  const newEvents: SimEvent[] = []
  let nextEventIndex = ctx.nextEventIndex

  function emitEvent(input: CreateSimEventInput): void {
    const id = `e-${ws.absoluteWeek}-${nextEventIndex}` as EventId
    nextEventIndex++
    newEvents.push({
      id,
      year: ws.currentYear,
      weekOfYear: ws.currentWeekOfYear,
      type: input.type,
      importance: input.importance,
      messageKey: input.messageKey,
      messageParams: input.messageParams,
      entityRefs: input.entityRefs ?? [],
      reasons: input.reasons ?? [],
      effects: input.effects ?? [],
    })
  }

  const weights = ROLE_WEIGHTS.warCommand

  for (const side of [war.attacker, war.defender]) {
    let experienceBase: number
    let reputationBase: number | undefined
    if (status === 'attacker_won' || status === 'defender_won') {
      const isWinner = (status === 'attacker_won') === (side.key === 'attacker')
      experienceBase = isWinner ? config.warExperienceGainVictory : config.warExperienceGainDefeat
      reputationBase = isWinner
        ? config.personReputationWarVictoryBase
        : config.personReputationWarDefeatBase
    } else if (status === 'white_peace') {
      experienceBase = config.warExperienceGainWhitePeace
      reputationBase = undefined
    } else {
      // cancelled: 双方に固定小経験のみ (§8.4 — progressRatio 相当が無いため進行度比例にしない)
      experienceBase = config.warExperienceGainDefeat * config.warExperienceGainCancelledMultiplier
      reputationBase = undefined
    }

    // captain general 満額 → commander × factor。重複は先着 (= captain general) のみ (§8.2)。
    const recipients: { personId: PersonId; factor: number }[] = []
    const seen = new Set<string>()
    if (side.captainGeneralPersonId) {
      recipients.push({ personId: side.captainGeneralPersonId, factor: 1 })
      seen.add(side.captainGeneralPersonId)
    }
    for (const pid of side.commanderPersonIds) {
      if (seen.has(pid)) continue
      seen.add(pid)
      recipients.push({ personId: pid, factor: config.warCommanderAwardFactor })
    }

    // 影響力個人中心化 Phase 1a (dual-tag・R28): owner organization (primary actor) +
    // target polity を集める。primary actor が polity なら target=self で 1 個 (dedupe)。
    // primary actor が house のときだけ、その陣営の participants から最初の polity を target に
    // 追加し owner=house + target=polity の dual にする (家の戦功が陣営 polity の influence を生む)。
    //
    // v0.47.1: tag は受賞者本人が所属する organization に限る。指揮官プールは支援国の宮廷
    // 人材・派閥食客を含む (v0.43) ため、無所属の tag を許すと「友軍として従軍しただけの
    // 外国家」が当該 polity の influence (声望 domain) を持ってしまう。所属 tag が 1 つも
    // 残らない受賞者には tag 無し評判 (名声のみ — influence に入らない) を与える。
    const reputationOrgs = collectWarSideReputationOrganizations(side)
    for (const recipient of recipients) {
      rng = applyImmediateAbilityGrowthMut(
        ws,
        config,
        recipient.personId,
        experienceBase * recipient.factor,
        weights,
        'war',
        rng,
        emitEvent,
      )
      if (reputationBase !== undefined) {
        const baseScore = reputationBase * recipient.factor
        const source = { kind: 'war' as const, warId: war.id }
        const affiliatedOrgs = reputationOrgs.filter((org) =>
          org.kind === 'house'
            ? ws.persons[recipient.personId]?.houseId === org.id
            : isPersonAffiliatedWithPolityForReputation(ws, recipient.personId, org.id),
        )
        if (affiliatedOrgs.length === 0) {
          awardPersonReputationMut(
            ws,
            config,
            { personId: recipient.personId, source, category: 'military', baseScore },
            emitEvent,
          )
        } else {
          for (const org of affiliatedOrgs) {
            awardPersonReputationMut(
              ws,
              config,
              {
                personId: recipient.personId,
                source,
                category: 'military',
                baseScore,
                relatedOrganization: org,
              },
              emitEvent,
            )
          }
        }
      }
    }
  }

  return {
    ...ctx,
    state: ws,
    rng,
    events: newEvents.length > 0 ? [...ctx.events, ...newEvents] : ctx.events,
    nextEventIndex,
  }
}

// v0.47.1: 戦功評判の polity tag を許す「所属」判定。polity tag された評判はその polity の
// influence (声望 domain) に所属確認なしで合算される (influenceSelectors) ため、tag 付与側で
// 所属を gate する。所属 = polity leader / 当該 polity の active office holder /
// 家が getPolityHouseIds に入る (領地・支配チェーン) / 当該 polity anchor の active 派閥メンバー
// (食客 — 個人 influence の coldstart 経路として意図的に含める)。
// 支援国から従軍しただけの人物はどれにも該当せず false (= tag 無し評判に落ちる)。
function isPersonAffiliatedWithPolityForReputation(
  state: WorldState,
  personId: PersonId,
  polityId: PolityId,
): boolean {
  if (getPolityLeader(state, polityId) === personId) return true
  for (const officeId of state.officeIndex.byHolderPerson[personId as string] ?? []) {
    const office = state.officeAssignments[officeId]
    if (office && office.active && office.organization.kind === 'polity') {
      if (office.organization.id === polityId) return true
    }
  }
  const houseId = state.persons[personId]?.houseId
  if (houseId !== undefined && getPolityHouseIds(state, polityId).includes(houseId)) return true
  for (const factionId of state.factionIndex.byPolity[polityId] ?? []) {
    const faction = state.factions[factionId]
    if (!faction || !faction.active) continue
    if (getFactionActiveMemberIds(state, factionId).includes(personId)) return true
  }
  return false
}

// 影響力個人中心化 Phase 1a (dual-tag・R28): War side の戦功評判を tag する organization を集める。
// owner = primary participant の actor。actor が house のとき target = その陣営 participants の
// 最初の polity (organizationKey 昇順で安定) を追加して dual 化する。actor が polity なら
// target=self なので owner だけ (dedupe で 1 個)。primary 不在なら空 (tag 無し評判)。
function collectWarSideReputationOrganizations(side: WarSide): OrganizationRef[] {
  const primaryActor = side.participants.find((p) => p.primary)?.actor
  if (!primaryActor) return []
  const orgs: OrganizationRef[] = [primaryActor]
  const seen = new Set<string>([personReputationOrganizationKey(primaryActor)])
  if (primaryActor.kind === 'house') {
    const polityActors = side.participants
      .map((p) => p.actor)
      .filter((a): a is Extract<OrganizationRef, { kind: 'polity' }> => a.kind === 'polity')
      .sort((a, b) =>
        personReputationOrganizationKey(a).localeCompare(personReputationOrganizationKey(b)),
      )
    const targetPolity = polityActors[0]
    if (targetPolity) {
      const key = personReputationOrganizationKey(targetPolity)
      if (!seen.has(key)) orgs.push(targetPolity)
    }
  }
  return orgs
}

export type AwardReputationInput = {
  personId: PersonId
  source: PersonReputationSource
  category: ReputationCategory
  baseScore: number
  relatedOrganization?: OrganizationRef
  relatedRefs?: EntityRef[]
}

// PersonReputation 付与 (§4)。abs(baseScore) <= threshold なら作成しない (§4.4)。
// 作成時に PERSON_REPUTATION_GAINED / DAMAGED を emit する (§10.3)。
export function awardPersonReputationMut(
  ws: WorldState,
  config: SimulationConfig,
  input: AwardReputationInput,
  emitEvent: (input: CreateSimEventInput) => void,
): PersonReputation | undefined {
  const person = ws.persons[input.personId]
  if (!person || !person.alive || person.kind === 'placeholder') return undefined

  const expiryWeek = computeReputationExpiryWeek(input.baseScore, ws.absoluteWeek, config)
  if (expiryWeek === undefined) return undefined

  const reputation = addPersonReputationMut(ws, {
    personId: input.personId,
    source: input.source,
    outcome: input.baseScore >= 0 ? 'success' : 'failure',
    category: input.category,
    baseScore: input.baseScore,
    createdWeek: ws.absoluteWeek,
    expiryWeek,
    ...(input.relatedOrganization !== undefined
      ? { relatedOrganization: input.relatedOrganization }
      : {}),
    relatedRefs: input.relatedRefs ?? [],
  })

  const importance = isNotablePerson(ws, input.personId) ? 'normal' : 'minor'
  emitEvent({
    type: input.baseScore >= 0 ? 'PERSON_REPUTATION_GAINED' : 'PERSON_REPUTATION_DAMAGED',
    importance,
    messageKey: input.baseScore >= 0 ? 'person.reputation_gained' : 'person.reputation_damaged',
    messageParams: {
      person: nameParam('person', person.nameKey),
      category: input.category,
      score: input.baseScore,
      sourceKind: input.source.kind,
    },
    entityRefs: [entityRef('person', input.personId, 'subject', person.nameKey)],
  })
  return reputation
}
