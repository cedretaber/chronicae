import type { PersonId } from '../types/ids'
import type { RoleType } from '../types/role'
import type { WorldState } from '../types/world'

const ALL_ROLES: RoleType[] = ['chancellor', 'general', 'treasurer']

export function getPersonRole(state: WorldState, personId: PersonId): RoleType | null {
  for (const countryId of Object.keys(state.countries).sort()) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const country = state.countries[countryId]
    if (!country) continue
    for (const role of ALL_ROLES) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const assignedPerson = country.roleAssignments[role]
      if (assignedPerson === personId) {
        return role
      }
    }
  }
  return null
}
