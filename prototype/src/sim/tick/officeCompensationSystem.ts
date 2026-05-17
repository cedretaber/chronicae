import type { TickContext } from './context'
import { makeEventId } from './context'
import type { OfficeAssignmentId } from '@sim/types/ids'
import type { SimEvent } from '@sim/types/event'
import { getOfficeDefinition } from '@sim/config/officeDefinitions'
import { adjustAttitude } from '@sim/helpers/attitudeHelpers'
import { countryAttitudeKey, houseAttitudeKey } from '@sim/helpers/attitudeHelpers'
import type { WorldState } from '@sim/types/world'

export function runOfficeCompensationSystem(ctx: TickContext): TickContext {
  if (ctx.state.currentMonth !== 1) return ctx

  let state = ctx.state
  const config = ctx.config
  const events: SimEvent[] = [...ctx.events]

  for (const officeId of Object.keys(state.officeAssignments)) {
    const office = state.officeAssignments[officeId as OfficeAssignmentId]
    if (!office || !office.active) continue

    const def = getOfficeDefinition(office.organization.kind, office.role)
    if (!def || def.baseSalary <= 0) continue

    const due = def.baseSalary
    const person = state.persons[office.holderPersonId]
    if (!person) continue

    let payerFunds: number
    let updatePayer: (funds: number) => WorldState
    const org = office.organization

    if (org.kind === 'country') {
      const country = state.countries[org.id]
      if (!country) continue
      payerFunds = country.treasury
      updatePayer = (funds: number) => ({
        ...state,
        countries: {
          ...state.countries,
          [org.id]: { ...country, treasury: funds },
        },
      })
    } else {
      const house = state.houses[org.id]
      if (!house) continue
      payerFunds = house.wealth
      updatePayer = (funds: number) => ({
        ...state,
        houses: {
          ...state.houses,
          [org.id]: { ...house, wealth: funds },
        },
      })
    }

    const paid = Math.min(due, Math.max(0, payerFunds))
    const unpaid = due - paid

    // Pay the person
    state = updatePayer(payerFunds - paid)
    const updatedPerson = state.persons[office.holderPersonId]
    if (updatedPerson) {
      state = {
        ...state,
        persons: {
          ...state.persons,
          [office.holderPersonId]: {
            ...updatedPerson,
            wealth: updatedPerson.wealth + paid,
          },
        },
      }
    }

    // Update unpaidCount
    let newUnpaidCount: number
    if (unpaid > 0) {
      newUnpaidCount = office.unpaidCount + 1

      // Apply Attitude penalty (reduced by dignity)
      const dignityReduction =
        (def.baseDignityPower / 100) * config.officeDignityUnpaidPenaltyReduction
      const affPenalty = config.officeUnpaidAffectionPenalty * (1 - dignityReduction)
      const resPenalty = config.officeUnpaidRespectPenalty * (1 - dignityReduction)

      const attKey = org.kind === 'country' ? countryAttitudeKey(org.id) : houseAttitudeKey(org.id)

      const currentPerson = state.persons[office.holderPersonId]
      if (currentPerson) {
        const updatedAttitudes = adjustAttitude(currentPerson.attitudes, attKey, {
          affection: affPenalty,
          respect: resPenalty,
        })
        state = {
          ...state,
          persons: {
            ...state.persons,
            [office.holderPersonId]: { ...currentPerson, attitudes: updatedAttitudes },
          },
        }
      }

      // Emit OFFICE_SALARY_UNPAID or OFFICE_SALARY_PARTIALLY_PAID event
      const eventType = paid > 0 ? 'OFFICE_SALARY_PARTIALLY_PAID' : 'OFFICE_SALARY_UNPAID'
      const { id: eventId, ctx: newCtx } = makeEventId({ ...ctx, state, events })
      const event: SimEvent = {
        id: eventId,
        year: state.currentYear,
        month: state.currentMonth,
        type: eventType,
        importance: 'minor',
        actorIds: [office.holderPersonId],
        houseIds: [],
        countryIds: org.kind === 'country' ? [org.id] : [],
        provinceIds: [],
        summary: `Salary ${paid > 0 ? 'partially ' : ''}unpaid for office holder.`,
        reasons: [],
        effects: [],
      }
      events.push(event)
      ctx = { ...newCtx, state, events }
    } else {
      newUnpaidCount = Math.max(0, office.unpaidCount - 1)
    }

    // Update office unpaidCount
    state = {
      ...state,
      officeAssignments: {
        ...state.officeAssignments,
        [officeId]: { ...office, unpaidCount: newUnpaidCount },
      },
    }
  }

  return { ...ctx, state, events }
}
