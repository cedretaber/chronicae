import { clamp } from '@sim/utils/math'
import type { WorldState } from '@sim/types/world'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { CountryId, HouseId, PersonId } from '@sim/types/ids'
import type { OrganizationRef, OfficeAssignment, OfficeRole } from '@sim/types/office'
import { OFFICE_DEFINITIONS } from '@sim/config/officeDefinitions'
import {
  getHouseCountrySharePercent,
  getPersonHouseSharePercent,
} from '@sim/selectors/shareSelectors'
import {
  attitudeValueToScore,
  getAttitudeOrDefault,
  countryAttitudeKey,
  houseAttitudeKey,
  personAttitudeKey,
} from '@sim/helpers/attitudeHelpers'
import { weightedAverage } from '@sim/selectors/statusSelectors'

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

export function getCountryRuler(state: WorldState, countryId: CountryId): PersonId | undefined {
  return getPrimaryOfficeHolder(state, { kind: 'country', id: countryId }, 'leader')
}

export function getCountryRulerHouse(state: WorldState, countryId: CountryId): HouseId | undefined {
  const rulerId = getCountryRuler(state, countryId)
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

  if (org.kind === 'country') {
    const countryId = org.id
    const houseId = person.houseId
    const country = state.countries[countryId]

    const houseSharePct = getHouseCountrySharePercent(state, countryId, houseId)
    const personSharePct = getPersonHouseSharePercent(state, houseId, person.id)
    const prestige = person.legacyPrestige

    let rulerRespectScore = 0
    const rulerId = getCountryRuler(state, countryId)
    if (rulerId && rulerId !== office.holderPersonId) {
      const ruler = state.persons[rulerId]
      if (ruler) {
        const rulerKey = personAttitudeKey(rulerId)
        const att = getAttitudeOrDefault(state, person, rulerKey)
        rulerRespectScore = attitudeValueToScore(att.respect) / 100
      }
    }

    let orgRespectScore = 0
    if (country) {
      const countryKey = countryAttitudeKey(countryId)
      const att = getAttitudeOrDefault(state, person, countryKey)
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
        const leaderKey = personAttitudeKey(leaderId)
        const att = getAttitudeOrDefault(state, person, leaderKey)
        leaderRespectScore = attitudeValueToScore(att.respect) / 100
      }
    }

    let orgRespectScore = 0
    if (house) {
      const houseKey = houseAttitudeKey(houseId)
      const att = getAttitudeOrDefault(state, person, houseKey)
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
  stat: 'admin' | 'martial',
): number {
  const holders = getActiveOfficeHolders(state, organization, role)
  if (holders.length === 0) return 0

  const weightedStat = weightedAverage(
    holders.map((holderId) => {
      const office = findActiveOfficeFor(state, organization, role, holderId)
      const person = state.persons[holderId]
      return {
        value: person?.stats[stat] ?? 0,
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
  countryId: CountryId,
): number {
  const countryRef: OrganizationRef = { kind: 'country', id: countryId }
  const rulerStat = getEffectiveOfficeStat(state, config, countryRef, 'leader', 'admin')
  const adminStat = getEffectiveOfficeStat(state, config, countryRef, 'administrator', 'admin')
  const treasurerStat = getEffectiveOfficeStat(state, config, countryRef, 'treasurer', 'admin')
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
  countryId: CountryId,
): number {
  const country = state.countries[countryId]
  if (!country) return 0
  const provinceCount = Object.values(state.provinces).filter(
    (p) => p && p.countryId === countryId,
  ).length
  const countryRef: OrganizationRef = { kind: 'country', id: countryId }
  const officeCount = getOfficeAssignments(state, countryRef).filter((o) => o.active).length
  return (
    provinceCount * config.adminLoadPerProvince + officeCount * config.adminLoadPerCountryOffice
  )
}

export function getAdministrativeEfficiency(
  state: WorldState,
  config: SimulationConfig,
  countryId: CountryId,
): number {
  const capacity = getAdministrativeCapacity(state, config, countryId)
  const load = getAdministrativeLoad(state, config, countryId)
  const raw = capacity / Math.max(1, load)
  return clamp(raw, config.minAdministrativeEfficiency, config.maxAdministrativeEfficiency)
}
