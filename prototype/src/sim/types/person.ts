import type { PersonId, HouseId } from './ids'
import type { AttitudeMap } from './attitude'

export const PLACEHOLDER_PERSON_ID: PersonId = 'pe-anon-placeholder' as PersonId

export type Sex = 'male' | 'female'
export type BirthStatus = 'legitimate' | 'illegitimate' | 'unknown'
export type PersonKind = 'normal' | 'placeholder'

export type PersonBackgroundOccupation =
  | 'adventurer'
  | 'merchant'
  | 'scholar'
  | 'mercenary'
  | 'scribe'
  | 'priest'
  | 'physician'
  | 'jurist'
  | 'wanderer'

export type DeathCircumstance = 'natural' | 'faded_from_history'

// v0.40 LifeStage（人生段階）
export type LifeStage =
  | 'childhood'
  | 'adolescence'
  | 'young_adulthood'
  | 'mature_adulthood'
  | 'old_age'

// LifeStage を順序 index 化して比較する（将来段階を増やしても閾値判定が漏れない）
export const LIFE_STAGE_ORDER: Record<LifeStage, number> = {
  childhood: 0,
  adolescence: 1,
  young_adulthood: 2,
  mature_adulthood: 3,
  old_age: 4,
}

/** stage が threshold 以上の段階かを判定する（成人相当判定などに使う）。 */
export function isLifeStageAtLeast(stage: LifeStage, threshold: LifeStage): boolean {
  return LIFE_STAGE_ORDER[stage] >= LIFE_STAGE_ORDER[threshold]
}

export type AbilityScores = {
  valor: number // 個人戦闘力・身体能力・士気
  command: number // 組織を束ねる・軍指揮の規律
  numeracy: number // 数を扱う・計算・財務管理
  learning: number // 知識を持つ・法・制度・歴史
  charisma: number // 人を惹きつける・容姿・声・説得・社交
  insight: number // 人を理解する・他者の動機・派閥力学
}

export type AbilityKey = keyof AbilityScores

export type Person = {
  id: PersonId
  nameKey: string
  sex: Sex
  age: number
  lifeStage: LifeStage
  alive: boolean
  kind?: PersonKind
  houseId?: HouseId
  fatherId?: PersonId
  motherId?: PersonId
  spouseId?: PersonId
  childIds: PersonId[]
  birthStatus: BirthStatus
  abilities: AbilityScores // 現在の能力値 0..120（通常生成は 0..100）
  aptitudes: AbilityScores // 才能上限 0..120（通常生成は 0..100）
  traits: {
    ambition: number // 0.0..1.0
    caution: number // 0.0..1.0
  }
  legacyPrestige: number // 0..100
  wealth: number // >= 0
  attitudes: AttitudeMap
  occupation?: PersonBackgroundOccupation
  deathCircumstance?: DeathCircumstance
  lastHouseTransferYear?: number
}
