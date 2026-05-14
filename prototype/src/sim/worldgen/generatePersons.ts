import type { RngState } from '../rng/rng'
import type { HouseId, CountryId, ProvinceId } from '../types/ids'
import type { Person, Sex } from '../types/person'
import { createPersonId } from '../types/ids'
import { randomFloat, randomInt } from '../rng/rng'
import { personNamePool, pickName } from './nameGenerators'

export function generatePersons(
  houseProvinces: Map<HouseId, ProvinceId[]>,
  houseCountry: Map<HouseId, CountryId>,
  rng: RngState,
): { persons: Person[]; rng: RngState } {
  const persons: Person[] = []
  let globalIndex = 0

  const pool = personNamePool()

  const sortedHouseIds = Array.from(houseProvinces.keys()).sort()

  for (const houseId of sortedHouseIds) {
    const countryId = houseCountry.get(houseId)
    if (!countryId) {
      continue
    }

    const { value: oldFatherAge, rng: rngF2 } = randomInt(rng, 55, 75)

    const { value: oldMotherAge, rng: rngM2 } = randomInt(rngF2, 50, 70)

    const { value: headAge, rng: rngH1 } = randomInt(rngM2, 30, 50)

    const { value: siblingSexRoll, rng: rngS1 } = randomFloat(rngH1)
    const siblingSexVal: Sex = siblingSexRoll < 0.52 ? 'male' : 'female'
    const { value: siblingAge, rng: rngS2 } = randomInt(rngS1, 25, 45)

    const { value: spouseAge, rng: rngSp1 } = randomInt(rngS2, 25, 45)

    const { value: child1SexRoll, rng: rngC1 } = randomFloat(rngSp1)
    const child1SexVal: Sex = child1SexRoll < 0.52 ? 'male' : 'female'
    const { value: child1Age, rng: rngC2 } = randomInt(rngC1, 5, 20)

    const { value: child2SexRoll, rng: rngC3 } = randomFloat(rngC2)
    const child2SexVal: Sex = child2SexRoll < 0.52 ? 'male' : 'female'
    const { value: child2Age, rng: rngC4 } = randomInt(rngC3, 0, 18)

    const { value: relativeSexRoll, rng: rngR1 } = randomFloat(rngC4)
    const relativeSexVal: Sex = relativeSexRoll < 0.52 ? 'male' : 'female'
    const { value: relativeAge, rng: rngR2 } = randomInt(rngR1, 15, 35)
    rng = rngR2

    const oldFatherName = pickName(pool, rng).name
    const { name: oldMotherName, rng: rngOldM } = pickName(pool, rng)
    const { name: headName, rng: rngH2 } = pickName(pool, rngOldM)
    const { name: siblingName, rng: rngS3 } = pickName(pool, rngH2)
    const { name: spouseName, rng: rngSp2 } = pickName(pool, rngS3)
    const { name: child1Name, rng: rngC5 } = pickName(pool, rngSp2)
    const { name: child2Name, rng: rngC6 } = pickName(pool, rngC5)
    const { name: relativeName, rng: rngR3 } = pickName(pool, rngC6)
    rng = rngR3

    const oldFatherId = createPersonId('pe', globalIndex)
    globalIndex++
    const oldMotherId = createPersonId('pe', globalIndex)
    globalIndex++
    const headId = createPersonId('pe', globalIndex)
    globalIndex++
    const siblingId = createPersonId('pe', globalIndex)
    globalIndex++
    const spouseId = createPersonId('pe', globalIndex)
    globalIndex++
    const child1Id = createPersonId('pe', globalIndex)
    globalIndex++
    const child2Id = createPersonId('pe', globalIndex)
    globalIndex++
    const relativeId = createPersonId('pe', globalIndex)
    globalIndex++

    const oldFather: Person = {
      id: oldFatherId,
      name: oldFatherName,
      sex: 'male',
      age: oldFatherAge,
      alive: true,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown' as const,
      stats: {
        admin: 0,
        martial: 0,
      },
      traits: {
        ambition: 0,
        loyaltyToCountry: 0,
        caution: 0,
      },
      prestige: 0,
    }

    const oldMother: Person = {
      id: oldMotherId,
      name: oldMotherName,
      sex: 'female',
      age: oldMotherAge,
      alive: true,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown' as const,
      stats: {
        admin: 0,
        martial: 0,
      },
      traits: {
        ambition: 0,
        loyaltyToCountry: 0,
        caution: 0,
      },
      prestige: 0,
    }

    const head: Person = {
      id: headId,
      name: headName,
      sex: 'male' as const,
      age: headAge,
      alive: true,
      houseId,
      countryId,
      fatherId: oldFatherId,
      motherId: oldMotherId,
      childIds: [],
      birthStatus: 'unknown' as const,
      stats: {
        admin: 0,
        martial: 0,
      },
      traits: {
        ambition: 0,
        loyaltyToCountry: 0,
        caution: 0,
      },
      prestige: 0,
    }

    const sibling: Person = {
      id: siblingId,
      name: siblingName,
      sex: siblingSexVal,
      age: siblingAge,
      alive: true,
      houseId,
      countryId,
      fatherId: oldFatherId,
      motherId: oldMotherId,
      childIds: [],
      birthStatus: 'unknown' as const,
      stats: {
        admin: 0,
        martial: 0,
      },
      traits: {
        ambition: 0,
        loyaltyToCountry: 0,
        caution: 0,
      },
      prestige: 0,
    }

    const spouse: Person = {
      id: spouseId,
      name: spouseName,
      sex: 'female' as const,
      age: spouseAge,
      alive: true,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown' as const,
      stats: {
        admin: 0,
        martial: 0,
      },
      traits: {
        ambition: 0,
        loyaltyToCountry: 0,
        caution: 0,
      },
      prestige: 0,
    }

    const child1: Person = {
      id: child1Id,
      name: child1Name,
      sex: child1SexVal,
      age: child1Age,
      alive: true,
      houseId,
      countryId,
      fatherId: headId,
      motherId: spouseId,
      childIds: [],
      birthStatus: 'legitimate' as const,
      stats: {
        admin: 0,
        martial: 0,
      },
      traits: {
        ambition: 0,
        loyaltyToCountry: 0,
        caution: 0,
      },
      prestige: 0,
    }

    const child2: Person = {
      id: child2Id,
      name: child2Name,
      sex: child2SexVal,
      age: child2Age,
      alive: true,
      houseId,
      countryId,
      fatherId: headId,
      motherId: spouseId,
      childIds: [],
      birthStatus: 'legitimate' as const,
      stats: {
        admin: 0,
        martial: 0,
      },
      traits: {
        ambition: 0,
        loyaltyToCountry: 0,
        caution: 0,
      },
      prestige: 0,
    }

    const relative: Person = {
      id: relativeId,
      name: relativeName,
      sex: relativeSexVal,
      age: relativeAge,
      alive: true,
      houseId,
      countryId,
      childIds: [],
      birthStatus: 'unknown' as const,
      stats: {
        admin: 0,
        martial: 0,
      },
      traits: {
        ambition: 0,
        loyaltyToCountry: 0,
        caution: 0,
      },
      prestige: 0,
    }

    const housePersons = [oldFather, oldMother, head, sibling, spouse, child1, child2, relative]
    if (
      !oldFather ||
      !oldMother ||
      !head ||
      !sibling ||
      !spouse ||
      !child1 ||
      !child2 ||
      !relative
    ) {
      throw new Error('Failed to generate house persons')
    }

    // Set bidirectional relationships
    head.spouseId = spouse.id
    spouse.spouseId = head.id
    head.childIds = [child1.id, child2.id]
    spouse.childIds = [child1.id, child2.id]
    oldFather.childIds = [head.id, sibling.id]
    oldMother.childIds = [head.id, sibling.id]

    persons.push(...housePersons)
  }

  return { persons, rng }
}
