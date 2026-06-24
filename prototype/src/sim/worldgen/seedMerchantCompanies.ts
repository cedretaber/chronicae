import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PersonId, StateRegionId, ProvinceId, HouseId, MerchantCompanyId } from '../types/ids'
import { createHouseId, createPersonId, createMerchantCompanyId } from '../types/ids'
import type { Sex } from '../types/person'
import type { ResourceKind } from '../types/resource'
import { RESOURCE_KINDS } from '../types/resource'
import { createRng, randomFloat, randomInt } from '../rng/rng'
import type { RngState } from '../rng/rng'
import { samplePerson } from '../helpers/personFactory'
import { pickNameBySex } from './nameGenerators'
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

// person 属性から決定的に share rawPower を導く（§9.1。RNG 非使用）。
//   当主（head=memberIndex 0）に厚め、年齢と統治系能力で加重する。
function computeShareRawPower(age: number, governanceish: number, isHead: boolean): number {
  const base = isHead ? 40 : 15
  return base + Math.min(40, age * 0.4) + governanceish * 0.3
}

export function seedMerchantCompanies(
  world: WorldState,
  seedText: string,
  config: SimulationConfig,
  namePoolService?: NamePoolService,
): WorldState {
  let rng = createRng(seedText + ':merchant')

  // 触る slice を clone（merchant mutation は in-place、office は immutable）。
  let state: WorldState = {
    ...world,
    persons: { ...world.persons },
    houses: { ...world.houses },
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

  let nextPersonIndex = world.nextPersonIndex ?? 0
  let nextHouseIndex = world.nextHouseIndex ?? 0
  const createdWeek = world.absoluteWeek

  // 後で office を付ける company を記録（merchant entity 作成 → office 作成の順）。
  const pending: { companyId: MerchantCompanyId; houseId: HouseId; headId: PersonId }[] = []

  for (const stateId of (Object.keys(state.states) as StateRegionId[]).sort((a, b) =>
    (a as string).localeCompare(b),
  )) {
    const cityHoldingId = getStateCityHoldingId(state, stateId)
    if (!cityHoldingId) continue
    const cityHolding = state.holdings[cityHoldingId]
    if (!cityHolding) continue
    const seatProvinceId: ProvinceId = cityHolding.provinceId

    // --- merchant House + members ---
    // 家は runtime 名前空間 `dh-` を使う（worldgen `h-` と衝突させない。nextHouseIndex は dh- 採番器）。
    const houseId = createHouseId('dh', nextHouseIndex++)
    const memberIds: PersonId[] = []
    const memberMeta: { id: PersonId; age: number; gov: number }[] = []
    for (let i = 0; i < MERCHANT_HOUSE_MEMBER_COUNT; i++) {
      const personId = createPersonId('pe', nextPersonIndex++)
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
    state.livingPersonIds = [...state.livingPersonIds, ...memberIds]

    // 家名: person 名と同じ pool（worldgen 既存 house は別 pool だが、商会家は person pool 流用で可）。
    const houseNameRes = pickName('male', rng, namePoolService)
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

    // --- Company + HQ ---
    // HQ を先に作って company を後で作る（headquartersEstablishmentId を確定値で持たせる）。
    const hq = createMerchantCompanyEstablishmentMut(state, {
      companyId: createMerchantCompanyId(state.nextMerchantCompanyId), // 直後に作る company の id を先取り
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

    // --- 初期 route（§19.4 簡易版: source 産出 argmax × 最小 id 隣接 state。需要考慮は balance-defer）---
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

    pending.push({ companyId: company.id, houseId, headId: memberMeta[0]!.id })
  }

  // 永続 next index 更新 + livingPersonIds を canonical（string-sort）に戻す（§ integrity 整合）。
  state = {
    ...state,
    nextPersonIndex,
    nextHouseIndex,
    livingPersonIds: [...state.livingPersonIds].sort((a, b) => (a as string).localeCompare(b)),
  }

  // --- Office ---
  for (const { companyId, houseId, headId } of pending) {
    // merchant House は normal House なので house:leader が必要（core integrity）。head member を当主に。
    state = createOfficeAssignment(state, { kind: 'house', id: houseId }, 'leader', headId)

    // 会長 = share decisionMaker → merchant_company:leader / 番頭 → administrator。
    const ref = { kind: 'merchant_company' as const, id: companyId }
    const chairman = getMerchantCompanyDecisionMaker(state, companyId)
    if (chairman) {
      state = createOfficeAssignment(state, ref, 'leader', chairman)
    }
    const houseMembers = state.houses[houseId]?.memberIds ?? []
    let bestAdmin: PersonId | undefined
    let bestGov = -1
    for (const pid of [...houseMembers].sort((a, b) => (a as string).localeCompare(b))) {
      if (chairman && (pid as string) === (chairman as string)) continue
      const p = state.persons[pid]
      if (!p || !p.alive || p.kind === 'placeholder') continue
      const gov = (p.abilities.learning + p.abilities.numeracy) / 2
      if (gov > bestGov) {
        bestGov = gov
        bestAdmin = pid
      }
    }
    if (bestAdmin) {
      state = createOfficeAssignment(state, ref, 'administrator', bestAdmin)
    }
  }

  return state
}
