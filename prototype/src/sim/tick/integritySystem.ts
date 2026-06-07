import type { TickContext } from './context'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { checkCoreEntities } from './integrityCoreChecks'
import { checkLandContractsAndPersons } from './integrityLandPersonChecks'
import { checkFactionsAndClans } from './integrityFactionClanChecks'
import { checkDiplomacyWarRegiment } from './integrityDiplomacyWarChecks'
import { checkGeographyAndHoldings } from './integrityGeographyHoldingChecks'
import { checkGoalsAimsProjects } from './integrityGoalProjectChecks'
import { checkPoliticalRights } from './integrityRightChecks'
import { checkPersonReputations } from './integrityReputationChecks'

// v0.16 §25 IntegrityCheck 33 項目の実装状況サマリ:
//
//   #1  各 Province に root contract 1 本               → 後段「§25 #1: 各 Province に root contract が 1 本」で error throw
//   #2  root の rootAuthorityId は ROOT_WORLD            → 「§25 #2: root contract は rootAuthorityId を持ち ROOT_WORLD」で error throw
//   #3  child は rootAuthorityId を持たない              → 「§25 #3: parent を持つ contract は rootAuthorityId を持たない」で error throw
//   #4  chain は枝分かれしない                          → 「§25 #4: chain 上の child contract は最大 1 つ」で error throw
//   #5  contract.provinceId 存在                         → 「§25 #5: 各 LandContract の provinceId は存在する Province」で error throw
//   #6  contract.provinceId == parent.provinceId         → 「§25 #6: contract.provinceId は parent contract の provinceId と一致」で error throw
//   #7  getGrantorRank < grantee.rank                    → 「§25 #7: getGrantorRank(grantor) < grantee.rank」で error throw
//   #8  grantee は active Polity                         → v0.16 §7 不変条件 8 区画で error throw
//   #9  parentContractId 存在                            → 「§25 #9: parentContractId は存在する LandContract」で error throw
//   #10 House/Person grantee 不可                        → 型レベル保証 (LandContract.granteePolityId: PolityId のみ)。runtime チェック不要
//   #11 root taxRate = 0                                 → 「§25 #11: root contract の terms.taxRateToGrantor は 0」で error throw
//   #12 (削除) byProvince 同期 + chain 順                → 調査 §4.1 で byProvince index を撤去。parent linkage は #14, terminal は #15 が検証
//   #13 byGranteePolity 同期                             → 「§25 #13: landContractIndex.byGranteePolity は state.landContracts と一致」で error throw
//   #14 byParent 同期 (parent → child 方向)              → 「§25 #14: landContractIndex.byParent は state.landContracts と一致」で error throw
//   #15 holdingTerminalPolityCache 同期                  → 「§25 #15: holdingTerminalPolityCache は chain の terminal grantee と一致」で error throw
//   #16 polityIndex.byOwnerHouse 同期                    → 「§25 #16: polityIndex.byOwnerHouse は state.polities と一致」で error throw
//   #17 landless Polity == inactive                      → 「§25 #17: landless Polity は active=false である」で error throw
//   #18 house.seatProvinceId 存在                        → 「§25 #18: House.seatProvinceId は存在する Province」で error throw
//   #19 polity.capitalProvinceId 存在                    → 直前ブロックで error throw
//   #20 House active 判定が memberIds ベース             → コードレベル保証 (houseExtinctionSystem は memberIds 判定のみ)。runtime チェック不要
//   #21 ownerHouseId active                              → 「§25 #21: Polity.ownerHouseId が定義済みなら、その House は存在し active」で error throw
//   #22 Province.houseControl 型から削除                 → 型レベル保証。runtime チェック不要
//   #23 各 Province に active bailiff 1 つ                → HoldingOffice に移行 (H1, H2, H3)
//   #24 bailiff holder 存在                              → HoldingOffice に移行 (H1, H2, H3)
//   #25 placeholder ガード sweep                         → 「全 Person-loop に kind === 'placeholder' continue」のコードレビューで担保。runtime チェック困難 (システム毎の動的検証は意味がない)
//   #26 placeholder は kind === 'placeholder' で判定     → コードレベル保証 (isPlaceholderPerson selector 経由)。runtime チェック不要
//   #27 AnonymousHouse 存在                              → 「§25 #27: AnonymousHouse は worldgen 後に必ず 1 つ存在」で error throw
//   #28 placeholder Person.houseId = AnonymousHouse.id   → 「§25 #28: 全 placeholder Person の houseId は AnonymousHouse」で error throw
//   #29 normal House.memberIds に placeholder 無し       → 「§25 #29 inverse: Non-placeholder Person が AnonymousHouse」と「Normal House に placeholder member」の双方で error throw
//   #30 AnonymousHouse が grantee / ownerHouse / share holder にならない → 「§25 #30」ブロックで error throw
//   #31 AnonymousHouse.memberIds 全員 placeholder         → 「§25 #31: AnonymousHouse contains non-placeholder member」で error throw
//   #32 HoldingOfficeAssignment は OfficeAssignment と別 entity → 型レベル保証 (OrganizationKind に 'holding' は含まれない)。runtime チェック不要
//   #33 holdingOfficeIndex.byHolding 同期                 → 「§25 H1: holdingOfficeIndex.byHolding[X] entry」で error throw
//
// 実装すべき 33 項目のうち error throw: 25 項目
// 型レベル保証 (runtime 不要): #10, #20, #22, #26, #32 = 5 項目
// コードレビューで担保 (runtime 困難): #25 = 1 項目
// (warn → error 昇格 済み: #19)

// 整合性チェックは domain 別ファイルへ分割した checkX 群を、元の collectIntegrityErrors と
// 同一順序で呼び出すオーケストレータ。各 checkX は共有の errors 配列へ push するため、
// 分割前と push 順序・内容は完全に一致する (bit-identical)。
export function collectIntegrityErrors(
  state: WorldState,
  options?: { debug?: boolean; config?: SimulationConfig },
): SimError[] {
  const debug = options?.debug ?? false
  const config = options?.config
  const errors: SimError[] = []

  checkCoreEntities(state, errors, debug)
  checkLandContractsAndPersons(state, errors)
  checkFactionsAndClans(state, errors)
  checkDiplomacyWarRegiment(state, errors, config)
  checkGeographyAndHoldings(state, errors, debug, config)
  checkGoalsAimsProjects(state, errors, debug, config)
  checkPoliticalRights(state, errors)
  checkPersonReputations(state, errors)

  return errors
}

export function runIntegritySystem(ctx: TickContext): TickContext {
  const errors = collectIntegrityErrors(ctx.state, { debug: ctx.config.debug, config: ctx.config })

  if (errors.length > 0) {
    for (const error of errors) {
      console.error('INTEGRITY:', error.message)
    }
    throw new Error(`Integrity check failed with ${errors.length} error(s): ${errors[0]?.message}`)
  }

  return ctx
}
