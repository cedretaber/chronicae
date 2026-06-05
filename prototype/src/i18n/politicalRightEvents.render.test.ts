// v0.42 §17/§20: POLITICAL_RIGHT_* イベントの emit→render end-to-end 検証。
//
// 新 EventType は default preset で発火しないと runtime 検査網にかからない (v0.42 既知の罠)。
// 特に TRANSFERRED は v0.42 に通常発火経路が存在しない (争奪・剥奪は future) ため、
// この durable unit test が唯一の placeholder 健全性検証になる。
// 実 events.yaml (ja/en) を node loader で読み、enum ラベル (rightKind / revokeReason) の
// 解決と '{{' 残置なしを 3 イベント × 3 target kind で固定する。

import { describe, it, expect, beforeAll } from 'vitest'
import i18next, { type i18n } from 'i18next'
import { createEventRenderer, type EventRenderer } from './eventRenderer'
import { createNameTranslator } from './nameTranslator'
import { createNodeResourceLoader } from './loaders/nodeResourceLoader'
import type { LocaleCode } from './types'
import type { TickContext } from '@sim/tick/context'
import type { WorldState } from '@sim/types/world'
import type { Regiment } from '@sim/types/regiment'
import type { HoldingId } from '@sim/types/ids'
import { createPersonId, createHouseId, createPolityId, createRegimentId } from '@sim/types/ids'
import type { PoliticalRightTargetRef } from '@sim/types/politicalRight'
import { createPoliticalRight } from '@sim/mutations/politicalRightMutations'
import {
  emitPoliticalRightGranted,
  emitPoliticalRightRevoked,
  emitPoliticalRightTransferred,
} from '@sim/tick/politicalRightEvents'
import { createRng } from '@sim/rng/rng'
import { defaultConfig } from '@sim/config/defaultConfig'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withHolding,
  withProvince,
} from '@sim/testFixtures'

async function buildRenderer(locale: LocaleCode): Promise<EventRenderer> {
  const loader = createNodeResourceLoader()
  const bundles = await loader.loadAllNamespaceResources(locale)
  const inst: i18n = i18next.createInstance()
  await inst.init({
    lng: locale,
    fallbackLng: 'en',
    ns: ['events'],
    defaultNS: 'events',
    resources: { [locale]: bundles },
    interpolation: { escapeValue: false },
  })
  return createEventRenderer(inst, createNameTranslator({}, undefined))
}

const polityId = createPolityId('c', 0)
const houseId = createHouseId('h', 0)
const personId = createPersonId('pe', 0)
const holdingId = 'hl-0' as HoldingId
const regimentId = createRegimentId(0)
const provinceId = 'pr-0' as Parameters<typeof withProvince>[1]

function makeFixture(): WorldState {
  let state = makeEmptyV016State()
  state = withProvince(state, provinceId)
  state = withHouse(state, houseId, { nameKey: 'Altenmark' })
  state = withPerson(state, personId, { houseId, nameKey: 'Albrecht' })
  state = withPolity(state, polityId, { ownerHouseId: houseId })
  state = withHolding(state, holdingId, provinceId, { nameKey: 'Frostwick Manor' })
  const regiment: Regiment = {
    id: regimentId,
    owner: { kind: 'polity', id: polityId },
    status: 'active',
    sourceKind: 'levy',
    troopKind: 'infantry',
    strength: 100,
    organization: 50,
    morale: 30,
    maxStrength: 100,
    basePower: 10,
    baselineOrganization: 50,
    maxOrganization: 100,
    baselineMorale: 30,
    maxMorale: 100,
    createdWeek: 0,
    homeProvinceId: provinceId,
    homeHoldingId: holdingId,
  }
  return {
    ...state,
    holdingTerminalPolityCache: { ...state.holdingTerminalPolityCache, [holdingId]: polityId },
    regiments: { [regimentId]: regiment },
    regimentIndex: {
      ...state.regimentIndex,
      byOwner: { [`polity:${polityId}`]: [regimentId] },
    },
  }
}

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextPolityIndex: 10,
  }
}

const TARGETS: { label: string; target: PoliticalRightTargetRef }[] = [
  {
    label: 'office',
    target: { kind: 'polity_office_role', polityId, role: 'administrator', slotIndex: 0 },
  },
  { label: 'holding', target: { kind: 'holding_office_role', holdingId, role: 'bailiff' } },
  { label: 'regiment', target: { kind: 'regiment', regimentId } },
]

describe('political right events emit → render (v0.42 §17)', () => {
  let ja: EventRenderer
  let en: EventRenderer
  beforeAll(async () => {
    ja = await buildRenderer('ja')
    en = await buildRenderer('en')
  })

  for (const { label, target } of TARGETS) {
    it(`renders GRANTED / REVOKED / TRANSFERRED without raw placeholders (${label} target)`, () => {
      const base = makeFixture()
      const created = createPoliticalRight(base, {
        polityId,
        target,
        holder: { kind: 'house', id: houseId },
        grantedWeek: 100,
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      const right = created.value.right
      let ctx = makeCtx(created.value.state)

      ctx = emitPoliticalRightGranted(ctx, right)
      ctx = emitPoliticalRightRevoked(ctx, right, 'regime_change')
      ctx = emitPoliticalRightTransferred(ctx, right)
      expect(ctx.events.map((e) => e.type)).toEqual([
        'POLITICAL_RIGHT_GRANTED',
        'POLITICAL_RIGHT_REVOKED',
        'POLITICAL_RIGHT_TRANSFERRED',
      ])

      for (const event of ctx.events) {
        for (const renderer of [ja, en]) {
          const text = renderer.render(event.messageKey, event.messageParams)
          expect(text, `${event.messageKey} (${label})`).not.toContain('{{')
          // enum 値が raw のまま出ていないこと
          expect(text).not.toContain('polity_office_appointment')
          expect(text).not.toContain('holding_office_appointment')
          expect(text).not.toContain('regiment_control')
          expect(text).not.toContain('regime_change')
        }
        // raw ID が params に入っていないこと (§17.2 — ID は entityRefs)
        for (const v of Object.values(event.messageParams)) {
          if (typeof v === 'string') {
            expect(v).not.toMatch(/^(prg|c|h|pe|hl|rg)-\d+$/)
          }
        }
        // entityRefs: holder + polity (+ target entity)
        expect(event.entityRefs.some((r) => r.role === 'right_holder')).toBe(true)
        expect(event.entityRefs.some((r) => r.kind === 'polity')).toBe(true)
      }

      // enum ラベルの解決を spot-check (ja)
      const grantedJa = ja.render(ctx.events[0]!.messageKey, ctx.events[0]!.messageParams)
      if (label === 'office') expect(grantedJa).toContain('任命権')
      if (label === 'holding') expect(grantedJa).toContain('代官任命権')
      if (label === 'regiment') expect(grantedJa).toContain('連隊管理権')
      const revokedJa = ja.render(ctx.events[1]!.messageKey, ctx.events[1]!.messageParams)
      expect(revokedJa).toContain('支配体制の交代')
    })
  }
})
