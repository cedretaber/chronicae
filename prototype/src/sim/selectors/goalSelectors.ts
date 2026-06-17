import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, HouseId, GoalId, ProvinceId, LandContractId } from '../types/ids'
import type { PolityRank } from '../types/polity'
import { canPromotePolityRank } from './petitionSelectors'
import type {
  DecisionSubjectRef,
  GoalKind,
  PolityGoalKind,
  HouseGoalKind,
  AimKind,
  PolityAimKind,
  HouseAimKind,
  Goal,
  Aim,
  EntityRef,
} from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import { politicalRightTargetKey, politicalRightHolderKey } from '../types/politicalRight'
import { isLivingPerson, isLifeStageAtLeast } from '../types/person'
import type { PersonId } from '../types/ids'
import { getRoleScore } from './abilitySelectors'
import { getPersonReputationModifierForCategories } from './personReputationSelectors'
import { hasActiveHoldingOffice, getHouseDecisionMaker, getHouseLeader } from './officeSelectors'
import { isRoleEligibleBySex } from './roleEligibilitySelectors'
import { findAcquirableRightTarget, findRevocableRightTarget } from './politicalRightSelectors'
import { isEstablishedCommonwealthRepublic } from './republicSelectors'
import {
  getPolityTerminalProvinceIds,
  getProvinceHoldings,
  getLandContractGrantor,
} from './landContractSelectors'
import { getHoldingDevelopment } from './holdingImprovementSelectors'
import { calcPolityMilitaryPower } from './militarySelectors'
import { getHouseOwnedPolityIds } from './landContractSelectors'
import { predictPressureResponseStance } from './pressureStanceSelectors'
import { politiesShareOwnerHouse } from './polityRelations'
import { getHouseDomainConsolidationSinkPolityId } from './polityRelations'
import {
  getHouseAggregateInfluenceInPolity,
  getPolityInfluenceBreakdown,
  getActorInfluenceFromBreakdown,
} from './influenceSelectors'
import { computeConspiracyDrive } from './conspiracySelectors'
import { getHousePrimaryPolityId } from './polityRelations'
import type { RngState } from '../rng/rng'
import { randomFloat } from '../rng/rng'

// --- Lookup helpers ---

export function getActiveGoalForOwner(
  state: WorldState,
  owner: DecisionSubjectRef,
): Goal | undefined {
  const key = decisionSubjectKey(owner)
  const goalIds = state.goalIndex.byOwner[key]
  if (!goalIds) return undefined
  for (const gid of goalIds) {
    const goal = state.goals[gid]
    if (goal && goal.status === 'active') return goal
  }
  return undefined
}

// --- Aim slot key (v0.43) ---
// 1 Goal が複数 active Aim を持つとき、「同じ対象に同じ種類の Aim を二重に持たない」ための
// スロット識別キー。生成側 (pickAimForGoal の候補除外) と integrity の重複検査が *同一* の
// キーを共有しなければならない (ズレると「生成した直後に integrity が弾く」状態になる)。
function entityRefKey(ref: EntityRef): string {
  if (ref.kind === 'office') {
    return `office:${ref.organization.kind}:${ref.organization.id}:${ref.role}`
  }
  if (ref.kind === 'political_right_target') {
    return politicalRightTargetKey(ref.target)
  }
  if (ref.kind === 'ability') {
    return `ability:${ref.ability}`
  }
  return `${ref.kind}:${ref.id}`
}

export function aimSlotKey(kind: AimKind, target?: EntityRef): string {
  return target ? `${kind}|${entityRefKey(target)}` : kind
}

// --- Aim capacity (v0.43) ---
// 1 Goal が同時に持てる active Aim 数を、owner (国・家) の規模/予算に連動させて算出する。
// 小国は base のみ、大国・富裕な家ほど枠が増え、静的 ceiling でクランプされる。
// これは「生成側スロットル (動的 cap)」であり integrity の invariant ではない
// (国が縮小して capacity が下がっても、既に作った Aim は ceiling 以下なら合法のまま)。
export function computeAimCapacityForGoal(
  state: WorldState,
  config: SimulationConfig,
  owner: DecisionSubjectRef,
): number {
  let extra = 0
  if (owner.kind === 'polity') {
    const polity = state.polities[owner.id]
    if (polity) {
      const provinceCount = getPolityTerminalProvinceIds(state, owner.id).length
      extra += Math.floor(provinceCount / config.aimCapacityProvincesPerSlot)
      extra += Math.floor(Math.max(0, polity.treasury) / config.aimCapacityTreasuryPerSlot)
    }
  } else if (owner.kind === 'house') {
    const house = state.houses[owner.id]
    if (house) {
      extra += Math.floor(house.memberIds.length / config.aimCapacityMembersPerSlot)
      extra += Math.floor(Math.max(0, house.wealth) / config.aimCapacityWealthPerSlot)
    }
  }
  const capacity = config.aimCapacityBase + extra
  return Math.max(1, Math.min(config.aimParallelismCeiling, capacity))
}

export function getActiveAimsForGoal(state: WorldState, goalId: GoalId): Aim[] {
  const aimIds = state.aimIndex.byGoal[goalId as string]
  if (!aimIds) return []
  const result: Aim[] = []
  for (const aid of aimIds) {
    const aim = state.aims[aid]
    if (aim && aim.status === 'active') result.push(aim)
  }
  return result
}

export function getActiveAimForOwner(
  state: WorldState,
  owner: DecisionSubjectRef,
): Aim | undefined {
  const key = decisionSubjectKey(owner)
  const aimIds = state.aimIndex.byOwner[key]
  if (!aimIds) return undefined
  for (const aid of aimIds) {
    const aim = state.aims[aid]
    if (aim && aim.status === 'active') return aim
  }
  return undefined
}

// --- Polity Goal scoring ---

function scorePolityGoalKind(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
): { kind: PolityGoalKind; score: number }[] {
  const polity = state.polities[polityId]
  if (!polity || !polity.active) return []

  const terminalProvinceIds = getPolityTerminalProvinceIds(state, polityId)
  const ownPower = calcPolityMilitaryPower(state, config, polityId)

  // external_expansion scoring
  let expansionScore = 0
  let hasAcquirableNeighbor = false

  for (const pid of terminalProvinceIds) {
    const province = state.provinces[pid]
    if (!province) continue
    for (const neighborId of province.neighbors) {
      const neighborProvince = state.provinces[neighborId]
      if (!neighborProvince) continue
      // Check if any holding in this neighbor province is held by a different polity
      const holdings = getProvinceHoldings(state, neighborId)
      for (const h of holdings) {
        const terminalPolity = state.holdingTerminalPolityCache[h.id]
        if (terminalPolity && (terminalPolity as string) !== (polityId as string)) {
          hasAcquirableNeighbor = true
          const targetPower = calcPolityMilitaryPower(state, config, terminalPolity)
          if (ownPower > targetPower * 1.1) {
            expansionScore += 15
          }
        }
      }
    }
  }
  if (hasAcquirableNeighbor) expansionScore += 20
  if (polity.treasury > 200) expansionScore += 10

  // internal_development scoring
  let developmentScore = 0
  for (const pid of terminalProvinceIds) {
    const holdings = getProvinceHoldings(state, pid)
    for (const h of holdings) {
      if (
        getHoldingDevelopment(state, config, h.id) < config.developHoldingTargetDevelopmentThreshold
      )
        developmentScore += 10
    }
  }
  if (polity.treasury > 100) developmentScore += 10
  // If no acquirable neighbors, development is more attractive
  if (!hasAcquirableNeighbor) developmentScore += 20

  return [
    { kind: 'external_expansion', score: expansionScore },
    { kind: 'internal_development', score: developmentScore },
  ]
}

// --- House Goal scoring ---

export function scoreHouseGoalKind(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
): { kind: HouseGoalKind; score: number }[] {
  const house = state.houses[houseId]
  if (!house || !house.active || house.kind === 'system') return []

  const ownedPolityIds = getHouseOwnedPolityIds(state, houseId)

  // expand_power_base
  // v0.42 §19.2-4: share% → influence% (0〜100 スケール維持)
  let expandScore = 0
  if (ownedPolityIds.length > 0) expandScore += 15
  for (const pid of ownedPolityIds) {
    const influencePercent = getHouseAggregateInfluenceInPolity(state, config, houseId, pid).percent
    if (influencePercent < 50) expandScore += 10
  }
  if (house.wealth >= 100) expandScore += 10

  // preserve_power_base
  let preserveScore = 0
  for (const pid of ownedPolityIds) {
    const influencePercent = getHouseAggregateInfluenceInPolity(state, config, houseId, pid).percent
    if (influencePercent >= 50) preserveScore += 15
  }
  if (ownedPolityIds.length === 0) preserveScore += 5

  // cultivate_prestige
  let prestigeScore = 0
  if (house.wealth >= 80) prestigeScore += 15
  if (house.legacyPrestige < 30) prestigeScore += 10
  if (ownedPolityIds.length === 0) prestigeScore += 5

  // 影響力個人中心化 Phase 3b: 家の戦略方向に意志決定者 (= 支配 share 保有者) の性格を反映する。
  // 当主でなく実権者の野心/慎重さが家を動かす (個人中心化)。野心→拡大・慎重→保全に傾く。
  // (trait - 0.5) × scale で ±scale/2 の bounded 加算 (構造項 15-35 に対し控えめ)。
  if (config.personAbilityEffectsEnabled) {
    const decisionMakerId = getHouseDecisionMaker(state, houseId)
    const decisionMaker = decisionMakerId ? state.persons[decisionMakerId] : undefined
    if (isLivingPerson(decisionMaker)) {
      const scale = config.houseGoalPersonalityScale
      expandScore += (decisionMaker.traits.ambition - 0.5) * scale
      preserveScore += (decisionMaker.traits.caution - 0.5) * scale
    }
  }

  // v0.47 §12.2: consolidate_domain — 複数 owned polity を持つ家が一円支配を目指す。
  let consolidateScore = 0
  if (ownedPolityIds.length >= config.houseDomainConsolidationMinOwnedPolityCount) {
    consolidateScore = 18 + (ownedPolityIds.length - 1) * 5
  }

  // v0.51 陰謀リファイン: pursue_covert_agenda — 不満家の陰謀傾向 (旧 plotTendency 移植)。
  //   閾値未満 or cooldown 中は 0 (computeConspiracyDrive 内蔵ゲート)。drive≥閾値なら強力な
  //   competitor になり、高 drive の家は陰謀 goal に傾く (旧 plotSystem の goal 非依存トリガー再現)。
  const covertScore = computeConspiracyDrive(state, config, houseId)

  return [
    { kind: 'expand_power_base', score: expandScore },
    { kind: 'preserve_power_base', score: preserveScore },
    { kind: 'cultivate_prestige', score: prestigeScore },
    { kind: 'consolidate_domain', score: consolidateScore },
    { kind: 'pursue_covert_agenda', score: covertScore },
  ]
}

// --- Aim selection ---

// For a given Goal, pick an AimKind and target.
// excludedSlots: 既に同 owner で active な Aim の aimSlotKey 集合。候補から除外して
// 「同じ対象の二重 Aim」を防ぐ (v0.43 Aim 並列化)。空集合なら従来挙動と同一。
export function pickAimForGoal(
  state: WorldState,
  config: SimulationConfig,
  goal: Goal,
  rng: RngState,
  excludedSlots: Set<string> = new Set(),
): { kind: AimKind; target?: EntityRef; rng: RngState } | undefined {
  if (goal.owner.kind === 'polity') {
    return pickPolityAim(
      state,
      config,
      goal.owner.id,
      goal.kind as PolityGoalKind,
      rng,
      state.absoluteWeek,
      excludedSlots,
    )
  }
  if (goal.owner.kind === 'house') {
    return pickHouseAim(
      state,
      config,
      goal.owner.id,
      goal.kind as HouseGoalKind,
      rng,
      excludedSlots,
    )
  }
  return undefined
}

function pickPolityAim(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  goalKind: PolityGoalKind,
  rng: RngState,
  absoluteWeek: number,
  excludedSlots: Set<string>,
): { kind: PolityAimKind; target?: EntityRef; rng: RngState } | undefined {
  const polity = state.polities[polityId]
  if (!polity || !polity.active) return undefined

  const candidates: { kind: PolityAimKind; target?: EntityRef; score: number }[] = []

  if (goalKind === 'external_expansion') {
    const terminalProvinceIds = getPolityTerminalProvinceIds(state, polityId)

    // consolidate_province_holdings: find provinces where we have some holdings but not all
    const checkedForConsolidate = new Set<ProvinceId>()
    for (const pid of terminalProvinceIds) {
      if (checkedForConsolidate.has(pid)) continue
      checkedForConsolidate.add(pid)
      const holdings = getProvinceHoldings(state, pid)
      let ownCount = 0
      let otherCount = 0
      for (const h of holdings) {
        const tp = state.holdingTerminalPolityCache[h.id]
        if (tp && (tp as string) === (polityId as string)) ownCount++
        // v0.45.2: 同家 polity の holding は奪取対象 (other) に数えない (同家戦争防止ゲート)
        else if (tp && politiesShareOwnerHouse(state, polityId, tp)) continue
        // v0.47.3 §6.69: land_claim grace 中の holding は奪取対象に数えない。province の全
        //   claimable holding が保護中なら otherCount=0 で candidate 非 push → aim 自体が立たず
        //   年次 AIM_ABANDONED churn を防ぐ (project レベル skip だけでは二次 churn が残る)。
        else if (h.landClaimProtectedUntilWeek && absoluteWeek < h.landClaimProtectedUntilWeek)
          continue
        else otherCount++
      }
      if (ownCount > 0 && otherCount > 0) {
        candidates.push({
          kind: 'consolidate_province_holdings',
          target: { kind: 'province', id: pid },
          score: 30 + ownCount * 10,
        })
      }
    }

    // seize_weak_remote_holdings: find weak polity holdings in neighboring provinces
    const ownPower = calcPolityMilitaryPower(state, config, polityId)
    for (const pid of terminalProvinceIds) {
      const province = state.provinces[pid]
      if (!province) continue
      for (const neighborId of province.neighbors) {
        const holdings = getProvinceHoldings(state, neighborId)
        for (const h of holdings) {
          const tp = state.holdingTerminalPolityCache[h.id]
          if (!tp || (tp as string) === (polityId as string)) continue
          // v0.45.2: 同家 polity は奪取対象にしない (同家戦争防止ゲート)
          if (politiesShareOwnerHouse(state, polityId, tp)) continue
          // v0.47.3 §6.69: land_claim grace 中の holding は奪取対象にしない (churn 抑制)
          if (h.landClaimProtectedUntilWeek && absoluteWeek < h.landClaimProtectedUntilWeek)
            continue
          const targetPower = calcPolityMilitaryPower(state, config, tp)
          if (ownPower > targetPower * 1.25) {
            candidates.push({
              kind: 'seize_weak_remote_holdings',
              target: { kind: 'province', id: neighborId },
              score: 20 + (ownPower - targetPower * 1.25) * 0.1,
            })
          }
        }
      }
    }
  }

  // tax revision aims: available under both external_expansion and internal_development
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []

  // 開始ゲート: 減税系 aim (vassal → grantor) は、grantor (宗主) が resist 確実なら
  // 起こしても status_quo に終わるだけ。行動を起こす前に弾き、actor が無謀な減税要求を
  // 量産して「外交劇は起こすが何も変わらない」を連発するのを防ぐ。
  // 受諾見込みの予測は play 開始ゲート (diplomaticPlayCreation) / defender の実 stance 決定と
  // 同一式 (predictPressureResponseStance) を共有する。
  const grantorWouldResist = (cid: LandContractId): boolean => {
    const grantor = getLandContractGrantor(state, cid)
    if (!grantor || grantor.kind !== 'polity') return false
    return (
      predictPressureResponseStance(
        state,
        config,
        { kind: 'polity', id: polityId },
        { kind: 'polity', id: grantor.id },
      ) === 'resist'
    )
  }

  // v0.45.2 同家戦争防止ゲート: grantor (宗主) が自分と同じ支配家の polity なら、
  // 税改定系 aim を起こさない (家が自分自身に要求する不自然 + 同家 play/war の源泉)。
  const grantorIsSameHouse = (cid: LandContractId): boolean => {
    const grantor = getLandContractGrantor(state, cid)
    if (!grantor || grantor.kind !== 'polity') return false
    return politiesShareOwnerHouse(state, polityId, grantor.id)
  }

  for (const cid of contractIds) {
    const contract = state.landContracts[cid]
    if (!contract) continue
    if (contract.termsProtectedUntilWeek && absoluteWeek < contract.termsProtectedUntilWeek)
      continue
    if (grantorIsSameHouse(contract.id)) continue
    if (grantorWouldResist(contract.id)) continue
    if (contract.terms.taxRateToGrantor > 0.2) {
      candidates.push({
        kind: 'improve_owned_contract_terms',
        target: contract.holdingId
          ? { kind: 'holding', id: contract.holdingId }
          : { kind: 'province', id: contract.provinceId },
        score: 15 + contract.terms.taxRateToGrantor * 50,
      })
    }
  }
  // eliminate_overlord_contract: tax rate already at/near minimum → push for contract removal
  for (const cid of contractIds) {
    const contract = state.landContracts[cid]
    if (!contract || contract.rootAuthorityId) continue
    if (contract.termsProtectedUntilWeek && absoluteWeek < contract.termsProtectedUntilWeek)
      continue
    // §6.69: この aim は「直上 overlord 契約 (= 自契約の親) を除去して grandparent に再接続する」。
    //   親契約が無い / 親が root (overlord が主権者) の場合、除去対象が存在せず、勝利しても
    //   applyTaxGoal が no-op (white_peace) になり、同一 holding への解除戦争が無限再発する。
    //   除去可能な中間 overlord がある場合 (親が非 root) のみ候補化する。
    const parentId = contract.parentContractId
    const parentContract = parentId !== undefined ? state.landContracts[parentId] : undefined
    if (!parentContract || parentContract.rootAuthorityId) continue
    if (grantorIsSameHouse(contract.id)) continue
    if (grantorWouldResist(contract.id)) continue
    if (contract.terms.taxRateToGrantor <= config.taxRevisionMinRateForReduction) {
      candidates.push({
        kind: 'eliminate_overlord_contract',
        target: contract.holdingId
          ? { kind: 'holding', id: contract.holdingId }
          : { kind: 'province', id: contract.provinceId },
        score: 40 + (config.taxRevisionMinRateForReduction - contract.terms.taxRateToGrantor) * 200,
      })
    }
  }

  for (const cid of contractIds) {
    const contract = state.landContracts[cid]
    if (!contract) continue
    const childContractId = state.landContractIndex.byParent[contract.id]
    if (childContractId === undefined) continue
    const child = state.landContracts[childContractId]
    if (!child) continue
    if (child.termsProtectedUntilWeek && absoluteWeek < child.termsProtectedUntilWeek) continue
    const vassalPolity = state.polities[child.granteePolityId]
    if (!vassalPolity || !vassalPolity.active) continue
    // v0.45.2 同家戦争防止ゲート: 同じ支配家の臣下 polity には増税系 aim を起こさない
    if (politiesShareOwnerHouse(state, polityId, child.granteePolityId)) continue
    if (child.terms.taxRateToGrantor >= config.taxRevisionMaxRateForIncrease) {
      // eliminate_vassal_contract: tax rate already at/near maximum → push for contract removal
      candidates.push({
        kind: 'eliminate_vassal_contract',
        target: child.holdingId
          ? { kind: 'holding', id: child.holdingId }
          : { kind: 'province', id: child.provinceId },
        score: 40 + (child.terms.taxRateToGrantor - config.taxRevisionMaxRateForIncrease) * 200,
      })
    } else {
      candidates.push({
        kind: 'demand_tax_increase_from_vassal',
        target: child.holdingId
          ? { kind: 'holding', id: child.holdingId }
          : { kind: 'province', id: child.provinceId },
        score: 15 + (config.taxRevisionMaxRateForIncrease - child.terms.taxRateToGrantor) * 50,
      })
    }
  }

  if (goalKind !== 'external_expansion') {
    // internal_development
    // develop_owned_holding
    const terminalProvinceIds = getPolityTerminalProvinceIds(state, polityId)
    for (const pid of terminalProvinceIds) {
      const holdings = getProvinceHoldings(state, pid)
      for (const h of holdings) {
        const tp = state.holdingTerminalPolityCache[h.id]
        if (!tp || (tp as string) !== (polityId as string)) continue
        const holdingDev = getHoldingDevelopment(state, config, h.id)
        if (holdingDev < config.developHoldingTargetDevelopmentThreshold) {
          candidates.push({
            kind: 'develop_owned_holding',
            target: { kind: 'holding', id: h.id },
            score:
              20 +
              (config.developHoldingTargetDevelopmentThreshold - holdingDev) * 0.5 +
              h.landQuality * 0.3,
          })
        }
      }
    }
  }

  // v0.47 §5: seek_rank_promotion — 1 段上の rank へ陞爵可能なら候補に (goal 種別に依らない)。
  if (polity.rank >= 3) {
    const newRank = (polity.rank - 1) as PolityRank
    if (canPromotePolityRank(state, config, polityId, newRank)) {
      candidates.push({
        kind: 'seek_rank_promotion',
        target: { kind: 'polity', id: polityId },
        score: 35,
      })
    }
  }

  // 既に同 owner で active な Aim が占めるスロットを除外 (v0.43)
  const available =
    excludedSlots.size === 0
      ? candidates
      : candidates.filter((c) => !excludedSlots.has(aimSlotKey(c.kind, c.target)))
  if (available.length === 0) return undefined

  // Sort by score descending, pick top with some randomness
  available.sort((a, b) => b.score - a.score)
  // Pick from top 3 with weighted random
  const topN = available.slice(0, 3)
  const totalScore = topN.reduce((sum, c) => sum + Math.max(1, c.score), 0)
  const { value: roll, rng: nextRng } = randomFloat(rng)
  let cumulative = 0
  for (const c of topN) {
    cumulative += Math.max(1, c.score) / totalScore
    if (roll < cumulative) {
      return { kind: c.kind, ...(c.target !== undefined ? { target: c.target } : {}), rng: nextRng }
    }
  }
  // Fallback to first
  const first = topN[0]!
  return {
    kind: first.kind,
    ...(first.target !== undefined ? { target: first.target } : {}),
    rng: nextRng,
  }
}

// v0.42 acquire 開放: 家が influence を持ちうる polity の候補集合 (acquire_political_right 用)。
// 正しさの条件は「influence% ≥ 下限ゲートになりうる全 polity を包含する」こと
// (過剰包含は influence ゲートが落とすので無害、過少包含は silent miss)。
// influence breakdown (getPolityInfluenceBreakdown) が家を entry に導入する source と対応させる:
//   ① owner + 土地 chain (getPolityHouseIds) → owned polity + その宗主チェーン全段
//   ②③ ruler/leader・office holder → 生存 member が polity office を持つ polity
//   ④ right holder → 既保有 right の polity (house key のみ — person-held right は本番生成経路が
//      存在しない。将来 person-held を導入したら member の person key も引くこと)
//   ⑤ 現職 bailiff の家 → 生存 member が holding office を持つ holding の terminal polity
//   ⑥ anchor faction leader の家 → 生存 member が leader である active Faction の anchor polity
// 弱体 polity 1 つを多数の家が見る場合 breakdown が家数ぶん再計算されるが年次 cadence で許容
// (pass 単位 breakdown キャッシュは future work)。
// 影響力個人中心化 Phase 2 役職適格ゲート (R3/R18): person が polity で何らかの office 候補に
// なりうるか。= 生存・young_adulthood 以上・非 placeholder・bailiff でない (HoldingOffice なし)・
// 性別適格 (isRoleEligibleBySex)・所属家が active で polity に foothold を持つ
// (collectAcquireRightCandidatePolityIds メンバーシップ)。appointment 候補プールの基本条件を
// 集約した近似述語 (role ごとの厳密判定でなく「どれかの role に乗りうるか」)。
export function isPolityRoleEligibleCandidate(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  polityId: PolityId,
): boolean {
  const person = state.persons[personId]
  if (!isLivingPerson(person)) return false
  if (!isLifeStageAtLeast(person.lifeStage, 'young_adulthood')) return false
  if (hasActiveHoldingOffice(state, personId)) return false
  if (!isRoleEligibleBySex(state, config, personId)) return false
  if (person.houseId === undefined) return false
  const house = state.houses[person.houseId]
  if (!house || !house.active) return false
  const footholds = collectAcquireRightCandidatePolityIds(
    state,
    person.houseId,
    getHouseOwnedPolityIds(state, person.houseId),
  )
  return footholds.includes(polityId)
}

// 影響力個人中心化 Phase 1b/2: 運動の受益者 (推薦する家メンバー) を決定的に選ぶ。
// houseId の役職適格 (isPolityRoleEligibleCandidate) メンバーから governance + general 評判 を
// 線形スコアにした argmax (ID 昇順 tiebreak)。RNG を使わない (supervisor auto 選定を bypass
// する以上、選定にも非決定を持ち込まない — 決定性確保)。適格メンバーが居なければ undefined。
export function selectMovementBeneficiary(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
  polityId: PolityId,
): PersonId | undefined {
  const house = state.houses[houseId]
  if (!house || !house.active) return undefined
  let best: { id: PersonId; score: number } | undefined
  for (const personId of [...house.memberIds].sort()) {
    if (!isPolityRoleEligibleCandidate(state, config, personId, polityId)) continue
    const score =
      getRoleScore(state, personId, 'governance') +
      getPersonReputationModifierForCategories(state, config, personId, ['general']) * 0.5
    if (!best || score > best.score) best = { id: personId, score }
  }
  return best?.id
}

export function collectAcquireRightCandidatePolityIds(
  state: WorldState,
  houseId: HouseId,
  ownedPolityIds: PolityId[],
): PolityId[] {
  const candidateIds = new Set<PolityId>()
  const addIfActive = (pid: PolityId | undefined): void => {
    if (pid === undefined) return
    const polity = state.polities[pid]
    if (polity && polity.active) candidateIds.add(pid)
  }

  // ① owned + 宗主チェーン全段 (contract の parentContractId を上に辿る。
  //    直接宗主のみだと多段封建で取りこぼす)
  const visitedContracts = new Set<string>()
  for (const pid of ownedPolityIds) {
    addIfActive(pid)
    for (const cid of state.landContractIndex.byGranteePolity[pid] ?? []) {
      let current = state.landContracts[cid]
      while (current && current.parentContractId !== undefined) {
        if (visitedContracts.has(current.parentContractId)) break
        visitedContracts.add(current.parentContractId)
        const parent = state.landContracts[current.parentContractId]
        if (!parent) break
        addIfActive(parent.granteePolityId)
        current = parent
      }
    }
  }

  // ②③⑤⑥ 生存 member の役職・派閥 leader を 1 ループで
  const house = state.houses[houseId]
  for (const personId of house?.memberIds ?? []) {
    if (!isLivingPerson(state.persons[personId])) continue
    for (const oid of state.officeIndex.byHolderPerson[personId as string] ?? []) {
      const office = state.officeAssignments[oid]
      if (office && office.active && office.organization.kind === 'polity') {
        addIfActive(office.organization.id)
      }
    }
    for (const hid of state.holdingOfficeIndex.byHolderPerson[personId] ?? []) {
      const holdingOffice = state.holdingOfficeAssignments[hid]
      if (holdingOffice && holdingOffice.active) {
        addIfActive(state.holdingTerminalPolityCache[holdingOffice.holdingId])
      }
    }
    for (const fid of state.factionIndex.byLeader[personId] ?? []) {
      const faction = state.factions[fid]
      // byLeader は inactive faction も保持する — active filter 必須
      if (faction && faction.active) addIfActive(faction.polityId)
    }
  }

  // ④ 既保有 right の polity (ownerHouse 交代後の遺産 right ケース)
  const holderKey = politicalRightHolderKey({ kind: 'house', id: houseId })
  for (const rid of state.politicalRightIndex.byHolder[holderKey] ?? []) {
    const right = state.politicalRights[rid]
    if (right) addIfActive(right.polityId)
  }

  // 決定的順序で返す
  return [...candidateIds].sort((a, b) => a.localeCompare(b))
}

function pickHouseAim(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
  goalKind: HouseGoalKind,
  rng: RngState,
  excludedSlots: Set<string>,
): { kind: HouseAimKind; target?: EntityRef; rng: RngState } | undefined {
  const house = state.houses[houseId]
  if (!house || !house.active) return undefined

  const ownedPolityIds = getHouseOwnedPolityIds(state, houseId)

  const candidates: { kind: HouseAimKind; target?: EntityRef; score: number }[] = []

  // v0.42 §19.2-4: share% → influence% (0〜100 スケール維持)。polity ごとに 1 回だけ計算。
  const influencePctOf = new Map<string, number>()
  for (const pid of ownedPolityIds) {
    influencePctOf.set(pid, getHouseAggregateInfluenceInPolity(state, config, houseId, pid).percent)
  }
  // v0.42 §13.3: acquire_political_right の候補生成 (influence ゲートは Aim 生成条件)。
  // 対象 = 家が influence を持ちうる polity (owned に限らない — 非 owner 開放) のうち
  // 下限 ≤ influence% < 上限 の帯に入るもの。上限ゲートは「既に掌握済みの polity の権利を
  // 買い続ける」不自然の排除 (right なし任命は influence ベースなので掌握済みなら不要)。
  // target は kind 優先度 (office > holding > regiment) で 1 件選定。aimSlotKey に
  // politicalRightTargetKey が含まれるため同一 target への重複 aim は生成されない。
  function pushAcquireRightCandidates(): void {
    const lower = config.acquirePoliticalRightRequiredInfluencePercent
    const upper = config.acquirePoliticalRightMaxInfluencePercent
    for (const pid of collectAcquireRightCandidatePolityIds(state, houseId, ownedPolityIds)) {
      // 追加 polity の influence は lazily 計算して共有 Map に足す (steer_* は
      // ownedPolityIds しか読まないため挙動に影響しない)
      let influencePercent = influencePctOf.get(pid)
      if (influencePercent === undefined) {
        influencePercent = getHouseAggregateInfluenceInPolity(state, config, houseId, pid).percent
        influencePctOf.set(pid, influencePercent)
      }
      if (influencePercent < lower || influencePercent >= upper) continue
      const rightTarget = findAcquirableRightTarget(state, config, houseId, pid)
      if (!rightTarget) continue
      // v0.46 §5.4: established commonwealth 共和国の権利取得を加点し、共和国内部の
      //   政治競争 (家による右取得) を促す (normal polity は不変)。
      const republicBonus = isEstablishedCommonwealthRepublic(state, pid)
        ? config.republicAcquireRightBaseBonus
        : 0
      candidates.push({
        kind: 'acquire_political_right',
        target: { kind: 'political_right_target', target: rightTarget },
        score: 20 + influencePercent * 0.2 + republicBonus,
      })
    }
  }

  if (goalKind === 'expand_power_base') {
    // v0.42 §13.1: increase_polity_share は廃止 (influence は read-model — 直接増やす対象でない)。
    // 代わりに具体的な権利を取得する。
    pushAcquireRightCandidates()
    // steer_polity_external_expansion
    for (const pid of ownedPolityIds) {
      const influencePercent = influencePctOf.get(pid) ?? 0
      if (influencePercent >= 20) {
        candidates.push({
          kind: 'steer_polity_external_expansion',
          target: { kind: 'polity', id: pid },
          score: 15 + influencePercent * 0.3,
        })
      }
    }
    // 影響力個人中心化 Phase 1b/2: 運動 (家が資金で member を国に推薦して influence を積む)。
    // 家が foothold を持つ polity (collectAcquireRightCandidatePolityIds) のうち、まだ掌握して
    // いない (influence% < 上限) もので、その polity の役職適格 member が居れば候補を立てる。
    if (house.wealth >= config.movementProjectBaseCost) {
      const upper = config.acquirePoliticalRightMaxInfluencePercent
      for (const pid of collectAcquireRightCandidatePolityIds(state, houseId, ownedPolityIds)) {
        let influencePercent = influencePctOf.get(pid)
        if (influencePercent === undefined) {
          influencePercent = getHouseAggregateInfluenceInPolity(state, config, houseId, pid).percent
          influencePctOf.set(pid, influencePercent)
        }
        if (influencePercent >= upper) continue
        if (selectMovementBeneficiary(state, config, houseId, pid) === undefined) continue
        candidates.push({
          kind: 'start_movement_campaign',
          target: { kind: 'polity', id: pid },
          score: 18,
        })
      }
    }
  } else if (goalKind === 'preserve_power_base') {
    pushAcquireRightCandidates()
    // steer_polity_internal_development
    for (const pid of ownedPolityIds) {
      const influencePercent = influencePctOf.get(pid) ?? 0
      if (influencePercent >= 20) {
        candidates.push({
          kind: 'steer_polity_internal_development',
          target: { kind: 'polity', id: pid },
          score: 20 + influencePercent * 0.3,
        })
      }
    }
  } else if (goalKind === 'consolidate_domain') {
    // v0.47 §12.3: consolidate_owned_polities — sink Polity が存在し集約余地があれば候補に。
    const sink = getHouseDomainConsolidationSinkPolityId(state, config, houseId)
    if (sink && ownedPolityIds.length >= config.houseDomainConsolidationMinOwnedPolityCount) {
      candidates.push({
        kind: 'consolidate_owned_polities',
        target: { kind: 'polity', id: sink },
        score: 25,
      })
    }
  } else if (goalKind === 'pursue_covert_agenda') {
    // v0.51 陰謀リファイン: covert goal 配下の陰謀 aim 候補。drive ゲート (閾値・cooldown) を再確認し、
    //   妥当な target を持つ陰謀のみ候補化する (旧「空回り排除」原則)。
    //   undermine: 自家の primary polity の breakdown から「自家以外」の rival (家/人物) を対象に。
    const drive = computeConspiracyDrive(state, config, houseId)
    if (drive > 0) {
      const polityId = getHousePrimaryPolityId(state, houseId)
      if (polityId) {
        const memberSet = new Set<string>(house.memberIds.map((id) => id as string))
        const breakdown = getPolityInfluenceBreakdown(state, config, polityId)
        for (const entry of breakdown.entries) {
          if (entry.total <= 0) continue
          // 自家・自家メンバーは対象外
          if (entry.holder.kind === 'house') {
            if (entry.holder.id === houseId) continue
          } else if (memberSet.has(entry.holder.id)) {
            continue
          }
          const target: EntityRef =
            entry.holder.kind === 'house'
              ? { kind: 'house', id: entry.holder.id }
              : { kind: 'person', id: entry.holder.id }
          candidates.push({
            kind: 'undermine_rival_influence',
            target,
            // priorityFactor で多発抑制 (covert goal 内では相対順位不変だが、将来 conspiracy aim を
            //   他 goal と共存させたときの実配線。設計書 §4.2)。
            score: (20 + entry.percent * 0.3) * config.conspiracyAimPriorityFactor,
          })
        }

        // revoke: 同 Polity に自家以外の holder が持つ active right があれば候補化 (§3.3)。
        //   findRevocableRightTarget が person holder 優先で 1 件返す (空回り排除)。
        const revokeTarget = findRevocableRightTarget(state, houseId, polityId)
        if (revokeTarget) {
          candidates.push({
            kind: 'revoke_rival_right',
            target: { kind: 'political_right_target', target: revokeTarget },
            score: 22 * config.conspiracyAimPriorityFactor,
          })
        }
      }

      // intervene_cadet_succession: 自家の分家 (生存当主を持つ) を対象に当主交代を狙う (§3.4)。
      //   polityId に依らない王朝統制。旧 pickCadetTarget の候補化を移植 (cadetHouseIds 昇順)。
      for (const cadetId of [...house.cadetHouseIds].sort()) {
        const cadet = state.houses[cadetId]
        if (!cadet || !cadet.active || cadet.kind === 'system') continue
        const cadetHeadId = getHouseLeader(state, cadetId)
        if (!cadetHeadId) continue
        const cadetHead = state.persons[cadetHeadId]
        if (!cadetHead || !cadetHead.alive) continue
        candidates.push({
          kind: 'intervene_cadet_succession',
          target: { kind: 'house', id: cadetId },
          score: 24 * config.conspiracyAimPriorityFactor,
        })
      }
    }
  } else {
    // cultivate_prestige
    if (house.wealth >= 25) {
      candidates.push({ kind: 'patronize_artist', score: 20 })
    }
    if (house.wealth >= 40) {
      candidates.push({ kind: 'commission_chronicle', score: 25 })
    }
  }

  // 既に同 owner で active な Aim が占めるスロットを除外 (v0.43)
  const available =
    excludedSlots.size === 0
      ? candidates
      : candidates.filter((c) => !excludedSlots.has(aimSlotKey(c.kind, c.target)))
  if (available.length === 0) return undefined

  available.sort((a, b) => b.score - a.score)
  const topN = available.slice(0, 3)
  const totalScore = topN.reduce((sum, c) => sum + Math.max(1, c.score), 0)
  const { value: roll, rng: nextRng } = randomFloat(rng)
  let cumulative = 0
  for (const c of topN) {
    cumulative += Math.max(1, c.score) / totalScore
    if (roll < cumulative) {
      return { kind: c.kind, ...(c.target !== undefined ? { target: c.target } : {}), rng: nextRng }
    }
  }
  const first = topN[0]!
  return {
    kind: first.kind,
    ...(first.target !== undefined ? { target: first.target } : {}),
    rng: nextRng,
  }
}

// --- Goal selection (pick the best GoalKind for an owner) ---

export function selectGoalKind(
  state: WorldState,
  config: SimulationConfig,
  owner: DecisionSubjectRef,
  rng: RngState,
): { kind: GoalKind; rng: RngState } | undefined {
  let scores: { kind: GoalKind; score: number }[] = []

  if (owner.kind === 'polity') {
    scores = scorePolityGoalKind(state, config, owner.id)
  } else if (owner.kind === 'house') {
    scores = scoreHouseGoalKind(state, config, owner.id)
  }

  if (scores.length === 0) return undefined

  // Apply House steer_polity_* influence bonus if owner is a polity
  if (owner.kind === 'polity') {
    scores = applyPolicyInfluenceBonus(state, config, owner.id, scores)
  }

  scores.sort((a, b) => b.score - a.score)

  // Weighted random from top candidates
  const totalScore = scores.reduce((sum, s) => sum + Math.max(1, s.score), 0)
  const { value: roll, rng: nextRng } = randomFloat(rng)
  let cumulative = 0
  for (const s of scores) {
    cumulative += Math.max(1, s.score) / totalScore
    if (roll < cumulative) {
      return { kind: s.kind, rng: nextRng }
    }
  }
  const first = scores[0]
  if (!first) return undefined
  return { kind: first.kind, rng: nextRng }
}

// Apply policyInfluenceBonus from active House steer_polity_* Aims (§16.2)
function applyPolicyInfluenceBonus(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  scores: { kind: GoalKind; score: number }[],
): { kind: GoalKind; score: number }[] {
  const result = scores.map((s) => ({ ...s }))

  // v0.42 §19.2-4: share% → influence%。polity 固定なので breakdown は 1 回だけ計算 (§21.2)
  const breakdown = getPolityInfluenceBreakdown(state, config, polityId)

  // Scan all active Aims owned by houses
  for (const [, aim] of Object.entries(state.aims)) {
    if (!aim || aim.status !== 'active') continue
    if (aim.owner.kind !== 'house') continue
    // Check if Aim targets this polity
    if (!aim.target || aim.target.kind !== 'polity') continue
    if ((aim.target.id as string) !== (polityId as string)) continue

    const houseId = aim.owner.id
    const influencePercent = getActorInfluenceFromBreakdown(breakdown, {
      kind: 'house',
      id: houseId,
    }).percent

    const bonus =
      config.policyInfluenceBonusBase + influencePercent * config.policyInfluenceBonusShareFactor

    if (aim.kind === 'steer_polity_external_expansion') {
      const entry = result.find((s) => s.kind === 'external_expansion')
      if (entry) entry.score += bonus
    } else if (aim.kind === 'steer_polity_internal_development') {
      const entry = result.find((s) => s.kind === 'internal_development')
      if (entry) entry.score += bonus
    }
  }

  return result
}
