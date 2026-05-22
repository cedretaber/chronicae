import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PersonId } from '../types/ids'
import type { OfficeRole } from '../types/office'
import type { PoliticalActorRef } from '../types/actor'

export function getAppointmentTaskModifier(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  organization: PoliticalActorRef,
  role: OfficeRole,
): number {
  let modifier = 0

  // Check if person has an active obtain_office or retain_office Aim targeting this office
  for (const [, aim] of Object.entries(state.aims)) {
    if (!aim || aim.status !== 'active') continue
    if (aim.owner.kind !== 'person') continue
    if ((aim.owner.id as string) !== (personId as string)) continue

    if (aim.kind === 'obtain_office' || aim.kind === 'retain_office') {
      // Check if target matches this organization + role
      if (aim.target && aim.target.kind === 'office') {
        const targetOrg = aim.target.organization
        if (
          targetOrg.kind === organization.kind &&
          (targetOrg.id as string) === (organization.id as string) &&
          aim.target.role === role
        ) {
          modifier += config.appointmentTaskModifierValue * 0.5
        }
      }
    }
  }

  // Check recent ActivityLogs for seek_office_support or display_competence success
  const personKey = personId as string
  const logIds = state.personActivityLogIndex.byPerson[personKey]
  if (logIds) {
    const currentWeek = state.absoluteWeek
    for (const logId of logIds) {
      const log = state.personActivityLogs[logId]
      if (!log) continue
      if (currentWeek - log.week > config.appointmentTaskModifierDurationWeeks) continue
      if (log.kind !== 'task_completed') continue
      if (log.taskKind === 'seek_office_support' || log.taskKind === 'display_competence') {
        modifier += config.appointmentTaskModifierValue * 0.5
      }
    }
  }

  return modifier
}
