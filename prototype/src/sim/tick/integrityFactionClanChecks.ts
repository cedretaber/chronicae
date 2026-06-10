import type {
  HouseId,
  LandContractId,
  FactionId,
  FactionMembershipId,
  PersonId,
  ClanId,
} from '../types/ids'
import { ROOT_WORLD } from '../types/landContract'
import type { SimError } from '../mutations/errors'
import type { WorldState } from '../types/world'

export function checkFactionsAndClans(state: WorldState, errors: SimError[]): void {
  // v0.17 §21.1 Faction (skeleton — Stage B で詳細チェックを拡張)
  // F1: active Faction.leaderPersonId は alive normal Person
  // F2: placeholder Person は active FactionMembership を持たない
  // F4: 1 Person max 1 active FactionMembership
  // F5: inactive Faction の membership はすべて inactive
  // F6: active Faction には leader 自身の active membership がある
  // F7: FactionMembership.factionId は存在する Faction
  const activeMembershipCountByPerson: Record<string, number> = {}
  for (const factionIdStr of Object.keys(state.factions)) {
    const factionId = factionIdStr as FactionId
    const faction = state.factions[factionId]
    if (!faction) continue
    if (faction.active) {
      const leader = state.persons[faction.leaderPersonId]
      if (!leader || !leader.alive || leader.kind === 'placeholder') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Faction ${factionId} leader ${faction.leaderPersonId} is not alive / normal (§21.1 F1)`,
        })
      }
      let leaderMembershipFound = false
      for (const m of Object.values(state.factionMemberships)) {
        if (!m) continue
        if (m.factionId !== factionId) continue
        if (m.active && m.personId === faction.leaderPersonId) {
          leaderMembershipFound = true
          break
        }
      }
      if (!leaderMembershipFound) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `active Faction ${factionId} has no active membership for leader ${faction.leaderPersonId} (§21.1 F6)`,
        })
      }
    } else {
      for (const m of Object.values(state.factionMemberships)) {
        if (!m) continue
        if (m.factionId !== factionId) continue
        if (m.active) {
          errors.push({
            code: 'INTEGRITY_VIOLATION',
            message: `inactive Faction ${factionId} has active membership ${m.id} (§21.1 F5)`,
          })
        }
      }
    }
  }
  for (const m of Object.values(state.factionMemberships)) {
    if (!m) continue
    if (!state.factions[m.factionId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `FactionMembership ${m.id} references missing Faction ${m.factionId} (§21.1 F7)`,
      })
    }
    if (!m.active) continue
    const person = state.persons[m.personId]
    if (person && person.kind === 'placeholder') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `placeholder Person ${m.personId} has active FactionMembership ${m.id} (§21.1 F2)`,
      })
    }
    const personKey = m.personId as string
    activeMembershipCountByPerson[personKey] = (activeMembershipCountByPerson[personKey] ?? 0) + 1
  }
  for (const personKey of Object.keys(activeMembershipCountByPerson)) {
    const count = activeMembershipCountByPerson[personKey] ?? 0
    if (count > 1) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Person ${personKey} has ${count} active FactionMembership entries (§21.1 F4)`,
      })
    }
  }

  // v0.42 §8 F8: active Faction の anchor polityId は active Polity を指す。
  //   主処理 = polityOwnerConsistency deactivate の即時解散 cascade (§12.3)。
  for (const factionIdStr of Object.keys(state.factions)) {
    const factionId = factionIdStr as FactionId
    const faction = state.factions[factionId]
    if (!faction || !faction.active) continue
    const anchorPolity = state.polities[faction.polityId]
    if (!anchorPolity || !anchorPolity.active) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `active Faction ${factionId} anchor polity ${faction.polityId} is not active (v0.42 F8)`,
      })
    }
    // byPolity index 同期 (byLeader I3 と同様)
    const indexed = state.factionIndex.byPolity[faction.polityId] ?? []
    if (!indexed.includes(factionId)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Faction ${factionId} is not in factionIndex.byPolity[${faction.polityId}] (v0.42 F8 index)`,
      })
    }
  }
  for (const [polityKey, factionIds] of Object.entries(state.factionIndex.byPolity)) {
    for (const fid of factionIds ?? []) {
      const f = state.factions[fid]
      if (!f) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `factionIndex.byPolity[${polityKey}] references missing Faction ${fid} (v0.42 F8 index)`,
        })
        continue
      }
      if ((f.polityId as string) !== polityKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `factionIndex.byPolity[${polityKey}] entry ${fid} has polityId=${f.polityId} (v0.42 F8 index)`,
        })
      }
    }
  }

  // v0.17 §21.5 Index: factionIndex は state.factions / state.factionMemberships と整合
  // I1: byLeader[personId] の全 FactionId は存在し leaderPersonId === personId
  // I2: byMember[personId] の全 FactionMembershipId は存在し personId === personId
  // I3: active Faction の leaderPersonId は byLeader にエントリ
  // I4: 各 FactionMembership は byMember にエントリ
  for (const [personKey, factionIds] of Object.entries(state.factionIndex.byLeader)) {
    for (const fid of factionIds ?? []) {
      const f = state.factions[fid]
      if (!f) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `factionIndex.byLeader[${personKey}] references missing Faction ${fid} (§21.5 I1)`,
        })
        continue
      }
      if ((f.leaderPersonId as string) !== personKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `factionIndex.byLeader[${personKey}] entry ${fid} has leaderPersonId=${f.leaderPersonId} (§21.5 I1)`,
        })
      }
    }
  }
  for (const [personKey, membershipIds] of Object.entries(state.factionIndex.byMember)) {
    for (const mid of membershipIds ?? []) {
      const m = state.factionMemberships[mid]
      if (!m) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `factionIndex.byMember[${personKey}] references missing FactionMembership ${mid} (§21.5 I2)`,
        })
        continue
      }
      if ((m.personId as string) !== personKey) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `factionIndex.byMember[${personKey}] entry ${mid} has personId=${m.personId} (§21.5 I2)`,
        })
      }
    }
  }
  for (const factionIdStr of Object.keys(state.factions)) {
    const factionId = factionIdStr as FactionId
    const f = state.factions[factionId]
    if (!f || !f.active) continue
    const indexed = state.factionIndex.byLeader[f.leaderPersonId] ?? []
    if (!indexed.includes(factionId)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `active Faction ${factionId} leader ${f.leaderPersonId} is not in factionIndex.byLeader (§21.5 I3)`,
      })
    }
  }
  for (const membershipIdStr of Object.keys(state.factionMemberships)) {
    const membershipId = membershipIdStr as FactionMembershipId
    const m = state.factionMemberships[membershipId]
    if (!m) continue
    const indexed = state.factionIndex.byMember[m.personId] ?? []
    if (!indexed.includes(membershipId)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `FactionMembership ${membershipId} (person=${m.personId}) is not in factionIndex.byMember (§21.5 I4)`,
      })
    }
  }

  // v0.32 §17: Clan 整合性チェック
  // C1: House.clanId → Clan 存在 + memberHouseIds に含まれる
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h) continue
    if (h.clanId !== undefined) {
      const clan = state.clans[h.clanId]
      if (!clan) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} has clanId=${h.clanId as string} but Clan not found (§17 C1)`,
        })
      } else if (!clan.memberHouseIds.includes(houseId)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} has clanId=${h.clanId as string} but not in Clan.memberHouseIds (§17 C1)`,
        })
      }
      // C7: system House は clanId を持ってはならない
      if (h.kind === 'system') {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `System House ${houseId} has clanId=${h.clanId as string} (§17 C7)`,
        })
      }
    }
  }
  // C2: Clan.memberHouseIds → House 存在 + house.clanId === clan.id
  for (const clanIdStr of Object.keys(state.clans)) {
    const clanId = clanIdStr as ClanId
    const clan = state.clans[clanId]
    if (!clan) continue
    for (const memberHouseId of clan.memberHouseIds) {
      const h = state.houses[memberHouseId]
      if (!h) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Clan ${clanId as string} memberHouseIds contains ${memberHouseId as string} but House not found (§17 C2)`,
        })
      } else if (h.clanId !== clanId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Clan ${clanId as string} memberHouseIds contains ${memberHouseId as string} but house.clanId=${h.clanId as string | undefined} (§17 C2)`,
        })
      }
    }
    // C3: rootHouseId 存在 + memberHouseIds に含まれる
    if (!state.houses[clan.rootHouseId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Clan ${clanId as string} rootHouseId=${clan.rootHouseId as string} not found (§17 C3)`,
      })
    } else if (!clan.memberHouseIds.includes(clan.rootHouseId)) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Clan ${clanId as string} rootHouseId=${clan.rootHouseId as string} not in memberHouseIds (§17 C3)`,
      })
    }
    // C4: nameSourceHouseId 存在 + v0.32 では === rootHouseId
    if (!state.houses[clan.nameSourceHouseId]) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Clan ${clanId as string} nameSourceHouseId=${clan.nameSourceHouseId as string} not found (§17 C4)`,
      })
    }
    if (clan.nameSourceHouseId !== clan.rootHouseId) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Clan ${clanId as string} nameSourceHouseId=${clan.nameSourceHouseId as string} !== rootHouseId=${clan.rootHouseId as string} (§17 C4)`,
      })
    }
    // C5: memberHouseIds に重複がない
    const memberSet = new Set(clan.memberHouseIds.map((id) => id as string))
    if (memberSet.size !== clan.memberHouseIds.length) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Clan ${clanId as string} memberHouseIds has duplicates (§17 C5)`,
      })
    }
  }
  // C6: clanId を持つ House の normal cadet は同じ clanId を持つべき
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h || h.clanId === undefined || h.kind === 'system') continue
    for (const cadetId of h.cadetHouseIds) {
      const cadet = state.houses[cadetId]
      if (!cadet || cadet.kind === 'system') continue
      if (cadet.clanId !== h.clanId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} clanId=${h.clanId as string} but cadet ${cadetId as string} has clanId=${cadet.clanId === undefined ? 'undefined' : (cadet.clanId as string)} (§17 C6)`,
        })
      }
    }
  }

  // v0.47 §19.4: parentHouseId ↔ cadetHouseIds 双方向整合 (House は絶家しても削除されず残るため
  //   存在検査は active を問わない)。
  for (const houseIdStr of Object.keys(state.houses)) {
    const houseId = houseIdStr as HouseId
    const h = state.houses[houseId]
    if (!h || h.kind === 'system') continue
    // forward: parentHouseId があれば parent が存在し、その cadetHouseIds に自分が含まれる
    if (h.parentHouseId !== undefined) {
      const parent = state.houses[h.parentHouseId]
      if (!parent) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `cadet House ${houseId} parentHouseId ${h.parentHouseId} does not exist (v0.47 §19.4)`,
        })
      } else if (!parent.cadetHouseIds.includes(houseId)) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `parent House ${h.parentHouseId} cadetHouseIds does not contain cadet ${houseId} (v0.47 §19.4)`,
        })
      }
    }
    // backward: cadetHouseIds の各 cadet が存在し、その parentHouseId が自分を指す
    for (const cadetId of h.cadetHouseIds) {
      const cadet = state.houses[cadetId]
      if (!cadet) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} cadetHouseIds references missing House ${cadetId} (v0.47 §19.4)`,
        })
      } else if (cadet.parentHouseId !== houseId) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `House ${houseId} lists cadet ${cadetId} but its parentHouseId=${cadet.parentHouseId ?? 'undefined'} (v0.47 §19.4)`,
        })
      }
    }
  }

  // v0.17 §21.2 O4: non-leader OfficeAssignment の startYear は currentYear 以下
  for (const officeId of Object.keys(state.officeAssignments)) {
    const office = state.officeAssignments[officeId as import('../types/ids').OfficeAssignmentId]
    if (!office || !office.active) continue
    if (office.role === 'leader') continue
    if (office.startYear > state.currentYear) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `OfficeAssignment ${officeId} startYear=${office.startYear} > currentYear=${state.currentYear} (§21.2 O4)`,
      })
    }
  }

  // v0.17 §21.3 D2: alive=true の Person は deathCircumstance を持たない
  // v0.17 §21.3 D3: 'faded_from_history' は normal Person のみ (placeholder 不可)
  for (const personIdStr of Object.keys(state.persons)) {
    const p = state.persons[personIdStr as PersonId]
    if (!p) continue
    if (p.alive && p.deathCircumstance !== undefined) {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Alive Person ${p.id} has deathCircumstance=${p.deathCircumstance} (§21.3 D2)`,
      })
    }
    if (p.deathCircumstance === 'faded_from_history' && p.kind === 'placeholder') {
      errors.push({
        code: 'INTEGRITY_VIOLATION',
        message: `Placeholder Person ${p.id} has deathCircumstance='faded_from_history' (§21.3 D3)`,
      })
    }
  }

  // §25 #2: root contract は rootAuthorityId を持ち ROOT_WORLD を指す
  // §25 #3: parent を持つ contract は rootAuthorityId を持たない
  for (const contractIdStr of Object.keys(state.landContracts)) {
    const c = state.landContracts[contractIdStr as LandContractId]
    if (!c) continue
    if (c.parentContractId === undefined) {
      if (c.rootAuthorityId !== ROOT_WORLD) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Root LandContract ${c.id} rootAuthorityId=${c.rootAuthorityId} expected ${ROOT_WORLD} (§25 #2)`,
        })
      }
    } else {
      if (c.rootAuthorityId !== undefined) {
        errors.push({
          code: 'INTEGRITY_VIOLATION',
          message: `Non-root LandContract ${c.id} has rootAuthorityId=${c.rootAuthorityId} (§25 #3)`,
        })
      }
    }
  }
}
