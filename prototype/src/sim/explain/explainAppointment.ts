import type { WorldState } from '../types/world'
import type { PersonId, CountryId } from '../types/ids'
import type { RoleType } from '../types/role'
import type { EventReason, EventEffect } from '../types/event'

export function explainAppointment(
  state: WorldState,
  countryId: CountryId,
  role: RoleType,
  personId: PersonId,
): { reasons: EventReason[]; effects: EventEffect[] } {
  const country = state.countries[countryId]
  if (!country) return { reasons: [], effects: [] }

  const person = state.persons[personId]
  if (!person) return { reasons: [], effects: [] }

  const reasons: EventReason[] = []

  switch (role) {
    case 'chancellor': {
      const adminContribution = person.stats.admin * 8
      if (adminContribution > 0) {
        reasons.push({
          label: 'Admin skill',
          value: person.stats.admin,
          contribution: adminContribution,
        })
      }

      const loyaltyContribution = person.traits.loyaltyToCountry * 20
      if (loyaltyContribution > 0) {
        reasons.push({
          label: 'Loyalty to country',
          value: person.traits.loyaltyToCountry,
          contribution: loyaltyContribution,
        })
      }

      const prestigeContribution = person.prestige * 0.3
      if (prestigeContribution > 0) {
        reasons.push({
          label: 'Prestige',
          value: person.prestige,
          contribution: prestigeContribution,
        })
      }

      const ambitionPenalty = person.traits.ambition * 10
      if (ambitionPenalty > 0) {
        reasons.push({
          label: 'High ambition (penalty)',
          value: person.traits.ambition,
          contribution: -ambitionPenalty,
        })
      }

      break
    }

    case 'general': {
      const martialContribution = person.stats.martial * 8
      if (martialContribution > 0) {
        reasons.push({
          label: 'Martial skill',
          value: person.stats.martial,
          contribution: martialContribution,
        })
      }

      const prestigeContribution = person.prestige * 0.3
      if (prestigeContribution > 0) {
        reasons.push({
          label: 'Prestige',
          value: person.prestige,
          contribution: prestigeContribution,
        })
      }

      const ambitionContribution = person.traits.ambition * 5
      if (ambitionContribution > 0) {
        reasons.push({
          label: 'Ambition',
          value: person.traits.ambition,
          contribution: ambitionContribution,
        })
      }

      break
    }

    case 'treasurer': {
      const adminContribution = person.stats.admin * 7
      if (adminContribution > 0) {
        reasons.push({
          label: 'Admin skill',
          value: person.stats.admin,
          contribution: adminContribution,
        })
      }

      const loyaltyContribution = person.traits.loyaltyToCountry * 25
      if (loyaltyContribution > 0) {
        reasons.push({
          label: 'Loyalty to country',
          value: person.traits.loyaltyToCountry,
          contribution: loyaltyContribution,
        })
      }

      const cautionContribution = person.traits.caution * 10
      if (cautionContribution > 0) {
        reasons.push({
          label: 'Caution',
          value: person.traits.caution,
          contribution: cautionContribution,
        })
      }

      const ambitionPenalty = person.traits.ambition * 15
      if (ambitionPenalty > 0) {
        reasons.push({
          label: 'High ambition (penalty)',
          value: person.traits.ambition,
          contribution: -ambitionPenalty,
        })
      }

      break
    }
  }

  const effects: EventEffect[] = [{ label: 'Appointed to role' }]

  return { reasons, effects }
}
