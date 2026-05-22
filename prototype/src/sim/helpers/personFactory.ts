import type { Person, AbilityScores, BirthStatus, Sex } from '../types/person'
import type { PersonId, HouseId } from '../types/ids'
import type { AttitudeMap } from '../types/attitude'
import type { RngState, RngResult } from '../rng/rng'
import type { SimulationConfig } from '../config/defaultConfig'
import { sampleAptitudes, sampleAbilitiesFromAptitudes } from '../selectors/abilitySelectors'

export type BuildPersonInput = {
  id: PersonId
  nameKey: string
  sex: Sex
  age: number
  houseId: HouseId
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
}

export function buildPerson(input: BuildPersonInput): Person {
  const base: Person = {
    id: input.id,
    nameKey: input.nameKey,
    sex: input.sex,
    age: input.age,
    alive: input.alive ?? true,
    houseId: input.houseId,
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
    ...(input.fatherId !== undefined ? { fatherId: input.fatherId } : {}),
    ...(input.motherId !== undefined ? { motherId: input.motherId } : {}),
    ...(input.spouseId !== undefined ? { spouseId: input.spouseId } : {}),
  }
}

export type SamplePersonInput = Omit<BuildPersonInput, 'abilities' | 'aptitudes'>

export function samplePerson(
  rng: RngState,
  config: SimulationConfig,
  input: SamplePersonInput,
): RngResult<Person> {
  const { value: aptitudes, rng: rng1 } = sampleAptitudes(rng, config)
  const { value: abilities, rng: rng2 } = sampleAbilitiesFromAptitudes(
    aptitudes,
    input.age,
    rng1,
    config,
  )
  const person = buildPerson({ ...input, abilities, aptitudes })
  return { value: person, rng: rng2 }
}
