import type { WorldState } from '../types/world'
import type { PersonId, CountryId } from '../types/ids'
import type { OfficeRole } from '../types/office'
import type { EventReason, EventEffect } from '../types/event'
import { getAttitudeOrDefault, attitudeValueToScore } from '../helpers/attitudeHelpers'
import { getRoleScore } from '../selectors/abilitySelectors'

export function explainAppointment(
  state: WorldState,
  countryId: CountryId,
  role: OfficeRole,
  personId: PersonId,
): { reasons: EventReason[]; effects: EventEffect[] } {
  const country = state.countries[countryId]
  if (!country) return { reasons: [], effects: [] }

  const person = state.persons[personId]
  if (!person) return { reasons: [], effects: [] }

  const reasons: EventReason[] = []

  const personCountryAtt = getAttitudeOrDefault(state, person, { kind: 'country', id: countryId })
  const personCountryLoyalty =
    (attitudeValueToScore(personCountryAtt.affection) * 0.55 +
      attitudeValueToScore(personCountryAtt.respect) * 0.45) /
    100

  switch (role) {
    case 'administrator': {
      const adminContribution = (getRoleScore(state, personId, 'governance') / 10) * 8
      if (adminContribution > 0) {
        reasons.push({
          label: 'Admin skill',
          value: getRoleScore(state, personId, 'governance') / 10,
          contribution: adminContribution,
        })
      }

      reasons.push({
        label: 'Numeracy',
        value: person.abilities.numeracy,
        contribution: 0,
      })
      reasons.push({
        label: 'Learning',
        value: person.abilities.learning,
        contribution: 0,
      })
      reasons.push({
        label: 'Charisma',
        value: person.abilities.charisma,
        contribution: 0,
      })

      const loyaltyContribution = personCountryLoyalty * 20
      if (loyaltyContribution > 0) {
        reasons.push({
          label: 'Loyalty to country',
          value: personCountryLoyalty,
          contribution: loyaltyContribution,
        })
      }

      const prestigeContribution = person.legacyPrestige * 0.3
      if (prestigeContribution > 0) {
        reasons.push({
          label: 'Prestige',
          value: person.legacyPrestige,
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

    case 'military': {
      const martialContribution = (getRoleScore(state, personId, 'warCommand') / 10) * 8
      if (martialContribution > 0) {
        reasons.push({
          label: 'Martial skill',
          value: getRoleScore(state, personId, 'warCommand') / 10,
          contribution: martialContribution,
        })
      }

      reasons.push({
        label: 'Command',
        value: person.abilities.command,
        contribution: 0,
      })
      reasons.push({
        label: 'Valor',
        value: person.abilities.valor,
        contribution: 0,
      })

      const prestigeContribution = person.legacyPrestige * 0.3
      if (prestigeContribution > 0) {
        reasons.push({
          label: 'Prestige',
          value: person.legacyPrestige,
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
      const adminContribution = (getRoleScore(state, personId, 'governance') / 10) * 7
      if (adminContribution > 0) {
        reasons.push({
          label: 'Admin skill',
          value: getRoleScore(state, personId, 'governance') / 10,
          contribution: adminContribution,
        })
      }

      const loyaltyContribution = personCountryLoyalty * 25
      if (loyaltyContribution > 0) {
        reasons.push({
          label: 'Loyalty to country',
          value: personCountryLoyalty,
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
