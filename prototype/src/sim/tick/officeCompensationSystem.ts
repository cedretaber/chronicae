import type { TickContext } from './context'
import { createSimEvent } from './context'
import type {
  OfficeAssignmentId,
  PolityId,
  HouseId,
  PersonId,
  MerchantCompanyId,
} from '@sim/types/ids'
import type { SimEvent } from '@sim/types/event'
import { entityRef } from '@sim/types/event'
import { getOfficeDefinition } from '@sim/config/officeDefinitions'
import { organizationKey } from '@sim/selectors/organizationSelectors'
import { getOrganizationOfficeEntityRefs } from '@sim/selectors/officeSelectors'
import type { WorldState } from '@sim/types/world'
import type { Person } from '@sim/types/person'
import type { Polity } from '@sim/types/polity'
import type { House } from '@sim/types/house'
import type { MerchantCompany } from '@sim/types/merchant'
import type { OfficeAssignment } from '@sim/types/office'

const COMPENSATION_CALLS_PER_YEAR = 12

export function runOfficeCompensationSystem(ctx: TickContext): TickContext {
  const state = ctx.state
  const config = ctx.config
  const events: SimEvent[] = [...ctx.events]

  const personsMut = { ...state.persons } as Record<PersonId, Person>
  const politiesMut = { ...state.polities } as Record<PolityId, Polity>
  const housesMut = { ...state.houses } as Record<HouseId, House>
  const companiesMut = { ...state.merchantCompanies } as Record<MerchantCompanyId, MerchantCompany>
  const officesMut = { ...state.officeAssignments } as Record<OfficeAssignmentId, OfficeAssignment>

  let currentCtx = ctx

  for (const officeId of Object.keys(state.officeAssignments)) {
    const office = officesMut[officeId as OfficeAssignmentId]
    if (!office || !office.active) continue

    const def = getOfficeDefinition(office.organization.kind, office.role)
    if (!def || def.baseSalary <= 0) continue

    const due = def.baseSalary / COMPENSATION_CALLS_PER_YEAR
    const person = personsMut[office.holderPersonId]
    if (!person) continue

    let payerFunds: number
    const org = office.organization

    switch (org.kind) {
      case 'polity': {
        const polity = politiesMut[org.id]
        if (!polity) continue
        payerFunds = polity.treasury
        break
      }
      case 'house': {
        const house = housesMut[org.id]
        if (!house) continue
        payerFunds = house.wealth
        break
      }
      case 'merchant_company': {
        const company = companiesMut[org.id]
        if (!company) continue
        // dissolve/bankrupt 直後の同 tick では office 失効が後続 system (merchantCompanyOfficeSync) まで
        //   遅れるため、非 active 商会からの俸給支払い（dissolved entity の post-mortem payout）を防ぐ。
        if (company.status !== 'active') continue
        payerFunds = company.treasury
        break
      }
      default: {
        const _exhaustive: never = org
        throw new Error(`officeCompensation: unexpected organization ${String(_exhaustive)}`)
      }
    }

    const paid = Math.min(due, Math.max(0, payerFunds))
    const unpaid = due - paid

    switch (org.kind) {
      case 'polity': {
        const polity = politiesMut[org.id]
        if (polity) politiesMut[org.id] = { ...polity, treasury: polity.treasury - paid }
        break
      }
      case 'house': {
        const house = housesMut[org.id]
        if (house) housesMut[org.id] = { ...house, wealth: house.wealth - paid }
        break
      }
      case 'merchant_company': {
        const company = companiesMut[org.id]
        if (company) companiesMut[org.id] = { ...company, treasury: company.treasury - paid }
        break
      }
      default: {
        const _exhaustive: never = org
        throw new Error(`officeCompensation: unexpected organization ${String(_exhaustive)}`)
      }
    }

    personsMut[office.holderPersonId] = { ...person, wealth: person.wealth + paid }

    let newUnpaidCount: number
    if (unpaid > 0) {
      newUnpaidCount = office.unpaidCount + 1

      const dignityReduction =
        (def.baseDignityPower / 100) * config.officeDignityUnpaidPenaltyReduction
      const affPenalty =
        (config.officeUnpaidAffectionPenalty / COMPENSATION_CALLS_PER_YEAR) * (1 - dignityReduction)
      const resPenalty =
        (config.officeUnpaidRespectPenalty / COMPENSATION_CALLS_PER_YEAR) * (1 - dignityReduction)

      const attKey = organizationKey(org)
      const currentPerson = personsMut[office.holderPersonId]
      if (currentPerson) {
        const currentAtt = currentPerson.attitudes[attKey]
        const newAff = (currentAtt?.affection ?? 0) + affPenalty
        const newRes = (currentAtt?.respect ?? 0) + resPenalty
        personsMut[office.holderPersonId] = {
          ...currentPerson,
          attitudes: {
            ...currentPerson.attitudes,
            [attKey]: { affection: newAff, respect: newRes },
          },
        }
      }

      const eventType = paid > 0 ? 'OFFICE_SALARY_PARTIALLY_PAID' : 'OFFICE_SALARY_UNPAID'
      const evMessageKey = paid > 0 ? 'office.salary_partially_paid' : 'office.salary_unpaid'
      const holder = personsMut[office.holderPersonId]
      const { event, ctx: ec } = createSimEvent(currentCtx, {
        type: eventType,
        importance: 'minor',
        messageKey: evMessageKey,
        messageParams: {},
        entityRefs: [
          entityRef('person', office.holderPersonId, 'holder', holder?.nameKey),
          ...getOrganizationOfficeEntityRefs(org),
        ],
      })
      events.push(event)
      currentCtx = ec
    } else {
      newUnpaidCount = Math.max(0, office.unpaidCount - 1)
    }

    officesMut[officeId as OfficeAssignmentId] = { ...office, unpaidCount: newUnpaidCount }
  }

  const newState: WorldState = {
    ...state,
    persons: personsMut,
    polities: politiesMut,
    houses: housesMut,
    merchantCompanies: companiesMut,
    officeAssignments: officesMut,
  }

  return { ...currentCtx, state: newState, events }
}
