import type { PolityId, HouseId, LandContractId, PersonId, HoldingId } from '../types/ids'
import { getGrantorRank, getLandContractGrantor } from '../selectors/landContractSelectors'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import { getPolityTerritorialStatus } from '../types/polity'
import { VALID_PROVINCE_TERRAINS, VALID_PROVINCE_FEATURES } from './integrityConstants'

export function checkLandContractsAndPersons(state: WorldState, errors: SimError[]): void {
  // ─── v0.16 §25 LandContract / AnonymousHouse / HoldingOffice 不変条件 ───

  // §25 #5: 各 LandContract の provinceId は存在する Province を指す
  // §25 #6: contract.provinceId は parent contract の provinceId と一致する
  // §25 #7: getGrantorRank(grantor) < grantee.rank
  // §25 #9: parentContractId は存在する LandContract を指す
  // §25 #11: root contract (parentContractId なし) の terms.taxRateToGrantor は 0
  for (const contractIdStr of Object.keys(state.landContracts)) {
    const contractId = contractIdStr as LandContractId
    const contract = state.landContracts[contractId]
    if (!contract) continue
    if (!state.provinces[contract.provinceId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `LandContract ${contractId} provinceId ${contract.provinceId} does not exist (§25 #5)`,
      })
    }
    if (contract.parentContractId !== undefined) {
      const parent = state.landContracts[contract.parentContractId]
      if (!parent) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `LandContract ${contractId} parentContractId ${contract.parentContractId} does not exist (§25 #9)`,
        })
      } else if (parent.provinceId !== contract.provinceId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `LandContract ${contractId} provinceId ${contract.provinceId} differs from parent ${parent.id} provinceId ${parent.provinceId} (§25 #6)`,
        })
      }
    } else {
      if (contract.terms.taxRateToGrantor !== 0) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Root LandContract ${contractId} taxRateToGrantor=${contract.terms.taxRateToGrantor} must be 0 (§25 #11)`,
        })
      }
    }
    const grantee = state.polities[contract.granteePolityId]
    if (grantee) {
      const grantor = getLandContractGrantor(state, contractId)
      if (grantor) {
        const grantorRank = getGrantorRank(state, grantor)
        if (grantorRank >= grantee.rank) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `LandContract ${contractId} grantorRank=${grantorRank} >= granteeRank=${grantee.rank} (§25 #7)`,
          })
        }
      }
    }
  }

  // §25 #1: 各 Holding の byHolding chain 先頭が root contract (parentContractId === undefined)
  // §25 #4: chain 上の child contract は最大 1 つ (枝分かれしない)
  {
    for (const holdingIdStr of Object.keys(state.holdings)) {
      const holdingChain = state.landContractIndex.byHolding[holdingIdStr as HoldingId] ?? []
      if (holdingChain.length === 0) continue
      const rootContract = state.landContracts[holdingChain[0]!]
      if (rootContract && rootContract.parentContractId !== undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Holding ${holdingIdStr} chain root ${holdingChain[0]} has parentContractId (not a true root) (§25 #1)`,
        })
      }
    }
    const childCount: Record<LandContractId, number> = {}
    for (const contractIdStr of Object.keys(state.landContracts)) {
      const contract = state.landContracts[contractIdStr as LandContractId]
      if (!contract) continue
      if (contract.parentContractId !== undefined) {
        childCount[contract.parentContractId] = (childCount[contract.parentContractId] ?? 0) + 1
      }
    }
    for (const parentId of Object.keys(childCount)) {
      const c = childCount[parentId as LandContractId] ?? 0
      if (c > 1) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `LandContract ${parentId} has ${c} child contracts (branching detected) (§25 #4)`,
        })
      }
    }
  }

  // v0.33 §13.1: 各 Province の terrain は有効値、features は有効値の重複なし配列
  for (const [provIdStr, prov] of Object.entries(state.provinces)) {
    if (!prov) continue
    if (!VALID_PROVINCE_TERRAINS.has(prov.terrain)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provIdStr} has invalid terrain ${prov.terrain} (v0.33 §13.1)`,
      })
    }
    if (!Array.isArray(prov.features)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Province ${provIdStr} features is not an array (v0.33 §13.1)`,
      })
    } else {
      const seen = new Set<string>()
      for (const f of prov.features) {
        if (!VALID_PROVINCE_FEATURES.has(f)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Province ${provIdStr} has invalid feature ${f} (v0.33 §13.1)`,
          })
        }
        if (seen.has(f)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `Province ${provIdStr} has duplicate feature ${f} (v0.33 §13.1)`,
          })
        }
        seen.add(f)
      }
    }
  }

  // 調査 §4.1: 旧 §25 #12 (landContractIndex.byProvince の chain 整合検証) は byProvince 撤去に伴い削除。
  // contract の parent linkage は §25 #14 (byParent) が、grantee は §25 #13 (byGranteePolity) が、
  // 各 Holding の terminal は下記 §25 #15 が引き続き検証する。

  // §25 #15: holdingTerminalPolityCache は各 Holding の byHolding chain terminal grantee と一致
  for (const holdingIdStr of Object.keys(state.holdings)) {
    const hid = holdingIdStr as HoldingId
    const holdingChain = state.landContractIndex.byHolding[hid] ?? []
    if (holdingChain.length === 0) continue
    const terminalId = holdingChain[holdingChain.length - 1]!
    const terminal = state.landContracts[terminalId]
    if (!terminal) continue
    const cached = state.holdingTerminalPolityCache[hid]
    if (cached !== terminal.granteePolityId) {
      const holding = state.holdings[hid]
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `holdingTerminalPolityCache[${hid}]=${cached} differs from byHolding chain terminal grantee ${terminal.granteePolityId} for province ${holding?.provinceId} (§25 #15)`,
      })
    }
  }

  // §25 #13: landContractIndex.byGranteePolity は state.landContracts と一致
  // §25 #14: landContractIndex.byParent は state.landContracts と一致
  //   注: byParent は「parent contract id → 直下 child contract id」のマッピング
  //   (mutations/landContractMutations.ts:createChildLandContract と同じ方向)。
  //   各 parent は 1 child しか持たない (§7 #5 枝分かれ禁止)。leaf parent は entry なし。
  {
    const expectedByGrantee: Record<PolityId, Set<LandContractId>> = {}
    const expectedByParent: Record<LandContractId, LandContractId> = {}
    for (const contractIdStr of Object.keys(state.landContracts)) {
      const contractId = contractIdStr as LandContractId
      const c = state.landContracts[contractId]
      if (!c) continue
      if (!expectedByGrantee[c.granteePolityId]) {
        expectedByGrantee[c.granteePolityId] = new Set()
      }
      expectedByGrantee[c.granteePolityId]?.add(contractId)
      if (c.parentContractId !== undefined) {
        expectedByParent[c.parentContractId] = contractId
      }
    }
    for (const polityIdStr of Object.keys(expectedByGrantee)) {
      const polityId = polityIdStr as PolityId
      const expected = expectedByGrantee[polityId] ?? new Set()
      const actual = new Set(state.landContractIndex.byGranteePolity[polityId] ?? [])
      if (expected.size !== actual.size) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `landContractIndex.byGranteePolity[${polityId}] size=${actual.size} expected=${expected.size} (§25 #13)`,
        })
        continue
      }
      for (const id of expected) {
        if (!actual.has(id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `landContractIndex.byGranteePolity[${polityId}] missing ${id} (§25 #13)`,
          })
        }
      }
    }
    for (const parentIdStr of Object.keys(expectedByParent)) {
      const parentId = parentIdStr as LandContractId
      const expectedChild = expectedByParent[parentId]
      const actualChild = state.landContractIndex.byParent[parentId]
      if (actualChild !== expectedChild) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `landContractIndex.byParent[${parentId}]=${actualChild} expected=${expectedChild} (§25 #14)`,
        })
      }
    }
  }

  // §25 #16: polityIndex.byOwnerHouse は state.polities と一致 (ownerHouseId === undefined は含まれない)
  {
    const expected: Record<HouseId, Set<PolityId>> = {}
    for (const polityIdStr of Object.keys(state.polities)) {
      const polityId = polityIdStr as PolityId
      const p = state.polities[polityId]
      if (!p) continue
      if (p.ownerHouseId === undefined) continue
      if (!expected[p.ownerHouseId]) {
        expected[p.ownerHouseId] = new Set()
      }
      expected[p.ownerHouseId]?.add(polityId)
    }
    const actualHouses = new Set([
      ...Object.keys(expected),
      ...Object.keys(state.polityIndex.byOwnerHouse),
    ])
    for (const houseIdStr of actualHouses) {
      const houseId = houseIdStr as HouseId
      const expectedSet = expected[houseId] ?? new Set()
      const actualSet = new Set(state.polityIndex.byOwnerHouse[houseId] ?? [])
      if (expectedSet.size !== actualSet.size) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `polityIndex.byOwnerHouse[${houseId}] size=${actualSet.size} expected=${expectedSet.size} (§25 #16)`,
        })
        continue
      }
      for (const id of expectedSet) {
        if (!actualSet.has(id)) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `polityIndex.byOwnerHouse[${houseId}] missing ${id} (§25 #16)`,
          })
        }
      }
    }
  }

  // §25 #17: landless Polity (grantee 数 0) は active=false である
  // §25 #21: Polity.ownerHouseId が定義済みなら、その House は存在し active である
  for (const polityIdStr of Object.keys(state.polities)) {
    const polityId = polityIdStr as PolityId
    const p = state.polities[polityId]
    if (!p) continue
    const granteed = state.landContractIndex.byGranteePolity[polityId] ?? []
    // v0.47 §19.1: titular Polity は active landless が正常 (称号のみ・契約 0)。
    const isTitular = getPolityTerritorialStatus(p) === 'titular'
    if (granteed.length === 0 && p.active) {
      if (!(p.kind === 'commonwealth' && p.revoltState != null) && !isTitular) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Polity ${polityId} is active but has 0 LandContract grantee (§25 #17)`,
        })
      }
    }
    // v0.47 §19.1: titular Polity は LandContract を持たない
    if (isTitular && granteed.length > 0) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Polity ${polityId} is titular but has ${granteed.length} LandContract grantee (v0.47 §19.1)`,
      })
    }
    // v0.47 §19.1: rank 5 Polity は titular にならない (landless rank 5 は abolish される)
    if (isTitular && p.rank === 5) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Polity ${polityId} is rank 5 but titular (v0.47 §19.1)`,
      })
    }
    // v0.47 §19.5: land_grant origin の参照存在検査。origin.ownerHouseId は創設時履歴値であり
    //   現在の polity.ownerHouseId との一致は要求しない (§11 譲渡で current owner が変わるため)。
    if (p.origin.kind === 'land_grant') {
      const o = p.origin
      if (!state.holdings[o.holdingId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `land_grant Polity ${polityId} origin holdingId ${o.holdingId} does not exist (v0.47 §19.5)`,
        })
      }
      if (!state.persons[o.founderPersonId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `land_grant Polity ${polityId} origin founderPersonId ${o.founderPersonId} does not exist (v0.47 §19.5)`,
        })
      }
      if (!state.houses[o.ownerHouseId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `land_grant Polity ${polityId} origin ownerHouseId ${o.ownerHouseId} does not exist (v0.47 §19.5)`,
        })
      }
      if (o.parentHouseId !== undefined && !state.houses[o.parentHouseId]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `land_grant Polity ${polityId} origin parentHouseId ${o.parentHouseId} does not exist (v0.47 §19.5)`,
        })
      }
      if (p.rank !== 5) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `land_grant Polity ${polityId} must be rank 5 but is rank ${p.rank} (v0.47 §19.5)`,
        })
      }
      if (p.nameSource.kind !== 'holding') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `land_grant Polity ${polityId} nameSource.kind must be 'holding' but is '${p.nameSource.kind}' (v0.47 §19.5)`,
        })
      }
    }
    if (p.active && p.ownerHouseId !== undefined) {
      const owner = state.houses[p.ownerHouseId]
      if (!owner) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Active Polity ${polityId} ownerHouseId ${p.ownerHouseId} does not exist (§25 #21)`,
        })
      } else if (!owner.active) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Active Polity ${polityId} ownerHouseId ${p.ownerHouseId} is inactive (§25 #21)`,
        })
      }
    }
    if (p.revoltState != null) {
      if (p.kind !== 'commonwealth') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Polity ${polityId} has revoltState but kind=${p.kind ?? 'undefined'} (v0.39 §17.2)`,
        })
      }
      if (p.revoltState.kind === 'established' && !p.active) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Polity ${polityId} established commonwealth must be active (v0.39 §17.2)`,
        })
      }
    }
  }

  // §25 #18: House.seatProvinceId は存在する Province を指す
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h) continue
    if (h.kind === 'system') continue
    if (!state.provinces[h.seatProvinceId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `House ${houseId} seatProvinceId ${h.seatProvinceId} does not exist (§25 #18)`,
      })
    }
  }

  // v0.31.1: livingPersonIds ↔ persons 整合性チェック
  const expectedLiving = (Object.keys(state.persons) as PersonId[])
    .filter((id) => state.persons[id]?.alive)
    .sort()
  const actualLiving = state.livingPersonIds
  if (expectedLiving.length !== actualLiving.length) {
    errors.push({
      code: 'INTEGRITY_VIOLATION',
      message: `livingPersonIds count mismatch: expected ${expectedLiving.length}, got ${actualLiving.length}`,
    })
  } else {
    for (let i = 0; i < expectedLiving.length; i++) {
      if (expectedLiving[i] !== actualLiving[i]) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `livingPersonIds[${i}] mismatch: expected ${expectedLiving[i]}, got ${actualLiving[i]}`,
        })
        break
      }
    }
  }

  // v0.31 §16.2: placeholder は houseId を持たない
  for (const personIdStr of Object.keys(state.persons)) {
    const p = state.persons[personIdStr as PersonId]
    if (!p) continue
    if (p.kind === 'placeholder' && p.houseId !== undefined) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Placeholder Person ${p.id} has houseId=${p.houseId}, expected undefined`,
      })
    }
  }

  // v0.31 §16.2: placeholder は House.memberIds に含まれてはならない
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h) continue
    for (const memberId of h.memberIds) {
      const p = state.persons[memberId]
      if (p && p.kind === 'placeholder') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} contains placeholder member ${memberId}`,
        })
      }
    }
  }

  // v0.31 §16.2: person.houseId ↔ House.memberIds 双方向整合 (alive person のみ)
  for (const personIdStr of Object.keys(state.persons)) {
    const p = state.persons[personIdStr as PersonId]
    if (!p || !p.alive) continue
    if (p.houseId) {
      const h = state.houses[p.houseId]
      if (h && !h.memberIds.includes(p.id)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Person ${p.id} has houseId=${p.houseId} but is not in House.memberIds`,
        })
      }
    }
  }
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h) continue
    for (const memberId of h.memberIds) {
      const p = state.persons[memberId]
      if (p && p.houseId !== houseId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} memberIds contains ${memberId} but person.houseId=${p.houseId ?? 'undefined'}`,
        })
      }
    }
  }
}
