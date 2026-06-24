import { clamp } from '@sim/utils/math'
import type { WorldState } from '@sim/types/world'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { PolityId, HouseId, PersonId } from '@sim/types/ids'
import type {
  OrganizationRef,
  OfficeAssignment,
  OfficeRole,
  OrganizationKind,
} from '@sim/types/office'
import { OFFICE_DEFINITIONS } from '@sim/config/officeDefinitions'
import { getPersonHouseSharePercent, getHouseShares } from '@sim/selectors/shareSelectors'
import { isLivingPerson } from '@sim/types/person'
import { getPolityTerritorialStatus } from '@sim/types/polity'
import { attitudeValueToScore, getAttitudeOrDefault } from '@sim/helpers/attitudeHelpers'
import { weightedAverage } from '@sim/selectors/statusSelectors'
import { getRoleScore, abilityOutputFactor } from '@sim/selectors/abilitySelectors'
import { getPolityTerminalProvinceIds } from '@sim/selectors/landContractSelectors'
import { organizationKey } from '@sim/selectors/organizationSelectors'
import { entityRef } from '@sim/types/event'
import type { EventEntityRef } from '@sim/types/event'

// organization (polity / house) の office 任期年数をテーブルから引く。
// 第三の組織種を OrganizationKind に足すと officeTermYears の型 (kind 名キー) で
// 欠落が compile error として表面化する。leader は呼び出し側で除外済み (任期なし)。
export function getOrganizationTermYears(
  config: SimulationConfig,
  org: OrganizationRef,
  role: Exclude<OfficeRole, 'leader'>,
): number {
  return config.officeTermYears[org.kind][role]
}

// office 関連イベントに付与する organization の entityRef を返す。
// 現挙動を保存: polity は organization ref を 1 つ、house は付けない (省略) — v0.x の
// event 形を維持する。merchant 等の組織種を足す際は、ここが entityRef 方針を決める
// 唯一の判断点になる (switch 網羅で対応漏れが compile error 化する)。
export function getOrganizationOfficeEntityRefs(org: OrganizationRef): EventEntityRef[] {
  switch (org.kind) {
    case 'polity':
      return [entityRef('polity', org.id, 'organization')]
    case 'house':
      return []
    case 'merchant_company':
      return [entityRef('merchant_company', org.id, 'organization')]
    default: {
      const _exhaustive: never = org
      throw new Error(
        `getOrganizationOfficeEntityRefs: unexpected organization ${String(_exhaustive)}`,
      )
    }
  }
}

export function getOfficeAssignments(
  state: WorldState,
  organization: OrganizationRef,
): OfficeAssignment[] {
  const key = organizationKey(organization)
  const ids = state.officeIndex.byOrganization[key] ?? []
  return ids.flatMap((id) => {
    const office = state.officeAssignments[id]
    return office ? [office] : []
  })
}

export function getActiveOfficeHolders(
  state: WorldState,
  organization: OrganizationRef,
  role: OfficeRole,
): PersonId[] {
  return getOfficeAssignments(state, organization)
    .filter((o) => o.active && o.role === role)
    .map((o) => o.holderPersonId)
}

export function getPrimaryOfficeHolder(
  state: WorldState,
  organization: OrganizationRef,
  role: OfficeRole,
): PersonId | undefined {
  const assignments = getOfficeAssignments(state, organization).filter(
    (o) => o.active && o.role === role,
  )
  if (assignments.length === 0) return undefined
  if (assignments.length === 1) return assignments[0]?.holderPersonId

  let bestId: PersonId | undefined
  let bestPower = -Infinity
  for (const office of assignments) {
    const power = getOfficeHolderPower(state, office)
    if (power > bestPower) {
      bestPower = power
      bestId = office.holderPersonId
    }
  }
  return bestId
}

export function getPolityLeader(state: WorldState, countryId: PolityId): PersonId | undefined {
  return getPrimaryOfficeHolder(state, { kind: 'polity', id: countryId }, 'leader')
}

export function getPolityLeaderHouse(state: WorldState, countryId: PolityId): HouseId | undefined {
  const rulerId = getPolityLeader(state, countryId)
  if (!rulerId) return undefined
  const ruler = state.persons[rulerId]
  if (!ruler) return undefined
  return ruler.houseId
}

export function getHouseLeader(state: WorldState, houseId: HouseId): PersonId | undefined {
  return getPrimaryOfficeHolder(state, { kind: 'house', id: houseId }, 'leader')
}

// 影響力個人中心化 Phase 3a: 家アクターの「意志決定者」。
// 支配 share 保有者 = max HouseShare.rawPower の生存 holder (同点は holderPersonId 昇順で安定)。
// share が無ければ getHouseLeader (当主) fallback。当主も不在なら undefined。
// 「当主 ≠ 決定者」を分離する設計 (当主は制度上の代表・決定者は実権者)。
// **執行/意志決定文脈の置換専用** — 構造的用途 (succession/integrity/estate/mortality/
// officeSelectors ruler/worldgen) は getHouseLeader を据え置く (実際の当主が必要)。
export function getHouseDecisionMaker(state: WorldState, houseId: HouseId): PersonId | undefined {
  const shares = getHouseShares(state, houseId)
    .filter((s) => isLivingPerson(state.persons[s.holderPersonId]))
    .sort((a, b) => a.holderPersonId.localeCompare(b.holderPersonId))
  let best: { id: PersonId; power: number } | undefined
  for (const share of shares) {
    if (!best || share.rawPower > best.power) {
      best = { id: share.holderPersonId, power: share.rawPower }
    }
  }
  if (best) return best.id
  return getHouseLeader(state, houseId)
}

/** person が active な (polity/house) OfficeAssignment を 1 つ以上保持するか (調査 §3.6)。 */
export function hasActiveOffice(state: WorldState, personId: PersonId): boolean {
  const ids = state.officeIndex.byHolderPerson[personId as string] ?? []
  for (const id of ids) {
    const o = state.officeAssignments[id]
    if (o && o.active) return true
  }
  return false
}

/** person が active な HoldingOfficeAssignment (代官など) を 1 つ以上保持するか (調査 §3.6)。 */
export function hasActiveHoldingOffice(state: WorldState, personId: PersonId): boolean {
  const ids = state.holdingOfficeIndex.byHolderPerson[personId] ?? []
  for (const id of ids) {
    const a = state.holdingOfficeAssignments[id]
    if (a && a.active) return true
  }
  return false
}

function getOfficeHolderPower(state: WorldState, office: OfficeAssignment): number {
  const person = state.persons[office.holderPersonId]
  if (!person) return 0.01

  const org = office.organization

  switch (org.kind) {
    case 'polity': {
      const countryId = org.id
      const houseId = person.houseId
      if (!houseId) return 0
      const country = state.polities[countryId]

      // v0.42 §19.2-1: 旧 houseSharePct 項 (×0.6) は polity share 廃止に伴い除去した。
      // 本関数は同一 role 複数 holder の tie-break にのみ使われ (getPrimaryOfficeHolder)、
      // config 非供給経路 (getPolityLeader など) から呼ばれるため influence 換算はできない
      // (influenceSelectors への runtime import は循環依存になる)。tie-break は
      // personShare / prestige / respect / tenure で引き続き決定的に機能する。
      const personSharePct = getPersonHouseSharePercent(state, houseId, person.id)
      const prestige = person.legacyPrestige

      // v0.15: 旧 v0.14 では getPolityLeader (= polity:leader Office holder) を ruler 参照に使っていた。
      // getPrimaryOfficeHolder が同じ Office について getOfficeHolderPower を再帰呼びするため、
      // 同 Polity に複数 polity:leader Office が一時的に並存すると無限再帰する。
      // v0.15 では Polity.ownerHouseId → その House の leader を ruler proxy とし、再帰を切る。
      let rulerRespectScore = 0
      const ownerHouseId = country?.ownerHouseId
      const rulerId = ownerHouseId ? getHouseLeader(state, ownerHouseId) : undefined
      if (rulerId && rulerId !== office.holderPersonId) {
        const ruler = state.persons[rulerId]
        if (ruler) {
          const att = getAttitudeOrDefault(state, person, { kind: 'person', id: rulerId })
          rulerRespectScore = attitudeValueToScore(att.respect) / 100
        }
      }

      let orgRespectScore = 0
      if (country) {
        const att = getAttitudeOrDefault(state, person, { kind: 'polity', id: countryId })
        orgRespectScore = attitudeValueToScore(att.respect) / 100
      }

      const tenure = clamp((state.currentYear - office.startYear) * 0.01, 0, 0.1)

      const power =
        1 +
        (personSharePct / 100) * 0.25 +
        (prestige / 100) * 0.1 +
        rulerRespectScore * 0.1 +
        orgRespectScore * 0.1 +
        tenure

      return clamp(power, 0.01, Infinity)
    }
    case 'house': {
      const houseId = org.id
      const house = state.houses[houseId]

      const personSharePct = getPersonHouseSharePercent(state, houseId, person.id)
      const prestige = person.legacyPrestige

      let leaderRespectScore = 0
      const leaderId = getHouseLeader(state, houseId)
      if (leaderId && leaderId !== office.holderPersonId) {
        const leader = state.persons[leaderId]
        if (leader) {
          const att = getAttitudeOrDefault(state, person, { kind: 'person', id: leaderId })
          leaderRespectScore = attitudeValueToScore(att.respect) / 100
        }
      }

      let orgRespectScore = 0
      if (house) {
        const att = getAttitudeOrDefault(state, person, { kind: 'house', id: houseId })
        orgRespectScore = attitudeValueToScore(att.respect) / 100
      }

      const tenure = clamp((state.currentYear - office.startYear) * 0.01, 0, 0.1)

      const power =
        1 +
        (personSharePct / 100) * 0.7 +
        (prestige / 100) * 0.15 +
        leaderRespectScore * 0.1 +
        orgRespectScore * 0.1 +
        tenure

      return clamp(power, 0.01, Infinity)
    }
    case 'merchant_company': {
      // v0.61: 会長/番頭とも maxHolders=1 なので getPrimaryOfficeHolder が早期 return し
      //   本関数は実際には到達しないが、exhaustive のため house に倣った決定的 power を返す。
      //   share rawPower 比率 + prestige + tenure (org respect は v0.61 では未計上)。
      const companyId = org.id
      const shareIds = state.merchantCompanyShareIndex.byCompany[companyId as string] ?? []
      let total = 0
      let mine = 0
      for (const sid of shareIds) {
        const s = state.merchantCompanyShares[sid]
        if (!s) continue
        total += s.rawPower
        if ((s.holderPersonId as string) === (person.id as string)) mine += s.rawPower
      }
      const personSharePct = total > 0 ? (mine / total) * 100 : 0
      const prestige = person.legacyPrestige
      const tenure = clamp((state.currentYear - office.startYear) * 0.01, 0, 0.1)
      const power = 1 + (personSharePct / 100) * 0.7 + (prestige / 100) * 0.15 + tenure
      return clamp(power, 0.01, Infinity)
    }
    default: {
      const _exhaustive: never = org
      throw new Error(`getOfficeHolderPower: unexpected organization ${String(_exhaustive)}`)
    }
  }
}

function findActiveOfficeFor(
  state: WorldState,
  organization: OrganizationRef,
  role: OfficeRole,
  holderId: PersonId,
): OfficeAssignment | undefined {
  return getOfficeAssignments(state, organization).find(
    (o) => o.active && o.role === role && o.holderPersonId === holderId,
  )
}

export function getEffectiveOfficeStat(
  state: WorldState,
  config: SimulationConfig,
  organization: OrganizationRef,
  role: OfficeRole,
): number {
  const holders = getActiveOfficeHolders(state, organization, role)
  if (holders.length === 0) return 0

  const weightedStat = weightedAverage(
    holders.map((holderId) => {
      const office = findActiveOfficeFor(state, organization, role, holderId)
      const person = state.persons[holderId]
      // v0.49: 内政成果も非線形ファクターで一貫スケール (spec §10.0)。中立 roleScore 50 → 5
      //   (= 旧 50/10) を保つため factor*5。これで平均的役職保持者は不変、能力差のみ増幅。
      return {
        value: person
          ? abilityOutputFactor(getRoleScore(state, person.id, 'governance'), config) * 5
          : 0,
        weight: office ? getOfficeHolderPower(state, office) : 0.01,
      }
    }),
    0,
  )

  const distinctHouseCount = new Set(
    holders.map((id) => state.persons[id]?.houseId).filter((h): h is HouseId => h !== undefined),
  ).size

  const penalty =
    config.duplicateOfficeCoordinationPenalty * Math.max(0, holders.length - 1) +
    config.officeHouseDiversityPenalty * distinctHouseCount

  return clamp(weightedStat - penalty, 0, 10)
}

export function getAdministrativeCapacity(
  state: WorldState,
  config: SimulationConfig,
  countryId: PolityId,
): number {
  const countryRef: OrganizationRef = { kind: 'polity', id: countryId }
  const rulerStat = getEffectiveOfficeStat(state, config, countryRef, 'leader')
  const adminStat = getEffectiveOfficeStat(state, config, countryRef, 'administrator')
  const treasurerStat = getEffectiveOfficeStat(state, config, countryRef, 'treasurer')
  return (
    config.baseCountryInstitutionalCapacity +
    rulerStat * config.rulerAdminCapacityFactor +
    adminStat * config.administratorCapacityFactor +
    treasurerStat * config.treasurerCapacityFactor
  )
}

export function getAdministrativeLoad(
  state: WorldState,
  config: SimulationConfig,
  countryId: PolityId,
): number {
  const country = state.polities[countryId]
  if (!country) return 0
  const provinceCount = getPolityTerminalProvinceIds(state, countryId).length
  const countryRef: OrganizationRef = { kind: 'polity', id: countryId }
  const officeCount = getOfficeAssignments(state, countryRef).filter((o) => o.active).length
  return (
    provinceCount * config.adminLoadPerProvince + officeCount * config.adminLoadPerCountryOffice
  )
}

export function getAdministrativeEfficiency(
  state: WorldState,
  config: SimulationConfig,
  countryId: PolityId,
): number {
  const capacity = getAdministrativeCapacity(state, config, countryId)
  const load = getAdministrativeLoad(state, config, countryId)
  const raw = capacity / Math.max(1, load)
  return clamp(raw, config.minAdministrativeEfficiency, config.maxAdministrativeEfficiency)
}

// v0.17 §7.2: dynamic effective max for office holders
export function getEffectiveOfficeMaxHolders(
  state: WorldState,
  config: SimulationConfig,
  organization: OrganizationRef,
  role: OfficeRole,
): number {
  const def = OFFICE_DEFINITIONS[`${organization.kind}:${role}`]
  const baseMax = def ? def.maxHolders : 1

  switch (organization.kind) {
    case 'house':
      return role === 'leader' ? baseMax : 1
    case 'merchant_company': {
      // active company のみ office を持つ (§8.1)。非 active は shell (max 0)。
      //   leader/administrator とも OFFICE_DEFINITIONS の maxHolders(=1) をそのまま使う。
      const company = state.merchantCompanies[organization.id]
      if (!company || company.status !== 'active') return 0
      return baseMax
    }
    case 'polity': {
      const polity = state.polities[organization.id]
      if (!polity || !polity.active) return baseMax
      if (role === 'leader') return baseMax

      // v0.47 §6.5: titular Polity は leader 以外の office を持たない (effective max 0)。
      //   毎 tick の任命→revoke churn を避けるための最後の安全網 (appointment 側でも prevention)。
      if (getPolityTerritorialStatus(polity) === 'titular') return 0

      // commonwealth: rank に依らず全 role を解放し、席数は専用テーブルで rank に応じる。
      //   province factor は掛けない (政体の格 = rank が席数を決める)。通常テーブル + factor では
      //   rank 5 (≈1 province) で administrator/treasurer が必ず 1 に潰れ、権力闘争の余地が消えるため。
      if (polity.kind === 'commonwealth') {
        const cwRow = config.polityOfficeMaxByRankCommonwealth[polity.rank]
        const cwCap = cwRow ? cwRow[role] : 1
        return Math.max(1, Math.min(baseMax, cwCap))
      }

      const rankRow = config.polityOfficeMaxByRank[polity.rank]
      if (!rankRow) return baseMax
      const rankCap = rankRow[role]
      if (rankCap <= 0) return 0

      const provinceCount = getPolityTerminalProvinceIds(state, organization.id).length
      let factor: number
      if (provinceCount <= 1) factor = config.polityOfficeMaxProvinceFactor.small
      else if (provinceCount <= 3) factor = config.polityOfficeMaxProvinceFactor.medium
      else factor = config.polityOfficeMaxProvinceFactor.large

      return Math.max(1, Math.min(baseMax, Math.floor(rankCap * factor)))
    }
    default: {
      const _exhaustive: never = organization
      throw new Error(
        `getEffectiveOfficeMaxHolders: unexpected organization ${String(_exhaustive)}`,
      )
    }
  }
}

// v0.17 §6.5.1: office term expiration check (year-resolution)
export function isOfficeTermExpired(
  state: WorldState,
  config: SimulationConfig,
  assignment: OfficeAssignment,
): boolean {
  if (assignment.role === 'leader') return false
  const role = assignment.role
  const termYears = getOrganizationTermYears(config, assignment.organization, role)
  return state.currentYear - assignment.startYear >= termYears
}

// v0.17 §8.2 / §9.2: shared weight table for House-Polity office equivalents
// Used both for compatibility penalty (§8.3) and overlap score (§9.2).
const HOUSE_POLITY_OFFICE_EQUIVALENTS: ReadonlyArray<{
  houseRole: OfficeRole
  polityRole: OfficeRole
  weight: number
}> = [
  { houseRole: 'leader', polityRole: 'leader', weight: 4 },
  { houseRole: 'administrator', polityRole: 'administrator', weight: 3 },
  { houseRole: 'treasurer', polityRole: 'treasurer', weight: 3 },
  { houseRole: 'military', polityRole: 'military', weight: 2 },
  { houseRole: 'advisor', polityRole: 'advisor', weight: 1 },
]

// v0.17 §9.2: how much of a House's Polity roles are held by people who also hold the matching House role
export function getHousePolityOfficeOverlapScore(
  state: WorldState,
  houseId: HouseId,
  polityId: PolityId,
): number {
  let matched = 0
  let total = 0
  for (const { houseRole, polityRole, weight } of HOUSE_POLITY_OFFICE_EQUIVALENTS) {
    total += weight
    const houseHolders = getActiveOfficeHolders(state, { kind: 'house', id: houseId }, houseRole)
    const polityHolders = getActiveOfficeHolders(
      state,
      { kind: 'polity', id: polityId },
      polityRole,
    )
    if (houseHolders.length === 0 || polityHolders.length === 0) continue
    if (houseHolders.some((h) => polityHolders.includes(h))) matched += weight
  }
  return total === 0 ? 0 : matched / total
}

function isCompatiblePair(
  existing: OfficeAssignment,
  targetKind: OrganizationKind,
  targetRole: OfficeRole,
): boolean {
  if (existing.organization.kind === targetKind) return false
  if (targetRole === 'leader' || existing.role === 'leader') return false
  return existing.role === targetRole
}

// v0.42 §19.2-1: 入力を polity share% から influence% に差替。influence の計算は
// influenceSelectors への runtime import が循環依存になるため、呼出側が候補の家の
// influence% (0〜100) を渡す。未供給 (undefined) なら 0 として扱う (ownerHouse の
// fast path は維持されるため、reduction が完全に消えるわけではない)。
function getCompatibleShareReduction(
  state: WorldState,
  config: SimulationConfig,
  candidateHouseId: HouseId,
  targetOrganization: OrganizationRef,
  candidateInfluencePct: number | undefined,
): number {
  if (targetOrganization.kind !== 'polity') return 0
  const polity = state.polities[targetOrganization.id]
  if (!polity) return 0
  if (polity.ownerHouseId === candidateHouseId) {
    return config.compatibleShareReductionMax
  }
  const ratio = (candidateInfluencePct ?? 0) / 100
  const clamped = Math.max(0, Math.min(1, ratio))
  return clamped * config.compatibleShareReductionMax
}

// v0.17 §8.3: total compatibility penalty across all existing offices the candidate holds.
// v0.42: targetOrganization が polity の場合、candidateInfluencePct (候補の家の
// 当該 polity への influence%、0〜100) を渡すと compatible-pair の penalty 軽減に使う。
export function getOfficeCompatibilityPenalty(
  state: WorldState,
  config: SimulationConfig,
  candidateId: PersonId,
  targetOrganization: OrganizationRef,
  targetRole: OfficeRole,
  candidateInfluencePct?: number,
): number {
  const candidate = state.persons[candidateId]
  if (!candidate) return 0
  if (!candidate.houseId) return 0

  let total = 0
  const ownIds = state.officeIndex.byHolderPerson[candidateId] ?? []
  for (const officeId of ownIds) {
    const existing = state.officeAssignments[officeId]
    if (!existing || !existing.active) continue
    if (existing.role === 'leader') continue
    if (targetRole === 'leader') continue

    if (isCompatiblePair(existing, targetOrganization.kind, targetRole)) {
      const reduction = getCompatibleShareReduction(
        state,
        config,
        candidate.houseId,
        targetOrganization,
        candidateInfluencePct,
      )
      total += config.compatibleOfficePenalty * (1 - reduction)
    } else {
      // Same-kind same-role would be an unusual case; treat as incompatible.
      total += config.incompatibleOfficePenalty
    }
  }
  return total
}
