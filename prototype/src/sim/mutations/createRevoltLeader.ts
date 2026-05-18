import type { TickContext } from '../tick/context'
import { makePersonId } from '../tick/context'
import type { ProvinceId, PolityId, HouseId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { Person } from '../types/person'
import { randomInt } from '../rng/rng'
import { pickNameBySex } from '../worldgen/nameGenerators'
import { samplePerson } from '../helpers/personFactory'

export function createRevoltLeader(
  ctx: TickContext,
  params: {
    provinceId: ProvinceId
    rebelClass: PopClass
    polityId: PolityId
    houseId: HouseId
  },
): { person: Person; ctx: TickContext } {
  const { id, ctx: ctx1 } = makePersonId(ctx)

  const { name, rng: rng1 } = pickNameBySex('male', ctx1.rng)
  const { value: age, rng: rng2 } = randomInt(rng1, 20, 45)
  const { value: ambition, rng: rng3 } = randomInt(rng2, 7, 10)
  const { value: caution, rng: rng4 } = randomInt(rng3, 2, 7)
  const { value: legacyPrestige, rng: rng5 } = randomInt(rng4, 5, 20)

  const { value: person, rng: rngAfter } = samplePerson(rng5, ctx1.config, {
    id,
    name,
    sex: 'male',
    age,
    houseId: params.houseId,
    birthStatus: 'unknown',
    traits: { ambition: ambition / 10, caution: caution / 10 },
    legacyPrestige,
  })

  return { person, ctx: { ...ctx1, rng: rngAfter } }
}
