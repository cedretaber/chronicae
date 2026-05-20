import type { TickContext } from './context'
import { makeEventId } from './context'
import type { OfficeAssignmentId } from '@sim/types/ids'
import type { SimEvent } from '@sim/types/event'
import { getOfficeDefinition } from '@sim/config/officeDefinitions'
import { adjustPersonAttitude } from '@sim/mutations/attitudeMutations'
import type { WorldState } from '@sim/types/world'

export function runOfficeCompensationSystem(ctx: TickContext): TickContext {
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

    if (org.kind === 'polity') {
      const polity = state.polities[org.id]
      if (!polity) continue
      payerFunds = polity.treasury
      updatePayer = (funds: number) => ({
        ...state,
        polities: {
          ...state.polities,
          [org.id]: { ...polity, treasury: funds },
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

      const orgTarget =
        org.kind === 'polity'
          ? { kind: 'polity' as const, id: org.id }
          : { kind: 'house' as const, id: org.id }

      const r = adjustPersonAttitude(state, office.holderPersonId, orgTarget, {
        affection: affPenalty,
        respect: resPenalty,
      })
      if (r.ok) state = r.value

      // Emit OFFICE_SALARY_UNPAID or OFFICE_SALARY_PARTIALLY_PAID event
      const eventType = paid > 0 ? 'OFFICE_SALARY_PARTIALLY_PAID' : 'OFFICE_SALARY_UNPAID'
      const { id: eventId, ctx: newCtx } = makeEventId({ ...ctx, state, events })
      const event: SimEvent = {
        id: eventId,
        year: state.currentYear,
        weekOfYear: state.currentWeekOfYear,
        type: eventType,
        importance: 'minor',
        actorIds: [office.holderPersonId],
        houseIds: [],
        polityIds: org.kind === 'polity' ? [org.id] : [],
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
