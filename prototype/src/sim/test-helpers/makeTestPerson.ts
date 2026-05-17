import type { Person, AbilityScores } from '../types/person'
import type { PersonId, HouseId, CountryId } from '../types/ids'

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
    name: 'Test Person',
    sex: 'male',
    age: 30,
    alive: true,
    houseId: 'dh-0' as HouseId,
    countryId: 'dc-0' as CountryId,
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
