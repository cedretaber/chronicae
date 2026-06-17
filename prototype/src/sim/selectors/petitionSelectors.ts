import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, PersonId, HoldingId, HouseId } from '../types/ids'
import type { PolityRank } from '../types/polity'
import { getPolityTerritorialStatus } from '../types/polity'
import type { Person } from '../types/person'
import { isLifeStageAtLeast } from '../types/person'
import type { OfficeRole } from '../types/office'
import {
  getPolityHoldingCount,
  getGrantorRank,
  getLandContractGrantor,
  getPolityTerminalProvinceIds,
  getHouseOwnedPolityIds,
  getHoldingTerminalPolityId,
  getProvinceDevelopmentFromHoldings,
} from './landContractSelectors'
import { getPolityLeader, getHouseLeader } from './officeSelectors'
import { getHousePrimaryPolityId, getHouseDomainConsolidationSinkPolityId } from './polityRelations'
import { getPersonReputationSummary } from './personReputationSelectors'
import { getTopShareholders } from './shareSelectors'
import { getAdultSuccessionCandidates, getTopHeirIds } from './successionSelectors'
import { isEstablishedCommonwealthRepublic } from './republicSelectors'

// v0.47 §5: 陞爵 (rank promotion) の HARD gate / 同意者選定。
// petition Project (request_rank_promotion / request_land_grant 等) 共通の read-only selector 群。
// 本ファイルの selector は純粋関数であり mutation を行わない。

// §5.3 補助: 対象 Polity が grantee である全 LandContract について、grantor rank が
// newRank より上位 (= 数値が小さい。root は rank 0) であることを要求する。
// LandContract 不変条件 (grantor rank < grantee rank) を陞爵後も保つための事前検査。
function allGrantorRanksAreAboveNewRank(
  state: WorldState,
  polityId: PolityId,
  newRank: PolityRank,
): boolean {
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  for (const cid of contractIds) {
    const grantor = getLandContractGrantor(state, cid)
    if (!grantor) return false
    const grantorRank = getGrantorRank(state, grantor)
    if (!(grantorRank < newRank)) return false
  }
  return true
}

// §5.3 HARD gate: 対象 Polity が rank を 1 段昇格できるか。
// per-rank config が undefined (要件未定義) の newRank は保守的に昇格不可とする。
export function canPromotePolityRank(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  newRank: PolityRank,
): boolean {
  const polity = state.polities[polityId]
  if (!polity) return false

  const minHolding = config.rankPromotionMinHoldingCountByRank[newRank]
  const minTreasury = config.rankPromotionMinTreasuryByRank[newRank]
  const minPrestige = config.rankPromotionMinPrestigeByRank[newRank]
  const minAdmin = config.rankPromotionMinAdminPowerByRank[newRank]
  if (
    minHolding === undefined ||
    minTreasury === undefined ||
    minPrestige === undefined ||
    minAdmin === undefined
  ) {
    return false
  }

  return (
    polity.active &&
    polity.kind !== 'commonwealth' &&
    getPolityTerritorialStatus(polity) === 'territorial' &&
    newRank === polity.rank - 1 &&
    polity.rank >= 3 &&
    polity.rank <= 5 &&
    newRank >= 2 &&
    allGrantorRanksAreAboveNewRank(state, polityId, newRank) &&
    getPolityHoldingCount(state, polityId) >= minHolding &&
    polity.treasury >= minTreasury &&
    polity.legacyPrestige >= minPrestige &&
    polity.adminPower >= minAdmin
  )
}

// §5.4 SOFT 同意者: 陞爵を承認する宗主の leader。
// grantee である contract のうち polity grantor を持つものを列挙し、最も多くの holding を
// grant している grantor polity を選ぶ (同数なら PolityId 昇順)。その leader を approver とする。
// polity grantor が 0 件 (root 直属のみ) なら undefined = 宗主不在 → SOFT 判定は auto-grant。
export function selectRankPromotionApprover(
  state: WorldState,
  polityId: PolityId,
): PersonId | undefined {
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  const grantCountByPolity = new Map<PolityId, number>()
  for (const cid of contractIds) {
    const grantor = getLandContractGrantor(state, cid)
    if (!grantor || grantor.kind !== 'polity') continue
    grantCountByPolity.set(grantor.id, (grantCountByPolity.get(grantor.id) ?? 0) + 1)
  }
  if (grantCountByPolity.size === 0) return undefined

  let bestPolity: PolityId | undefined
  let bestCount = -1
  const sorted = [...grantCountByPolity.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [gpid, count] of sorted) {
    if (count > bestCount) {
      bestCount = count
      bestPolity = gpid
    }
  }
  if (!bestPolity) return undefined
  return getPolityLeader(state, bestPolity)
}

// ───────────────────────────────────────────────────────────────────────────
// v0.47 §8-9: 分封 (request_land_grant) の selector 群。
// ───────────────────────────────────────────────────────────────────────────

// 人物の全カテゴリ reputation 合算スコア (§9.2 実績条件)。
function getPersonTotalReputationScore(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): number {
  return getPersonReputationSummary(state, config, personId).reduce((sum, e) => sum + e.score, 0)
}

function hasActivePolityOffice(state: WorldState, personId: PersonId): boolean {
  for (const oaId of state.officeIndex.byHolderPerson[personId as string] ?? []) {
    const oa = state.officeAssignments[oaId]
    if (oa && oa.active && oa.organization.kind === 'polity') return true
  }
  return false
}

function hasActiveBailiff(state: WorldState, personId: PersonId): boolean {
  for (const hoId of state.holdingOfficeIndex.byHolderPerson[personId] ?? []) {
    const ho = state.holdingOfficeAssignments[hoId]
    if (ho && ho.active) return true
  }
  return false
}

// §9.2 HARD gate (petitioner 本人の資格・donor 非依存部分)。
export function meetsLandGrantPetitionerGate(
  state: WorldState,
  config: SimulationConfig,
  person: Person,
): boolean {
  if (!person.alive) return false
  if (person.kind === 'placeholder') return false
  if (!isLifeStageAtLeast(person.lifeStage, 'young_adulthood')) return false
  if (person.wealth < config.landGrantMinWealthForPetitioner) return false
  // v0.47.x: house leader は新たな House を興さない (現 House を放棄して house:leader office を
  //   dangling 化させ「leader が memberIds に居ない」整合違反を生む)。meetsCadetBranchPetitionerGate
  //   の同等除外と対称。houseless (person.houseId === undefined) は自立路として対象外。
  if (person.houseId !== undefined && getHouseLeader(state, person.houseId) === person.id)
    return false
  // 実績条件: reputation 十分 OR active office holder OR active bailiff
  const reputationOk =
    getPersonTotalReputationScore(state, config, person.id) >= config.landGrantMinReputationScore
  if (
    !reputationOk &&
    !hasActivePolityOffice(state, person.id) &&
    !hasActiveBailiff(state, person.id)
  )
    return false
  return true
}

const DONOR_OFFICE_ROLE_PRIORITY: Record<OfficeRole, number> = {
  leader: 0,
  administrator: 1,
  treasurer: 2,
  military: 3,
  advisor: 4,
}

// donor Polity が分封後も最小残存 holding を維持できるか (§8.5)。
function donorCanAffordGrant(
  state: WorldState,
  config: SimulationConfig,
  donorPolityId: PolityId,
): boolean {
  const count = getPolityHoldingCount(state, donorPolityId)
  if (count < config.landGrantMinGrantorHoldingCount) return false
  return count - 1 >= config.landGrantGrantorMinRemainingHoldingCount
}

// donor Polity が分封可能か (§8.4 条件)。
function isEligibleDonorPolity(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
): boolean {
  const p = state.polities[polityId]
  if (!p || !p.active) return false
  if (p.kind === 'commonwealth') return false
  if (getPolityTerritorialStatus(p) !== 'territorial') return false
  if (p.rank === 5) return false
  return donorCanAffordGrant(state, config, polityId)
}

// 家の権力が分散しているか (筆頭 share がしきい値以下) を判定する。
// true なら本拠 (primary) を donor 解禁してよい (権力が一部に集中していれば本拠は割らせない)。
// share データが無い / total raw power 0 (レコードが残ったまま rawPower が 0 に減衰した場合を含む)
//   家は集中とみなし core を保護する (保守的 default)。total 0 のとき getTopShareholders は
//   percent 0 のエントリを返すため、!top だけでなく percent <= 0 も集中扱いにする。
function isHouseDispersedForCoreDonation(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
): boolean {
  const top = getTopShareholders(state, houseId, 1)[0]
  if (!top || top.percent <= 0) return false
  return top.percent <= config.landGrantCoreDonorMaxTopSharePercent
}

// §9.3/§9.4: petitioner の donor Polity を選ぶ。
// 無家 = 在職先 Polity (active polity office → その organization / なければ bailiff の appointingPolityId、
//   role priority leader>administrator>treasurer>military>advisor>bailiff、同位は PolityId 昇順)。
// 有家 = 自家が owner の余剰 territorial Polity (rank!=5・grant 後最小 holding 維持・secondary 優先)。
//   consolidation sink (≠primary) は集約綱引き回避のため常に除外。primary (=1-polity 家では sink 兼) は
//   家の権力が分散しているとき (isHouseDispersedForCoreDonation) だけ donor 候補に解禁し、非 core を優先する。
export function selectLandGrantDonorPolity(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): PolityId | undefined {
  const person = state.persons[personId]
  if (!person) return undefined

  if (person.houseId === undefined) {
    // 無家: 在職先 polity を role priority で選ぶ。
    let best: { polityId: PolityId; priority: number } | undefined
    for (const oaId of state.officeIndex.byHolderPerson[personId as string] ?? []) {
      const oa = state.officeAssignments[oaId]
      if (!oa || !oa.active || oa.organization.kind !== 'polity') continue
      const pid = oa.organization.id
      if (!isEligibleDonorPolity(state, config, pid)) continue
      const priority = DONOR_OFFICE_ROLE_PRIORITY[oa.role] ?? 9
      if (
        !best ||
        priority < best.priority ||
        (priority === best.priority && pid.localeCompare(best.polityId) < 0)
      ) {
        best = { polityId: pid, priority }
      }
    }
    if (best) return best.polityId
    // bailiff の appointingPolityId (role priority 5 相当)。
    let bailiffBest: PolityId | undefined
    for (const hoId of state.holdingOfficeIndex.byHolderPerson[personId] ?? []) {
      const ho = state.holdingOfficeAssignments[hoId]
      if (!ho || !ho.active) continue
      const pid = ho.appointingPolityId
      if (!isEligibleDonorPolity(state, config, pid)) continue
      if (!bailiffBest || pid.localeCompare(bailiffBest) < 0) bailiffBest = pid
    }
    return bailiffBest
  }

  // 有家: 自家 owned territorial 余剰 polity (secondary 優先)。
  const houseId = person.houseId
  const primary = getHousePrimaryPolityId(state, houseId)
  const sink = getHouseDomainConsolidationSinkPolityId(state, config, houseId)
  const allowCore = isHouseDispersedForCoreDonation(state, config, houseId)
  const cands: { polityId: PolityId; holdingCount: number; isCore: boolean }[] = []
  for (const pid of getHouseOwnedPolityIds(state, houseId)) {
    const isPrimary = pid === primary
    const isSink = pid === sink
    if (isSink && !isPrimary) continue // 集約 sink (≠primary) は常に除外 (多 polity 家の集約綱引き回避)
    if (isPrimary && !allowCore) continue // primary (=1-polity 家では sink 兼) は分散時のみ解禁
    if (!isEligibleDonorPolity(state, config, pid)) continue
    cands.push({
      polityId: pid,
      holdingCount: getPolityHoldingCount(state, pid),
      isCore: isPrimary,
    })
  }
  if (cands.length === 0) return undefined
  // 非 core (周縁 secondary) 優先 → holding 数が少ない順 (周縁領を切り出す) → PolityId 昇順。
  cands.sort((a, b) => {
    if (a.isCore !== b.isCore) return a.isCore ? 1 : -1
    if (a.holdingCount !== b.holdingCount) return a.holdingCount - b.holdingCount
    return a.polityId.localeCompare(b.polityId)
  })
  return cands[0]?.polityId
}

// §8.6: donor Polity が terminal owner である holding から grant 対象 1 個を選ぶ。
// 周縁・低価値を優先: capital province 外 → development 低 → HoldingId 昇順。
// special status を持つ holding と、grant 後に donor が最小残存を割る場合は除外
// (donor が複数 holding を持つ前提なので、対象を 1 個外しても残存数は保たれる)。
function selectLandGrantTargetHolding(
  state: WorldState,
  config: SimulationConfig,
  donorPolityId: PolityId,
): HoldingId | undefined {
  const donor = state.polities[donorPolityId]
  if (!donor) return undefined
  if (!donorCanAffordGrant(state, config, donorPolityId)) return undefined

  type Cand = { holdingId: HoldingId; offCapital: number; development: number }
  const cands: Cand[] = []
  for (const provinceId of getPolityTerminalProvinceIds(state, donorPolityId)) {
    const province = state.provinces[provinceId]
    if (!province) continue
    const dev = getProvinceDevelopmentFromHoldings(state, provinceId, config)
    const offCapital = provinceId === donor.capitalProvinceId ? 1 : 0
    for (const holdingId of province.holdingIds) {
      // donor が当該 holding の terminal owner であることを確認 (chain 上の他家除外)。
      if (getHoldingTerminalPolityId(state, holdingId) !== donorPolityId) continue
      const holding = state.holdings[holdingId]
      if (!holding) continue
      // terminal chain に specialStatus (revolt_seizure 等) がある holding は除外 (§8.6)。
      const chain = state.landContractIndex.byHolding[holdingId] ?? []
      if (chain.some((cid) => state.landContracts[cid]?.specialStatus !== undefined)) continue
      cands.push({ holdingId, offCapital, development: dev })
    }
  }
  if (cands.length === 0) return undefined
  cands.sort((a, b) => {
    // capital province 外を優先 (offCapital=0 が先)
    if (a.offCapital !== b.offCapital) return a.offCapital - b.offCapital
    if (a.development !== b.development) return a.development - b.development
    return a.holdingId.localeCompare(b.holdingId)
  })
  return cands[0]?.holdingId
}

// petitioner が分封を願える状態か (HARD gate 全体: 本人資格 + donor 存在 + grant 可能 holding 存在)。
// aim 生成 (候補) と finalize 再検査で共有する。donor を返す (見つからなければ undefined)。
export function resolveLandGrantDonor(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): { donorPolityId: PolityId; holdingId: HoldingId } | undefined {
  const person = state.persons[personId]
  if (!person) return undefined
  if (!meetsLandGrantPetitionerGate(state, config, person)) return undefined
  const donorPolityId = selectLandGrantDonorPolity(state, config, personId)
  if (!donorPolityId) return undefined
  const holdingId = selectLandGrantTargetHolding(state, config, donorPolityId)
  if (!holdingId) return undefined
  return { donorPolityId, holdingId }
}

// §9.7 SOFT accept score。approver = donor polity leader の petitioner への attitude を主項に、
// petitioner reputation・Project progress を加える。閾値超過で成功。
export function computeLandGrantAcceptScore(
  state: WorldState,
  config: SimulationConfig,
  petitionerPersonId: PersonId,
  approverPersonId: PersonId | undefined,
  projectProgress: number,
  attitudeScore: number,
): number {
  const reputation = getPersonTotalReputationScore(state, config, petitionerPersonId)
  // approver 不在 (理論上 donor leader は常に居るが防御的に) なら attitude 0 とする。
  const attitude = approverPersonId !== undefined ? attitudeScore : 0
  return (
    config.landGrantAcceptThreshold * 0 + // base = 0 (閾値は呼出側で比較)
    attitude * config.landGrantApproverAttitudeWeight +
    reputation * config.landGrantPetitionerReputationWeight +
    projectProgress * config.landGrantProjectProgressWeight
  )
}

// ───────────────────────────────────────────────────────────────────────────
// v0.47 §11: Polity 譲渡による分家 (request_cadet_branch_title_transfer) の selector 群。
// ───────────────────────────────────────────────────────────────────────────

// §11.4 HARD gate (petitioner 本人)。house leader でなく、継承順位上位 N でなく、
// ambition / office / reputation のいずれかが十分な有家人物。
function meetsCadetBranchPetitionerGate(
  state: WorldState,
  config: SimulationConfig,
  person: Person,
): boolean {
  if (!person.alive) return false
  if (person.kind === 'placeholder') return false
  if (!isLifeStageAtLeast(person.lifeStage, 'young_adulthood')) return false
  if (person.houseId === undefined) return false
  const house = state.houses[person.houseId]
  if (!house || !house.active) return false
  // house leader は分家を興さない。
  const leaderId = getHouseLeader(state, person.houseId)
  if (leaderId === person.id) return false
  // 継承順位上位 N は候補から除外 (§11.5)。
  const leader = leaderId !== undefined ? state.persons[leaderId] : undefined
  if (leader) {
    const candidates = getAdultSuccessionCandidates(state, house, config)
    const topHeirs = getTopHeirIds(
      candidates,
      leader,
      config.cadetBranchExcludeTopSuccessionRanks,
      state,
      config,
    )
    if (topHeirs.has(person.id)) return false
  }
  // ambition / office / reputation のいずれか十分。
  const ambitionOk = person.traits.ambition * 100 >= config.cadetBranchMinAmbition
  const reputationOk =
    getPersonTotalReputationScore(state, config, person.id) >= config.landGrantMinReputationScore
  if (!ambitionOk && !hasActivePolityOffice(state, person.id) && !reputationOk) return false
  return true
}

// §11.6 譲渡対象 Polity。parentHouse が owner の active Polity (primary/sink 除外)。
// 優先: territorial かつ holding 少ない secondary → territorial 低 rank → titular rank2〜4 → PolityId 昇順。
function selectCadetBranchTransferCandidatePolity(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
): PolityId | undefined {
  const primary = getHousePrimaryPolityId(state, houseId)
  const sink = getHouseDomainConsolidationSinkPolityId(state, config, houseId)
  const cands: { polityId: PolityId; isTitular: boolean; rank: number; holdingCount: number }[] = []
  for (const pid of getHouseOwnedPolityIds(state, houseId)) {
    if (pid === primary || pid === sink) continue
    const p = state.polities[pid]
    if (!p || !p.active) continue
    if (p.kind === 'commonwealth') continue
    if (p.ownerHouseId !== houseId) continue
    const titular = getPolityTerritorialStatus(p) === 'titular'
    if (titular) {
      if (p.rank < 2 || p.rank > 4) continue
    } else {
      if (p.rank < 2 || p.rank > 5) continue
    }
    cands.push({
      polityId: pid,
      isTitular: titular,
      rank: p.rank,
      holdingCount: getPolityHoldingCount(state, pid),
    })
  }
  if (cands.length === 0) return undefined
  cands.sort((a, b) => {
    // territorial を titular より優先。
    if (a.isTitular !== b.isTitular) return a.isTitular ? 1 : -1
    if (!a.isTitular) {
      // territorial: holding 少ない secondary 優先 → rank 低い (数値大)。
      if (a.holdingCount !== b.holdingCount) return a.holdingCount - b.holdingCount
      if (a.rank !== b.rank) return b.rank - a.rank
    } else if (a.rank !== b.rank) {
      return b.rank - a.rank
    }
    return a.polityId.localeCompare(b.polityId)
  })
  return cands[0]?.polityId
}

// HARD gate 全体 (petitioner 資格 + 譲渡対象 Polity) を満たすか。aim 生成と finalize 再検査で共有。
export function resolveCadetBranchTransfer(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): { parentHouseId: HouseId; targetPolityId: PolityId } | undefined {
  const person = state.persons[personId]
  if (!person || person.houseId === undefined) return undefined
  if (!meetsCadetBranchPetitionerGate(state, config, person)) return undefined
  const target = selectCadetBranchTransferCandidatePolity(state, config, person.houseId)
  if (!target) return undefined
  return { parentHouseId: person.houseId, targetPolityId: target }
}

// ───────────────────────────────────────────────────────────────────────────
// v0.47 §13: 共和国 House 創設 (found_republic_house) の selector。
// ───────────────────────────────────────────────────────────────────────────

// §13.3 HARD gate: established commonwealth の active polity office を持つ無家人物が
// 財産を基盤に House を興せるか。成功なら所属 commonwealth polity を返す。
export function resolveRepublicHouseFounding(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): { commonwealthPolityId: PolityId } | undefined {
  const person = state.persons[personId]
  if (!person) return undefined
  if (!person.alive) return undefined
  if (person.kind === 'placeholder') return undefined
  if (person.houseId !== undefined) return undefined // 無家のみ
  if (!isLifeStageAtLeast(person.lifeStage, 'young_adulthood')) return undefined
  if (person.wealth < config.republicHouseFoundingMinWealth) return undefined
  // established commonwealth の active polity office holder を探す。
  for (const oaId of state.officeIndex.byHolderPerson[personId as string] ?? []) {
    const oa = state.officeAssignments[oaId]
    if (!oa || !oa.active || oa.organization.kind !== 'polity') continue
    if (isEstablishedCommonwealthRepublic(state, oa.organization.id)) {
      return { commonwealthPolityId: oa.organization.id }
    }
  }
  return undefined
}
