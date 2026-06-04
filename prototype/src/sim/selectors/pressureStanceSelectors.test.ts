import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity, withPerson } from '../testFixtures'
import type { WorldState } from '../types/world'
import type { PolityId, PersonId, HouseId, OfficeAssignmentId } from '../types/ids'
import { defaultConfig } from '../config/defaultConfig'
import { predictPressureResponseStance } from './pressureStanceSelectors'

// rank 2 の floor は 0 なので、家を結ばない polity の military power は adminPower * polityAdminMilitaryFactor。
// adminPower を振り分けて彼我戦力比のみで stance を制御する。
function setAdminPower(state: WorldState, id: PolityId, adminPower: number): WorldState {
  const p = state.polities[id]
  if (!p) return state
  return { ...state, polities: { ...state.polities, [id]: { ...p, adminPower } } }
}

// polity に leader 役職を持つ person を追加し、その性格 (ambition/caution) を意思決定者として登録する。
//   leader の house は state.houses に存在させないので polity の military power には影響しない。
function withPolityLeader(
  state: WorldState,
  polityId: PolityId,
  personId: PersonId,
  traits: { ambition: number; caution: number },
): WorldState {
  let s = withPerson(state, personId, {
    houseId: 'h-nonexistent' as HouseId,
    traits,
  })
  const officeId = ('oa-' + s.nextOfficeAssignmentId) as OfficeAssignmentId
  const orgKey = 'polity:' + polityId
  const holderKey = personId as string
  s = {
    ...s,
    officeAssignments: {
      ...s.officeAssignments,
      [officeId]: {
        id: officeId,
        organization: { kind: 'polity', id: polityId },
        role: 'leader',
        holderPersonId: personId,
        active: true,
        startYear: 1,
        unpaidCount: 0,
      },
    },
    officeIndex: {
      byOrganization: {
        ...s.officeIndex.byOrganization,
        [orgKey]: [...(s.officeIndex.byOrganization[orgKey] ?? []), officeId],
      },
      byHolderPerson: {
        ...s.officeIndex.byHolderPerson,
        [holderKey]: [...(s.officeIndex.byHolderPerson[holderKey] ?? []), officeId],
      },
    },
    nextOfficeAssignmentId: s.nextOfficeAssignmentId + 1,
  }
  return s
}

function build(
  sourceAdmin: number,
  targetAdmin: number,
): {
  state: WorldState
  source: PolityId
  target: PolityId
} {
  let s = makeEmptyV016State()
  const source = 'c-source' as PolityId
  const target = 'c-target' as PolityId
  s = withPolity(s, source, { rank: 2 })
  s = withPolity(s, target, { rank: 2 })
  s = setAdminPower(s, source, sourceAdmin)
  s = setAdminPower(s, target, targetAdmin)
  return { state: s, source, target }
}

describe('predictPressureResponseStance', () => {
  it('target が source の 0.5 倍未満 → concede (弱い相手は譲歩)', () => {
    const { state, source, target } = build(1000, 300) // 比 0.3
    expect(
      predictPressureResponseStance(
        state,
        defaultConfig,
        { kind: 'polity', id: source },
        {
          kind: 'polity',
          id: target,
        },
      ),
    ).toBe('concede')
  })

  it('target が source の 0.5〜1.2 倍 → negotiate (拮抗は交渉)', () => {
    const { state, source, target } = build(1000, 800) // 比 0.8
    expect(
      predictPressureResponseStance(
        state,
        defaultConfig,
        { kind: 'polity', id: source },
        {
          kind: 'polity',
          id: target,
        },
      ),
    ).toBe('negotiate')
  })

  it('target が source の 1.2 倍以上 → resist (強い相手は現状維持で押し切る)', () => {
    // これが開始ゲートで弾かれるケース: 弱い initiator が強い相手に圧力をかけても status_quo に終わる。
    const { state, source, target } = build(1000, 1500) // 比 1.5
    expect(
      predictPressureResponseStance(
        state,
        defaultConfig,
        { kind: 'polity', id: source },
        {
          kind: 'polity',
          id: target,
        },
      ),
    ).toBe('resist')
  })

  it('境界: ちょうど 1.2 倍は resist (>= 判定)', () => {
    const { state, source, target } = build(1000, 1200) // 比 1.2
    expect(
      predictPressureResponseStance(
        state,
        defaultConfig,
        { kind: 'polity', id: source },
        {
          kind: 'polity',
          id: target,
        },
      ),
    ).toBe('resist')
  })
})

describe('predictPressureResponseStance — 性格シフト (v0.42)', () => {
  // 比 1.15 (resist 境界 1.2 の直下) は中立なら negotiate。大胆な target はここで resist に振れる。
  it('大胆な target (ambition高/caution低) は不利でない圧力を拒否しやすい (1.15→resist)', () => {
    const { state, source, target } = build(1000, 1150) // 比 1.15
    const s = withPolityLeader(state, target, 'pe-bold' as PersonId, {
      ambition: 1.0,
      caution: 0.0,
    })
    // shift = 0.5*0.1 - (-0.5)*0.1 = 0.1 → resistRatio 1.1。比 1.15 ≥ 1.1 → resist。
    expect(
      predictPressureResponseStance(
        s,
        defaultConfig,
        { kind: 'polity', id: source },
        { kind: 'polity', id: target },
      ),
    ).toBe('resist')
  })

  it('同じ 1.15 でも中立な target は negotiate のまま', () => {
    const { state, source, target } = build(1000, 1150)
    const s = withPolityLeader(state, target, 'pe-neutral' as PersonId, {
      ambition: 0.5,
      caution: 0.5,
    })
    expect(
      predictPressureResponseStance(
        s,
        defaultConfig,
        { kind: 'polity', id: source },
        { kind: 'polity', id: target },
      ),
    ).toBe('negotiate')
  })

  // 比 0.55 (concede 境界 0.5 の直上) は中立なら negotiate。慎重な target はここで concede に振れる。
  it('慎重な target (caution高/ambition低) は早めに譲歩する (0.55→concede)', () => {
    const { state, source, target } = build(1000, 550) // 比 0.55
    const s = withPolityLeader(state, target, 'pe-cautious' as PersonId, {
      ambition: 0.0,
      caution: 1.0,
    })
    // shift = -0.05 - 0.05 = -0.1 → concedeRatio 0.6。比 0.55 < 0.6 → concede。
    expect(
      predictPressureResponseStance(
        s,
        defaultConfig,
        { kind: 'polity', id: source },
        { kind: 'polity', id: target },
      ),
    ).toBe('concede')
  })

  it('personAbilityEffectsEnabled OFF なら性格を無視 (大胆な target でも 1.15→negotiate)', () => {
    const { state, source, target } = build(1000, 1150)
    const s = withPolityLeader(state, target, 'pe-bold' as PersonId, {
      ambition: 1.0,
      caution: 0.0,
    })
    const config = { ...defaultConfig, personAbilityEffectsEnabled: false }
    expect(
      predictPressureResponseStance(
        s,
        config,
        { kind: 'polity', id: source },
        {
          kind: 'polity',
          id: target,
        },
      ),
    ).toBe('negotiate')
  })
})
