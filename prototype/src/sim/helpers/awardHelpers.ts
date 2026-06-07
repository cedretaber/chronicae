// v0.44: 成果単位の即時能力成長 + PersonReputation 付与の共通 helper (spec v0.44 §3-§5)。
//
// - 成長 roll は「floor + fractional roll」方式 (§3.2)。経験を ability weight で分配し、
//   整数部は確定 +1、小数部は 1 回だけ追加 roll する。
// - roll 順序は ABILITY_KEYS 定数順に固定 (§3.3)。Set/Map の反復順に依存しない。
// - 各 +1 は ability < min(aptitude, ABILITY_HARD_CAP) の場合のみ適用。
//   aptitude 到達済み ability の経験は他 ability へ再分配しない (§3.2)。
// - 評判は abs(baseScore) <= cleanupThreshold なら作成しない (§4.4)。

import type { WorldState } from '../types/world'
import type { PersonId } from '../types/ids'
import type { AbilityKey } from '../types/person'
import type { Project, ProjectKind } from '../types/project'
import type {
  ReputationCategory,
  PersonReputationSource,
  PersonReputation,
} from '../types/personReputation'
import type { EntityRef } from '../types/goal'
import type { OrganizationRef } from '../types/office'
import type { SimulationConfig } from '../config/defaultConfig'
import type { RngState } from '../rng/rng'
import type { CreateSimEventInput } from '../tick/context'
import { randomFloat } from '../rng/rng'
import { ABILITY_KEYS, ABILITY_HARD_CAP, ROLE_WEIGHTS } from '../constants/abilityConstants'
import { PROJECT_KIND_ROLE_MAP } from '../selectors/projectSelectors'
import { computeReputationExpiryWeek } from '../selectors/personReputationSelectors'
import { addPersonReputationMut } from '../mutations/personReputationMutations'
import { nameParam, entityRef } from '../types/event'
import { isNotablePerson } from '../selectors/notablePersonSelectors'

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

  const importance = isNotablePerson(ws, personId) ? 'normal' : 'minor'
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
