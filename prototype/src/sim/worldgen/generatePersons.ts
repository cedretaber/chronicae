import type { RngState } from '../rng/rng'
import type { HouseId, PolityId, ProvinceId } from '../types/ids'
import type { Person, Sex } from '../types/person'
import type { SimulationConfig } from '../config/defaultConfig'
import { createPersonId } from '../types/ids'
import { randomFloat, randomInt } from '../rng/rng'
import { pickNameBySex } from './nameGenerators'
import { samplePerson } from '../helpers/personFactory'
import type { NamePoolService } from '../namegen/namePoolTypes'
import type { NameDisplayData } from '../namegen/nameDisplayResolver'
import { resolveNameDisplay } from '../namegen/nameDisplayResolver'

function pickPersonName(
  sex: Sex,
  rng: RngState,
  namePoolService?: NamePoolService,
  nameDisplayData?: NameDisplayData,
  nameCultureId?: string,
): { name: string; nameKey: string | undefined; rng: RngState } {
  if (namePoolService) {
    const { value: key, rng: nextRng } = namePoolService.pickNameKey(rng, {
      nameCultureId: nameCultureId ?? 'western',
      category: 'person',
      path: [sex],
    })
    const display = nameDisplayData ? resolveNameDisplay(nameDisplayData, 'person', key) : key
    return { name: display, nameKey: key, rng: nextRng }
  }
  const { name, rng: nextRng } = pickNameBySex(sex, rng)
  return { name, nameKey: undefined, rng: nextRng }
}

export function generatePersons(
  houseProvinces: Map<HouseId, ProvinceId[]>,
  housePolity: Map<HouseId, PolityId>,
  config: SimulationConfig,
  rng: RngState,
  namePoolService?: NamePoolService,
  nameDisplayData?: NameDisplayData,
): { persons: Person[]; rng: RngState } {
  const persons: Person[] = []
  let globalIndex = 0

  const sortedHouseIds = Array.from(houseProvinces.keys()).sort()

  for (const houseId of sortedHouseIds) {
    const polityId = housePolity.get(houseId)
    if (!polityId) {
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

    const nps = namePoolService
    const ndd = nameDisplayData
    const nci = config.nameCultureId
    const r0 = pickPersonName('male', rng, nps, ndd, nci)
    const oldFatherName = r0.name
    const oldFatherNameKey = r0.nameKey
    const r1 = pickPersonName('female', r0.rng, nps, ndd, nci)
    const oldMotherName = r1.name
    const oldMotherNameKey = r1.nameKey
    const r2 = pickPersonName('male', r1.rng, nps, ndd, nci)
    const headName = r2.name
    const headNameKey = r2.nameKey
    const r3 = pickPersonName(siblingSexVal, r2.rng, nps, ndd, nci)
    const siblingName = r3.name
    const siblingNameKey = r3.nameKey
    const r4 = pickPersonName('female', r3.rng, nps, ndd, nci)
    const spouseName = r4.name
    const spouseNameKey = r4.nameKey
    const r5 = pickPersonName(child1SexVal, r4.rng, nps, ndd, nci)
    const child1Name = r5.name
    const child1NameKey = r5.nameKey
    const r6 = pickPersonName(child2SexVal, r5.rng, nps, ndd, nci)
    const child2Name = r6.name
    const child2NameKey = r6.nameKey
    const r7 = pickPersonName(relativeSexVal, r6.rng, nps, ndd, nci)
    const relativeName = r7.name
    const relativeNameKey = r7.nameKey
    rng = r7.rng

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

    const { value: oldFatherAmbition, rng: rngOFA } = randomFloat(rng)
    const { value: oldFatherCaution, rng: rngOFC } = randomFloat(rngOFA)
    const { value: oldFather, rng: rngOF } = samplePerson(rngOFC, config, {
      id: oldFatherId,
      name: oldFatherName,
      ...(oldFatherNameKey !== undefined ? { nameKey: oldFatherNameKey } : {}),
      sex: 'male',
      age: oldFatherAge,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: oldFatherAmbition, caution: oldFatherCaution },
      legacyPrestige: oldFatherLegacyPrestige,
      wealth: oldFatherWealth,
    })
    rng = rngOF

    const { value: oldMotherAmbition, rng: rngOMA } = randomFloat(rng)
    const { value: oldMotherCaution, rng: rngOMC } = randomFloat(rngOMA)
    const { value: oldMother, rng: rngOM } = samplePerson(rngOMC, config, {
      id: oldMotherId,
      name: oldMotherName,
      ...(oldMotherNameKey !== undefined ? { nameKey: oldMotherNameKey } : {}),
      sex: 'female',
      age: oldMotherAge,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: oldMotherAmbition, caution: oldMotherCaution },
      legacyPrestige: oldMotherLegacyPrestige,
      wealth: oldMotherWealth,
    })
    rng = rngOM

    const { value: headAmbition, rng: rngHA } = randomFloat(rng)
    const { value: headCaution, rng: rngHC } = randomFloat(rngHA)
    const { value: head, rng: rngH } = samplePerson(rngHC, config, {
      id: headId,
      name: headName,
      ...(headNameKey !== undefined ? { nameKey: headNameKey } : {}),
      sex: 'male',
      age: headAge,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: headAmbition, caution: headCaution },
      fatherId: oldFatherId,
      motherId: oldMotherId,
      legacyPrestige: headLegacyPrestige,
      wealth: headWealth,
    })
    rng = rngH

    const { value: siblingAmbition, rng: rngSA } = randomFloat(rng)
    const { value: siblingCaution, rng: rngSC } = randomFloat(rngSA)
    const { value: sibling, rng: rngS } = samplePerson(rngSC, config, {
      id: siblingId,
      name: siblingName,
      ...(siblingNameKey !== undefined ? { nameKey: siblingNameKey } : {}),
      sex: siblingSexVal,
      age: siblingAge,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: siblingAmbition, caution: siblingCaution },
      fatherId: oldFatherId,
      motherId: oldMotherId,
      legacyPrestige: siblingLegacyPrestige,
      wealth: siblingWealth,
    })
    rng = rngS

    const { value: spouseAmbition, rng: rngSpA } = randomFloat(rng)
    const { value: spouseCaution, rng: rngSpC } = randomFloat(rngSpA)
    const { value: spouse, rng: rngSp } = samplePerson(rngSpC, config, {
      id: spouseId,
      name: spouseName,
      ...(spouseNameKey !== undefined ? { nameKey: spouseNameKey } : {}),
      sex: 'female',
      age: spouseAge,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: spouseAmbition, caution: spouseCaution },
      legacyPrestige: spouseLegacyPrestige,
      wealth: spouseWealth,
    })
    rng = rngSp

    const { value: child1Ambition, rng: rngC1A } = randomFloat(rng)
    const { value: child1Caution, rng: rngC1C } = randomFloat(rngC1A)
    const { value: child1, rng: rngCh1 } = samplePerson(rngC1C, config, {
      id: child1Id,
      name: child1Name,
      ...(child1NameKey !== undefined ? { nameKey: child1NameKey } : {}),
      sex: child1SexVal,
      age: child1Age,
      houseId,
      birthStatus: 'legitimate',
      traits: { ambition: child1Ambition, caution: child1Caution },
      fatherId: headId,
      motherId: spouseId,
      legacyPrestige: child1LegacyPrestige,
      wealth: child1Wealth,
    })
    rng = rngCh1

    const { value: child2Ambition, rng: rngC2A } = randomFloat(rng)
    const { value: child2Caution, rng: rngC2C } = randomFloat(rngC2A)
    const { value: child2, rng: rngCh2 } = samplePerson(rngC2C, config, {
      id: child2Id,
      name: child2Name,
      ...(child2NameKey !== undefined ? { nameKey: child2NameKey } : {}),
      sex: child2SexVal,
      age: child2Age,
      houseId,
      birthStatus: 'legitimate',
      traits: { ambition: child2Ambition, caution: child2Caution },
      fatherId: headId,
      motherId: spouseId,
      legacyPrestige: child2LegacyPrestige,
      wealth: child2Wealth,
    })
    rng = rngCh2

    const { value: relativeAmbition, rng: rngRA } = randomFloat(rng)
    const { value: relativeCaution, rng: rngRC } = randomFloat(rngRA)
    const { value: relative, rng: rngR } = samplePerson(rngRC, config, {
      id: relativeId,
      name: relativeName,
      ...(relativeNameKey !== undefined ? { nameKey: relativeNameKey } : {}),
      sex: relativeSexVal,
      age: relativeAge,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: relativeAmbition, caution: relativeCaution },
      legacyPrestige: relativeLegacyPrestige,
      wealth: relativeWealth,
    })
    rng = rngR

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
