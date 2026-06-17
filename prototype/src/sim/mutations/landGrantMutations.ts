import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, HouseId, PersonId, HoldingId } from '../types/ids'
import type { Polity } from '../types/polity'
import type { House } from '../types/house'
import { createChildLandContract } from './landContractMutations'
import { createOfficeAssignment } from './officeMutations'
import { moveFounderFamilyToHouse } from './personMutations'
import { addHouseToClan } from './clanMutations'

// v0.47 §8.2: 分封による rank 5 normal Polity を新設する mut。
// ID は ws.nextPolityIndex から採番する (呼出側 = runProjectStageSystem が ctx.nextPolityIndex を
// seed し、終了時に ctx へ書き戻す)。nameSource は holding 借用、origin は land_grant。
function createGrantedRank5PolityMut(
  ws: WorldState,
  config: SimulationConfig,
  params: {
    grantorPolityId: PolityId
    holdingId: HoldingId
    founderPersonId: PersonId
    ownerHouseId: HouseId
    parentHouseId?: HouseId
  },
): { ws: WorldState; polityId: PolityId } | undefined {
  const holding = ws.holdings[params.holdingId]
  if (!holding) return undefined
  const nextIndex = ws.nextPolityIndex ?? 0
  const polityId = `dp-${nextIndex}` as PolityId

  const polity: Polity = {
    id: polityId,
    nameSource: { kind: 'holding', holdingId: params.holdingId },
    treasury: config.landGrantInitialTreasury,
    adminPower: 0,
    legacyPrestige: config.landGrantInitialLegacyPrestige,
    active: true,
    capitalProvinceId: holding.provinceId,
    ownerHouseId: params.ownerHouseId,
    rank: 5,
    territorialStatus: 'territorial',
    origin: {
      kind: 'land_grant',
      grantorPolityId: params.grantorPolityId,
      founderPersonId: params.founderPersonId,
      ownerHouseId: params.ownerHouseId,
      ...(params.parentHouseId !== undefined && { parentHouseId: params.parentHouseId }),
      holdingId: params.holdingId,
      week: ws.absoluteWeek,
    },
  }

  const byOwnerHouse = { ...ws.polityIndex.byOwnerHouse }
  const slot = byOwnerHouse[params.ownerHouseId] ?? []
  byOwnerHouse[params.ownerHouseId] = [...slot, polityId]

  const nextWs: WorldState = {
    ...ws,
    polities: { ...ws.polities, [polityId]: polity },
    polityIndex: { byOwnerHouse },
    nextPolityIndex: nextIndex + 1,
  }
  return { ws: nextWs, polityId }
}

// 分封の成功時 orchestration (§9.7)。新 House / 分家 House 作成 + rank5 Polity 新設 +
// 家族移動 + leader 設定 + child LandContract を行う。失敗時 undefined。
// params.parentHouseId === undefined: 無家人物 (新 House)、!== undefined: 有家人物 (分家)。
export function applyLandGrantMut(
  ws: WorldState,
  config: SimulationConfig,
  params: {
    petitionerPersonId: PersonId
    donorPolityId: PolityId
    holdingId: HoldingId
    parentHouseId?: HouseId
  },
): { ws: WorldState; newPolityId: PolityId; newHouseId: HouseId } | undefined {
  const petitioner = ws.persons[params.petitionerPersonId]
  if (!petitioner) return undefined
  const donor = ws.polities[params.donorPolityId]
  if (!donor) return undefined
  const holding = ws.holdings[params.holdingId]
  if (!holding) return undefined
  // donor が当該 holding の terminal owner であることを確認 (parentContract の親)。
  if (ws.holdingTerminalPolityCache[params.holdingId] !== params.donorPolityId) return undefined
  const chain = ws.landContractIndex.byHolding[params.holdingId] ?? []
  const parentContractId = chain[chain.length - 1]
  if (!parentContractId) return undefined
  const parentContract = ws.landContracts[parentContractId]
  if (!parentContract || parentContract.granteePolityId !== params.donorPolityId) return undefined

  let state = ws
  const nextHouseIndex = state.nextHouseIndex ?? 0
  const newHouseId = `dh-${nextHouseIndex}` as HouseId

  // 1. House 作成 (無家 = self_made_foundation / 有家 = cadet_branch)。
  const parentHouse =
    params.parentHouseId !== undefined ? state.houses[params.parentHouseId] : undefined
  // 分封の家名は受領した領国 (= 新設 rank5 Polity・holding 名由来) の名前を snapshot する
  // (王朝名として固定)。新 Polity は holding 名なので category は holding.kind で決まる
  // (manor→'province' / city→'city'・getHoldingNameRefForEmit と同一規則)。
  const placeCategory: 'province' | 'city' = holding.kind === 'city' ? 'city' : 'province'
  const newHouse: House = {
    id: newHouseId,
    nameKey: holding.nameKey,
    nameSource: { kind: 'polity', category: placeCategory },
    active: true,
    memberIds: [],
    deceasedMemberIds: [],
    founderId: params.petitionerPersonId,
    cadetHouseIds: [],
    legacyPrestige: parentHouse ? Math.floor(parentHouse.legacyPrestige * 0.5) : 0,
    wealth: 0,
    seatProvinceId: holding.provinceId,
    creationKind: params.parentHouseId !== undefined ? 'cadet_branch' : 'self_made_foundation',
    creationReason: 'land_grant',
    ...(params.parentHouseId !== undefined && { parentHouseId: params.parentHouseId }),
    ...(parentHouse?.clanId !== undefined && { clanId: parentHouse.clanId }),
  }
  const nextHouses: Record<HouseId, House> = { ...state.houses, [newHouseId]: newHouse }
  if (parentHouse && params.parentHouseId !== undefined) {
    nextHouses[params.parentHouseId] = {
      ...parentHouse,
      cadetHouseIds: [...parentHouse.cadetHouseIds, newHouseId],
    }
  }
  state = { ...state, houses: nextHouses, nextHouseIndex: nextHouseIndex + 1 }

  // §17 C1: clanId を継承した cadet House は Clan.memberHouseIds にも登録する
  //   (worldStructureSplitHouse と同じ規約。欠落すると clanId 有 ↔ memberHouseIds 不在の C1 違反)。
  if (newHouse.clanId !== undefined) {
    state = addHouseToClan(state, newHouse.clanId, newHouseId)
  }

  // 2. rank5 Polity 新設。
  const polityResult = createGrantedRank5PolityMut(state, config, {
    grantorPolityId: params.donorPolityId,
    holdingId: params.holdingId,
    founderPersonId: params.petitionerPersonId,
    ownerHouseId: newHouseId,
    ...(params.parentHouseId !== undefined && { parentHouseId: params.parentHouseId }),
  })
  if (!polityResult) return undefined
  state = polityResult.ws
  const newPolityId = polityResult.polityId

  // 3. founder + 家族を新 House へ移す (§10)。
  state = moveFounderFamilyToHouse(state, params.petitionerPersonId, newHouseId)

  // 4. founder を新 House の house:leader に (新設 House は当主が必須)。
  state = createOfficeAssignment(
    state,
    { kind: 'house', id: newHouseId },
    'leader',
    params.petitionerPersonId,
  )

  // 5. founder を新 Polity leader に。
  state = createOfficeAssignment(
    state,
    { kind: 'polity', id: newPolityId },
    'leader',
    params.petitionerPersonId,
  )

  // 6. child LandContract (donor terminal → new rank5 Polity)。
  const contractResult = createChildLandContract(state, {
    provinceId: holding.provinceId,
    parentContractId,
    granteePolityId: newPolityId,
    taxRateToGrantor: config.landGrantContractTaxRate,
    holdingId: params.holdingId,
  })
  state = contractResult.state

  return { ws: state, newPolityId, newHouseId }
}
