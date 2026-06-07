import type {
  Person,
  AbilityScores,
  BirthStatus,
  Sex,
  LifeStage,
  GeniusType,
} from '../types/person'
import type { PersonId, HouseId } from '../types/ids'
import type { AttitudeMap } from '../types/attitude'
import type { RngState, RngResult } from '../rng/rng'
import type { SimulationConfig } from '../config/defaultConfig'
import { sampleAptitudes, sampleAbilitiesFromAptitudes } from '../selectors/abilitySelectors'
import { rollGeniusType, applyGeniusAptitudes, applyGeniusInitialAbilities } from './geniusHelpers'

/**
 * 初期 LifeStage を age から導出する（純関数・RNG 不使用）。
 * ゲーム中の遷移は LifeStageProgressionSystem が担当し、これは初期値導出専用。
 * 閾値は config.lifeStageTransitionAges[*].standardAge から取り、二重管理を避ける。
 * age が各遷移先の standardAge 以上に達している最上位の段階を返す。
 */
export function deriveLifeStageFromAge(age: number, config: SimulationConfig): LifeStage {
  const t = config.lifeStageTransitionAges
  if (age >= t.old_age.standardAge) return 'old_age'
  if (age >= t.mature_adulthood.standardAge) return 'mature_adulthood'
  if (age >= t.young_adulthood.standardAge) return 'young_adulthood'
  if (age >= t.adolescence.standardAge) return 'adolescence'
  return 'childhood'
}

export type BuildPersonInput = {
  id: PersonId
  nameKey: string
  sex: Sex
  age: number
  lifeStage: LifeStage
  houseId?: HouseId
  birthStatus: BirthStatus
  abilities: AbilityScores
  aptitudes: AbilityScores
  traits: { ambition: number; caution: number }
  alive?: boolean
  childIds?: PersonId[]
  fatherId?: PersonId
  motherId?: PersonId
  spouseId?: PersonId
  legacyPrestige?: number
  wealth?: number
  attitudes?: AttitudeMap
  geniusType?: GeniusType
}

export function buildPerson(input: BuildPersonInput): Person {
  const base: Person = {
    id: input.id,
    nameKey: input.nameKey,
    sex: input.sex,
    age: input.age,
    lifeStage: input.lifeStage,
    alive: input.alive ?? true,
    childIds: input.childIds ?? [],
    birthStatus: input.birthStatus,
    abilities: input.abilities,
    aptitudes: input.aptitudes,
    traits: input.traits,
    legacyPrestige: input.legacyPrestige ?? 0,
    wealth: input.wealth ?? 0,
    attitudes: input.attitudes ?? {},
  }
  return {
    ...base,
    ...(input.houseId !== undefined ? { houseId: input.houseId } : {}),
    ...(input.fatherId !== undefined ? { fatherId: input.fatherId } : {}),
    ...(input.motherId !== undefined ? { motherId: input.motherId } : {}),
    ...(input.spouseId !== undefined ? { spouseId: input.spouseId } : {}),
    ...(input.geniusType !== undefined ? { geniusType: input.geniusType } : {}),
  }
}

export type SamplePersonInput = Omit<BuildPersonInput, 'abilities' | 'aptitudes' | 'lifeStage'> & {
  lifeStage?: LifeStage
}

export function samplePerson(
  rng: RngState,
  config: SimulationConfig,
  input: SamplePersonInput,
): RngResult<Person> {
  const { value: sampledAptitudes, rng: rng1 } = sampleAptitudes(rng, config)
  // v0.45 天才ロール: 出現したら対応能力の天賦を 80-120 帯へ引き上げる
  const { value: geniusType, rng: rng2 } = rollGeniusType(rng1, config)
  let aptitudes = sampledAptitudes
  let rngAfterGenius = rng2
  if (geniusType !== undefined) {
    const applied = applyGeniusAptitudes(sampledAptitudes, geniusType, rng2, config)
    aptitudes = applied.value
    rngAfterGenius = applied.rng
  }
  const { value: sampledAbilities, rng: rng3 } = sampleAbilitiesFromAptitudes(
    aptitudes,
    input.age,
    rngAfterGenius,
    config,
  )
  const abilities =
    geniusType !== undefined
      ? applyGeniusInitialAbilities(sampledAbilities, aptitudes, geniusType, config)
      : sampledAbilities
  const lifeStage = input.lifeStage ?? deriveLifeStageFromAge(input.age, config)
  const person = buildPerson({
    ...input,
    abilities,
    aptitudes,
    lifeStage,
    ...(geniusType !== undefined ? { geniusType } : {}),
  })
  return { value: person, rng: rng3 }
}
