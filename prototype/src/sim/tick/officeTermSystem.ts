import type { TickContext } from './context'
import type { SimEvent } from '../types/event'
import type { OfficeAssignmentId, HouseId, PolityId } from '../types/ids'
import { makeEventId } from './context'
import { isOfficeTermExpired } from '../selectors/officeSelectors'
import { expireOfficeTermAssignment } from '../mutations/officeMutations'

// v0.17 §6.5: Every January, expire non-leader offices whose term has elapsed.
export function runOfficeTermSystem(ctx: TickContext): TickContext {
  if (ctx.state.currentMonth !== 1) return ctx

  let currentCtx = ctx

  const officeIds = (Object.keys(currentCtx.state.officeAssignments) as OfficeAssignmentId[]).sort()
  for (const officeId of officeIds) {
    const office = currentCtx.state.officeAssignments[officeId]
    if (!office || !office.active) continue
    if (office.role === 'leader') continue
    if (!isOfficeTermExpired(currentCtx.state, currentCtx.config, office)) continue

    const holder = currentCtx.state.persons[office.holderPersonId]
    const holderHouseId = holder?.houseId

    const expiredState = expireOfficeTermAssignment(currentCtx.state, officeId)
    currentCtx = { ...currentCtx, state: expiredState }

    const { id: eventId, ctx: ec } = makeEventId(currentCtx)
    const houseIds: HouseId[] = holderHouseId ? [holderHouseId] : []
    const polityIds: PolityId[] =
      office.organization.kind === 'polity' ? [office.organization.id] : []
    const event: SimEvent = {
      id: eventId,
      year: ec.state.currentYear,
      month: ec.state.currentMonth,
      type: 'OFFICE_TERM_ENDED',
      importance: 'normal',
      actorIds: [office.holderPersonId],
      houseIds,
      polityIds,
      provinceIds: [],
      summary: `${holder?.name ?? office.holderPersonId}'s term as ${office.role} ended.`,
      reasons: [],
      effects: [],
    }
    currentCtx = { ...ec, events: [...ec.events, event] }
  }

  return currentCtx
}
