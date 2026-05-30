import { describe, it, expect, beforeAll } from 'vitest'
import i18next, { type i18n } from 'i18next'
import { createEventRenderer, type EventRenderer } from './eventRenderer'
import { createNameTranslator } from './nameTranslator'
import { createNodeResourceLoader } from './loaders/nodeResourceLoader'
import type { LocaleCode } from './types'
import type { EventMessageParams } from '@sim/types/event'

// v0.35 C-2b: battle event の enum ラベル解決を実 events.yaml で end-to-end 検証する。
//   CLI は i18n を描画しないため CLI smoke ではこの経路は検証されない。
//   eventRenderer は pure (i18n + nameTranslator のみ、React 非依存) なので vitest で直接テストできる。
//   実 yaml を node loader で読むことで「enum.<key>.<value> という 3 階層キーが events ns で解決するか」まで確かめる。
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

describe('eventRenderer battle enum localization (v0.35 C-2b)', () => {
  let ja: EventRenderer
  let en: EventRenderer
  beforeAll(async () => {
    ja = await buildRenderer('ja')
    en = await buildRenderer('en')
  })

  const battleParams: EventMessageParams = {
    province: 'TestProv',
    battlefieldKind: 'open_field',
    result: 'attacker_victory',
    warScoreDelta: 5,
  }

  it('resolves battlefieldKind / result labels to readable text (ja)', () => {
    const text = ja.render('war.battle_occurred', battleParams)
    expect(text).toContain('野戦')
    expect(text).toContain('攻撃側の勝利')
    expect(text).not.toContain('open_field')
    expect(text).not.toContain('attacker_victory')
  })

  it('resolves battlefieldKind / result labels to readable text (en)', () => {
    const text = en.render('war.battle_occurred', battleParams)
    expect(text).toContain('Field Battle')
    expect(text).toContain('Attacker Victory')
    expect(text).not.toContain('open_field')
    expect(text).not.toContain('attacker_victory')
  })

  it('resolves avoidingSide=both label', () => {
    const avoidParams: EventMessageParams = {
      province: 'TestProv',
      battlefieldKind: 'forest_battle',
      avoidingSide: 'both',
      warScoreDelta: 0,
    }
    expect(ja.render('war.battle_avoided', avoidParams)).toContain('両軍')
    // forest_battle ラベルは戦闘類型名「森林戦」(v0.35: 「{地名}で{類型}が発生」形式。terrain と非重複)。
    expect(ja.render('war.battle_avoided', avoidParams)).toContain('森林戦')
    expect(en.render('war.battle_avoided', avoidParams)).toContain('Both sides')
  })

  it('falls back to the raw enum string for an unknown value (safe degradation)', () => {
    const text = en.render('war.battle_occurred', {
      ...battleParams,
      battlefieldKind: 'made_up_kind',
    })
    expect(text).toContain('made_up_kind')
  })
})
