import type { PersonId, HouseId, PolityId } from '@/sim/types/ids'
import type { Person } from '@/sim/types/person'
import type { ClickHandler } from './helpers'
import { useEntityName } from '@/app/hooks/useEntityName'
import type { House } from '@/sim/types/house'
import type { Polity } from '@/sim/types/polity'

export function PersonLink({
  personId,
  persons,
  onClick,
}: {
  personId: PersonId
  persons: Record<string, Person>
  onClick: ClickHandler
}) {
  const resolveName = useEntityName()
  const person = persons[personId]
  if (!person) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(personId, 'person')}
    >
      {resolveName('person', person.nameKey, person.nameKey)}
    </button>
  )
}

export function HouseLink({
  houseId,
  houses,
  onClick,
}: {
  houseId: HouseId | undefined
  houses: Record<string, House>
  onClick: ClickHandler
}) {
  const resolveName = useEntityName()
  if (!houseId) return <span className="text-gray-500">\u2014</span>
  const house = houses[houseId]
  if (!house) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(houseId, 'house')}
    >
      {resolveName('house', house.nameKey, house.nameKey)}
    </button>
  )
}

export function PolityLink({
  polityId,
  polities,
  onClick,
}: {
  polityId: PolityId | undefined
  polities: Record<string, Polity>
  onClick: ClickHandler
}) {
  const resolveName = useEntityName()
  if (!polityId) return <span className="text-gray-500">\u2014</span>
  const polity = polities[polityId]
  if (!polity) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(polityId, 'polity')}
    >
      {resolveName('polity', polity.nameKey, polity.nameKey)}
    </button>
  )
}
