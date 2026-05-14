import type { Person } from '../types/person'

import type { WorldState } from '../types/world'

function isParentOf(parent: Person, child: Person): boolean {
  return parent.childIds.some((cid) => (cid as string) === (child.id as string))
}

export function isForbiddenMarriagePair(a: Person, b: Person, state: WorldState): boolean {
  // 1. Parent-child
  if (isParentOf(a, b) || isParentOf(b, a)) {
    return true
  }

  // 2. Siblings (same father or same mother)
  if (a.fatherId !== undefined && a.fatherId === b.fatherId) {
    return true
  }
  if (a.motherId !== undefined && a.motherId === b.motherId) {
    return true
  }

  // 3. Grandparent-grandchild: a is grandparent of b if any of a's children is a parent of b
  for (const childId of a.childIds) {
    const child = state.persons[childId]
    if (child && child.childIds.some((cid) => (cid as string) === (b.id as string))) {
      return true
    }
  }
  for (const childId of b.childIds) {
    const child = state.persons[childId]
    if (child && child.childIds.some((cid) => (cid as string) === (a.id as string))) {
      return true
    }
  }

  return false
}
