import type { RngState } from '../rng/rng'
import type { HouseId, CountryId, ProvinceId } from '../types/ids'
import type { Person, Sex } from '../types/person'
import type { SimulationConfig } from '../config/defaultConfig'
import { createPersonId } from '../types/ids'
import { randomFloat, randomInt } from '../rng/rng'
import { pickNameBySex } from './nameGenerators'

export function generatePersons(
  houseProvinces: Map<HouseId, ProvinceId[]>,
  houseCountry: Map<HouseId, CountryId>,
  config: SimulationConfig,
  rng: RngState,
): { persons: Person[]; rng: RngState } {
  const persons: Person[] = []
  let globalIndex = 0

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

    const { value: oldFatherLegacyPrestige, rng: rngP1 } = randomInt(
      rngR2,
      config.initialPersonLegacyPrestigeMin,
      config.initialPersonLegacyPrestigeMax,
    )
    const { value: oldMotherLegacyPrestige, rng: rngP2 } = randomInt(
      rngP1,
      config.initialPersonLegacyPrestigeMin,
      config.initialPersonLegacyPrestigeMax,
    )
    const { value: headLegacyPrestige, rng: rngP3 } = randomInt(
      rngP2,
      config.initialPersonLegacyPrestigeMin,
      config.initialPersonLegacyPrestigeMax,
    )
    const { value: siblingLegacyPrestige, rng: rngP4 } = randomInt(
      rngP3,
      config.initialPersonLegacyPrestigeMin,
      config.initialPersonLegacyPrestigeMax,
    )
    const { value: spouseLegacyPrestige, rng: rngP5 } = randomInt(
      rngP4,
      config.initialPersonLegacyPrestigeMin,
      config.initialPersonLegacyPrestigeMax,
    )
    const { value: child1LegacyPrestige, rng: rngP6 } = randomInt(
      rngP5,
      config.initialPersonLegacyPrestigeMin,
      config.initialPersonLegacyPrestigeMax,
    )
    const { value: child2LegacyPrestige, rng: rngP7 } = randomInt(
      rngP6,
      config.initialPersonLegacyPrestigeMin,
      config.initialPersonLegacyPrestigeMax,
    )
    const { value: relativeLegacyPrestige, rng: rngP8 } = randomInt(
      rngP7,
      config.initialPersonLegacyPrestigeMin,
      config.initialPersonLegacyPrestigeMax,
    )
    rng = rngP8

    const { value: headWealth, rng: rngW1 } = randomInt(rng, 20, 40)
    const { value: oldFatherWealth, rng: rngW2 } = randomInt(rngW1, 15, 35)
    const { value: oldMotherWealth, rng: rngW3 } = randomInt(rngW2, 15, 35)
    const { value: siblingWealth, rng: rngW4 } = randomInt(rngW3, 10, 30)
    const { value: spouseWealth, rng: rngW5 } = randomInt(rngW4, 10, 30)
    const { value: child1Wealth, rng: rngW6 } = randomInt(rngW5, 0, 10)
    const { value: child2Wealth, rng: rngW7 } = randomInt(rngW6, 0, 10)
    const { value: relativeWealth, rng: rngW8 } = randomInt(rngW7, 10, 30)
    rng = rngW8

    const oldFatherName = pickNameBySex('male', rng).name
    const { name: oldMotherName, rng: rngOldM } = pickNameBySex('female', rng)
    const { name: headName, rng: rngH2 } = pickNameBySex('male', rngOldM)
    const { name: siblingName, rng: rngS3 } = pickNameBySex(siblingSexVal, rngH2)
    const { name: spouseName, rng: rngSp2 } = pickNameBySex('female', rngS3)
    const { name: child1Name, rng: rngC5 } = pickNameBySex(child1SexVal, rngSp2)
    const { name: child2Name, rng: rngC6 } = pickNameBySex(child2SexVal, rngC5)
    const { name: relativeName, rng: rngR3 } = pickNameBySex(relativeSexVal, rngC6)
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
        caution: 0,
      },
      legacyPrestige: oldFatherLegacyPrestige,
      wealth: oldFatherWealth,
      attitudes: {},
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
        caution: 0,
      },
      legacyPrestige: oldMotherLegacyPrestige,
      wealth: oldMotherWealth,
      attitudes: {},
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
        caution: 0,
      },
      legacyPrestige: headLegacyPrestige,
      wealth: headWealth,
      attitudes: {},
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
        caution: 0,
      },
      legacyPrestige: siblingLegacyPrestige,
      wealth: siblingWealth,
      attitudes: {},
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
        caution: 0,
      },
      legacyPrestige: spouseLegacyPrestige,
      wealth: spouseWealth,
      attitudes: {},
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
        caution: 0,
      },
      legacyPrestige: child1LegacyPrestige,
      wealth: child1Wealth,
      attitudes: {},
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
        caution: 0,
      },
      legacyPrestige: child2LegacyPrestige,
      wealth: child2Wealth,
      attitudes: {},
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
        caution: 0,
      },
      legacyPrestige: relativeLegacyPrestige,
      wealth: relativeWealth,
      attitudes: {},
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
