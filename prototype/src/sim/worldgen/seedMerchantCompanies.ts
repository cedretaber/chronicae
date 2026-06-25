import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PersonId, StateRegionId, ProvinceId } from '../types/ids'
import { createHouseId, createPersonId, createMerchantCompanyId } from '../types/ids'
import type { Sex } from '../types/person'
import type { ResourceKind } from '../types/resource'
import { RESOURCE_KINDS } from '../types/resource'
import { createRng, randomFloat, randomInt } from '../rng/rng'
import type { RngState } from '../rng/rng'
import { samplePerson } from '../helpers/personFactory'
import { pickNameBySex, houseNamePool, houseName, pickUniqueName } from './nameGenerators'
import type { NamePoolService } from '../namegen/namePoolTypes'
import {
  createMerchantCompanyMut,
  createMerchantCompanyEstablishmentMut,
  createMerchantCompanyShareMut,
  createTradeRouteMut,
} from '../mutations/merchantMutations'
import { createOfficeAssignment } from '../mutations/officeMutations'
import {
  getStateCityHoldingId,
  getAdjacentStateRegionIds,
  estimateStateProductionPotential,
  getMerchantCompanyDecisionMaker,
} from '../selectors/merchantSelectors'

// v0.61 §19 / §25: worldgen で各 StateRegion に初期商会を 1 社 seed する。
//   決定性のため、共有 worldgen rng（= 返却され session rng になる）は一切消費せず、
//   seedText から導出した隔離 rng（`:merchant`）でのみ乱数を引く。これにより既存 entity は
//   bit-identical に保たれ、商会分だけが state 差分に出る（dump-world RNG カウンタ不変）。

const MERCHANT_HOUSE_MEMBER_COUNT = 3

function pickName(
  sex: Sex,
  rng: RngState,
  namePoolService: NamePoolService | undefined,
): { nameKey: string; rng: RngState } {
  if (namePoolService) {
    const { value, rng: r } = namePoolService.pickNameKey(rng, {
      nameCultureId: 'western',
      category: 'person',
      path: [sex],
    })
    return { nameKey: value, rng: r }
  }
  const { name, rng: r } = pickNameBySex(sex, rng)
  return { nameKey: name, rng: r }
}

function pickMerchantHouseName(
  rng: RngState,
  namePoolService: NamePoolService | undefined,
  usedHouseNames: Set<string>,
  fallbackIndex: number,
): { nameKey: string; rng: RngState } {
  if (namePoolService) {
    const { value, rng: r } = namePoolService.pickNameKey(rng, {
      nameCultureId: 'western',
      category: 'house',
      path: ['noble'],
    })
    return { nameKey: value, rng: r }
  }
  const { name, rng: r } = pickUniqueName(
    houseNamePool(),
    usedHouseNames,
    houseName,
    fallbackIndex,
    rng,
  )
  return { nameKey: name, rng: r }
}

// person 属性から決定的に share rawPower を導く（§9.1。RNG 非使用）。
//   当主（head=memberIndex 0）に厚め、年齢と統治系能力で加重する。
function computeShareRawPower(age: number, governanceish: number, isHead: boolean): number {
  const base = isHead ? 40 : 15
  return base + Math.min(40, age * 0.4) + governanceish * 0.3
}

// merchant の 4 collection + index を clone する（in-place mutation 前提）。persons/houses は含まない
//   ので、それらを触る seed 系（worldgen / 再興）は別途 clone する。cleanup は merchant slice のみで足りる。
export function cloneMerchantSlicesOnly(world: WorldState): WorldState {
  return {
    ...world,
    merchantCompanies: { ...world.merchantCompanies },
    merchantCompanyIndex: {
      byOwnerHouse: { ...world.merchantCompanyIndex.byOwnerHouse },
      byStatus: {
        active: [...world.merchantCompanyIndex.byStatus.active],
        bankrupt: [...world.merchantCompanyIndex.byStatus.bankrupt],
        dormant: [...world.merchantCompanyIndex.byStatus.dormant],
        dissolved: [...world.merchantCompanyIndex.byStatus.dissolved],
      },
    },
    merchantCompanyEstablishments: { ...world.merchantCompanyEstablishments },
    merchantCompanyEstablishmentIndex: {
      byCompany: { ...world.merchantCompanyEstablishmentIndex.byCompany },
      byHolding: { ...world.merchantCompanyEstablishmentIndex.byHolding },
      byKind: {
        headquarters: [...world.merchantCompanyEstablishmentIndex.byKind.headquarters],
        branch: [...world.merchantCompanyEstablishmentIndex.byKind.branch],
      },
    },
    tradeRoutes: { ...world.tradeRoutes },
    tradeRouteIndex: {
      byCompany: { ...world.tradeRouteIndex.byCompany },
      bySourceState: { ...world.tradeRouteIndex.bySourceState },
      byTargetState: { ...world.tradeRouteIndex.byTargetState },
      byResource: { ...world.tradeRouteIndex.byResource },
      byStatus: {
        active: [...world.tradeRouteIndex.byStatus.active],
        closing: [...world.tradeRouteIndex.byStatus.closing],
        closed: [...world.tradeRouteIndex.byStatus.closed],
      },
    },
    merchantCompanyShares: { ...world.merchantCompanyShares },
    merchantCompanyShareIndex: {
      byCompany: { ...world.merchantCompanyShareIndex.byCompany },
      byHolder: { ...world.merchantCompanyShareIndex.byHolder },
    },
  }
}

// 1 つの StateRegion に商会 1 社を seed する（House[dh-]+members[pe-]+Company+HQ+shares+route+offices）。
//   worldgen（隔離 rng）と runtime 再興（ctx.rng）の両方が呼ぶ。counters は in-place で進める。
//   state は clone 済み slice を持つ前提。city holding が無ければ null。
export function seedOneMerchantCompany(
  stateIn: WorldState,
  stateId: StateRegionId,
  rngIn: RngState,
  config: SimulationConfig,
  namePoolService: NamePoolService | undefined,
  counters: { nextPersonIndex: number; nextHouseIndex: number },
): { state: WorldState; rng: RngState } | null {
  let state = stateIn
  let rng = rngIn
  const createdWeek = state.absoluteWeek

  const cityHoldingId = getStateCityHoldingId(state, stateId)
  if (!cityHoldingId) return null
  const cityHolding = state.holdings[cityHoldingId]
  if (!cityHolding) return null
  const seatProvinceId: ProvinceId = cityHolding.provinceId

  // --- merchant House + members（runtime 名前空間 dh-・person は pe-）---
  const houseId = createHouseId('dh', counters.nextHouseIndex++)
  const memberIds: PersonId[] = []
  const memberMeta: { id: PersonId; age: number; gov: number }[] = []
  for (let i = 0; i < MERCHANT_HOUSE_MEMBER_COUNT; i++) {
    const personId = createPersonId('pe', counters.nextPersonIndex++)
    const sexRoll = randomFloat(rng)
    rng = sexRoll.rng
    const sex: Sex = sexRoll.value < config.maleBirthChance ? 'male' : 'female'
    const ageRoll = randomInt(rng, 30, 55)
    rng = ageRoll.rng
    const age = ageRoll.value
    const ambRoll = randomFloat(rng)
    rng = ambRoll.rng
    const cauRoll = randomFloat(rng)
    rng = cauRoll.rng
    const nameRes = pickName(sex, rng, namePoolService)
    rng = nameRes.rng
    const sampled = samplePerson(rng, config, {
      id: personId,
      nameKey: nameRes.nameKey,
      sex,
      age,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: ambRoll.value, caution: cauRoll.value },
    })
    rng = sampled.rng
    const person = sampled.value
    state.persons[personId] = person
    memberIds.push(personId)
    const gov = (person.abilities.learning + person.abilities.numeracy) / 2
    memberMeta.push({ id: personId, age, gov })
  }
  state.livingPersonIds = [...state.livingPersonIds, ...memberIds].sort((a, b) =>
    (a as string).localeCompare(b),
  )

  const usedHouseNames = new Set(
    Object.values(state.houses)
      .filter((h) => h)
      .map((h) => h.nameKey),
  )
  const houseNameRes = pickMerchantHouseName(
    rng,
    namePoolService,
    usedHouseNames,
    counters.nextHouseIndex,
  )
  rng = houseNameRes.rng
  state.houses[houseId] = {
    id: houseId,
    nameKey: houseNameRes.nameKey,
    active: true,
    kind: 'normal',
    memberIds,
    deceasedMemberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId,
  }

  // --- Company + HQ（HQ を先に作り headquartersEstablishmentId を確定値で持たせる）---
  const hq = createMerchantCompanyEstablishmentMut(state, {
    companyId: createMerchantCompanyId(state.nextMerchantCompanyId),
    holdingId: cityHoldingId,
    kind: 'headquarters',
    level: 1,
    createdWeek,
  })
  const company = createMerchantCompanyMut(state, {
    nameKey: houseNameRes.nameKey,
    ownerHouseId: houseId,
    treasury: config.merchantCompanyFoundingTreasury,
    createdWeek,
    headquartersEstablishmentId: hq.id,
  })

  // --- Shares（RNG-free・person 属性ベース）---
  for (let i = 0; i < memberMeta.length; i++) {
    const m = memberMeta[i]!
    createMerchantCompanyShareMut(state, {
      companyId: company.id,
      holderPersonId: m.id,
      rawPower: computeShareRawPower(m.age, m.gov, i === 0),
    })
  }

  // --- 初期 route（§19.4 簡易版: source 産出 argmax × 最小 id 隣接 state）---
  const adjacent = getAdjacentStateRegionIds(state, stateId)
  if (adjacent.length > 0) {
    const targetStateId = adjacent[0]!
    const potential = estimateStateProductionPotential(state, stateId)
    let bestResource: ResourceKind | undefined
    let bestVal = 0
    for (const r of RESOURCE_KINDS) {
      const v = potential[r] ?? 0
      if (v > bestVal) {
        bestVal = v
        bestResource = r
      }
    }
    if (bestResource) {
      createTradeRouteMut(state, {
        companyId: company.id,
        sourceStateId: stateId,
        targetStateId,
        resource: bestResource,
        level: 1,
        createdWeek,
      })
    }
  }

  // --- Office: house:leader（core integrity）+ 会頭/番頭 ---
  state = createOfficeAssignment(state, { kind: 'house', id: houseId }, 'leader', memberMeta[0]!.id)
  const ref = { kind: 'merchant_company' as const, id: company.id }
  const chairman = getMerchantCompanyDecisionMaker(state, company.id)
  if (chairman) state = createOfficeAssignment(state, ref, 'leader', chairman)
  let bestAdmin: PersonId | undefined
  let bestGov = -1
  for (const pid of [...memberIds].sort((a, b) => (a as string).localeCompare(b))) {
    if (chairman && (pid as string) === (chairman as string)) continue
    const p = state.persons[pid]
    if (!p || !p.alive || p.kind === 'placeholder') continue
    const gov = (p.abilities.learning + p.abilities.numeracy) / 2
    if (gov > bestGov) {
      bestGov = gov
      bestAdmin = pid
    }
  }
  if (bestAdmin) state = createOfficeAssignment(state, ref, 'administrator', bestAdmin)

  return { state, rng }
}

export function seedMerchantCompanies(
  world: WorldState,
  seedText: string,
  config: SimulationConfig,
  namePoolService?: NamePoolService,
): WorldState {
  let rng = createRng(seedText + ':merchant')
  let state: WorldState = {
    ...cloneMerchantSlicesOnly(world),
    persons: { ...world.persons },
    houses: { ...world.houses },
  }
  const counters = {
    nextPersonIndex: world.nextPersonIndex ?? 0,
    nextHouseIndex: world.nextHouseIndex ?? 0,
  }

  for (const stateId of (Object.keys(state.states) as StateRegionId[]).sort((a, b) =>
    (a as string).localeCompare(b),
  )) {
    const res = seedOneMerchantCompany(state, stateId, rng, config, namePoolService, counters)
    if (!res) continue
    state = res.state
    rng = res.rng
  }

  return {
    ...state,
    nextPersonIndex: counters.nextPersonIndex,
    nextHouseIndex: counters.nextHouseIndex,
  }
}
