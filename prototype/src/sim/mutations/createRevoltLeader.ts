import type { TickContext } from '../tick/context'
import { makePersonId } from '../tick/context'
import type { ProvinceId, CountryId, HouseId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { Person } from '../types/person'
import { randomInt } from '../rng/rng'
import { pickNameBySex } from '../worldgen/nameGenerators'

export function createRevoltLeader(
  ctx: TickContext,
  params: {
    provinceId: ProvinceId
    rebelClass: PopClass
    countryId: CountryId
    houseId: HouseId
  },
): { person: Person; ctx: TickContext } {
  const { id, ctx: ctx1 } = makePersonId(ctx)

  const { name, rng: rng1 } = pickNameBySex('male', ctx1.rng)
  const ctx2 = { ...ctx1, rng: rng1 }

  const { value: age, rng: rng2 } = randomInt(ctx2.rng, 20, 45)
  const ctx3 = { ...ctx2, rng: rng2 }

  // Stats depend on rebel class
  let adminMin: number
  let adminMax: number
  let martialMin: number
  let martialMax: number

  switch (params.rebelClass) {
    case 'peasants':
      adminMin = 2
      adminMax = 6
      martialMin = 2
      martialMax = 6
      break
    case 'townsmen':
      adminMin = 4
      adminMax = 8
      martialMin = 2
      martialMax = 5
      break
    case 'nobles':
      adminMin = 3
      adminMax = 7
      martialMin = 4
      martialMax = 8
      break
  }

  const { value: admin, rng: rng3 } = randomInt(ctx3.rng, adminMin, adminMax)
  const ctx4 = { ...ctx3, rng: rng3 }
  const { value: martial, rng: rng4 } = randomInt(ctx4.rng, martialMin, martialMax)
  const ctx5 = { ...ctx4, rng: rng4 }

  const { value: ambition, rng: rng5 } = randomInt(ctx5.rng, 7, 10)
  const ctx6 = { ...ctx5, rng: rng5 }
  const { value: caution, rng: rng6 } = randomInt(ctx6.rng, 2, 7)
  const ctx7 = { ...ctx6, rng: rng6 }

  const { value: legacyPrestige, rng: rng7 } = randomInt(ctx7.rng, 5, 20)
  const finalCtx = { ...ctx7, rng: rng7 }

  const person: Person = {
    id,
    name,
    sex: 'male',
    age,
    alive: true,
    houseId: params.houseId,
    countryId: params.countryId,
    childIds: [],
    birthStatus: 'unknown',
    stats: { admin, martial },
    traits: {
      ambition: ambition / 10,
      caution: caution / 10,
    },
    legacyPrestige,
    wealth: 0,
    attitudes: {},
  }

  return { person, ctx: finalCtx }
}
