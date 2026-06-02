import type { Person, AbilityScores } from '../types/person'
import type { PersonId, HouseId } from '../types/ids'

const DEFAULT_ABILITIES: AbilityScores = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

export function makeTestPerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 'pe-0' as PersonId,
    nameKey: 'Test Person',
    sex: 'male',
    age: 30,
    lifeStage: 'young_adulthood',
    alive: true,
    houseId: 'dh-0' as HouseId,
    childIds: [],
    birthStatus: 'legitimate',
    abilities: { ...DEFAULT_ABILITIES },
    aptitudes: { ...DEFAULT_ABILITIES },
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 0,
    wealth: 0,
    attitudes: {},
    ...overrides,
  }
}
