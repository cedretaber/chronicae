import { clamp } from '@sim/utils/math'
import type { WorldState } from '@sim/types/world'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { PolityId, HouseId, PersonId } from '@sim/types/ids'
import type { OrganizationRef, OfficeAssignment, OfficeRole } from '@sim/types/office'
import { OFFICE_DEFINITIONS } from '@sim/config/officeDefinitions'
import {
  getHousePolitySharePercent,
  getPersonHouseSharePercent,
} from '@sim/selectors/shareSelectors'
import { attitudeValueToScore, getAttitudeOrDefault } from '@sim/helpers/attitudeHelpers'
import { weightedAverage } from '@sim/selectors/statusSelectors'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import { getPolityTerminalProvinceIds } from '@sim/selectors/landContractSelectors'

function orgKey(org: OrganizationRef): string {
  return `${org.kind}:${org.id}`
}

export function getOfficeAssignments(
  state: WorldState,
  organization: OrganizationRef,
): OfficeAssignment[] {
  const key = orgKey(organization)
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

export function getOfficeHolderPower(state: WorldState, office: OfficeAssignment): number {
  const person = state.persons[office.holderPersonId]
  if (!person) return 0.01

  const org = office.organization

  if (org.kind === 'polity') {
    const countryId = org.id
    const houseId = person.houseId
    const country = state.polities[countryId]

    const houseSharePct = getHousePolitySharePercent(state, countryId, houseId)
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
      (houseSharePct / 100) * 0.6 +
      (personSharePct / 100) * 0.25 +
      (prestige / 100) * 0.1 +
      rulerRespectScore * 0.1 +
      orgRespectScore * 0.1 +
      tenure

    return clamp(power, 0.01, Infinity)
  } else {
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
      return {
        value: person ? getRoleScore(state, person.id, 'governance') / 10 : 0,
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

export function getAvailableOfficeRoles(
  state: WorldState,
  organization: OrganizationRef,
): OfficeRole[] {
  const allRoles: OfficeRole[] = ['leader', 'administrator', 'treasurer', 'military', 'advisor']
  const result: OfficeRole[] = []
  for (const role of allRoles) {
    const def = OFFICE_DEFINITIONS[`${organization.kind}:${role}`]
    if (!def) continue
    const currentCount = getActiveOfficeHolders(state, organization, role).length
    if (currentCount < def.maxHolders) {
      result.push(role)
    }
  }
  return result
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
