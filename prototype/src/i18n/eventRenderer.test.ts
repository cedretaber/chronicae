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
    winnerName: 'Albrecht',
    attackerName: 'Albrecht',
    defenderName: 'Balthazar',
    attackerRegimentCount: 5,
    defenderRegimentCount: 4,
    ticksElapsed: 3,
    outcomeQuality: 'rout',
    attackerRoutedCount: 0,
    defenderRoutedCount: 2,
    warScoreDelta: 5,
  }

  it('resolves battlefieldKind and name params to readable text (ja)', () => {
    const text = ja.render('war.battle_occurred', battleParams)
    expect(text).toContain('野戦')
    expect(text).toContain('Albrecht')
    expect(text).not.toContain('open_field')
    expect(text).not.toContain('{{')
  })

  it('resolves battlefieldKind and name params to readable text (en)', () => {
    const text = en.render('war.battle_occurred', battleParams)
    expect(text).toContain('Field Battle')
    expect(text).toContain('Albrecht')
    expect(text).not.toContain('open_field')
    expect(text).not.toContain('{{')
  })

  it('resolves battle_avoided_both template', () => {
    const avoidParams: EventMessageParams = {
      province: 'TestProv',
      battlefieldKind: 'forest_battle',
      warScoreDelta: 0,
    }
    // war.battle_avoided_both: 「両軍が…を回避した」(ja) / 「Both sides avoided…」(en)
    expect(ja.render('war.battle_avoided_both', avoidParams)).toContain('両軍')
    expect(ja.render('war.battle_avoided_both', avoidParams)).toContain('森林戦')
    expect(en.render('war.battle_avoided_both', avoidParams)).toContain('Both sides')
  })

  it('resolves outcomeQuality label and fills all v0.37 battle summary params (ja/en, C2)', () => {
    const params: EventMessageParams = {
      province: 'TestProv',
      battlefieldKind: 'open_field',
      attackerRegimentCount: 5,
      defenderRegimentCount: 4,
      ticksElapsed: 3,
      result: 'attacker_victory',
      winnerName: 'Albrecht',
      attackerName: 'Albrecht',
      defenderName: 'Balthazar',
      outcomeQuality: 'rout',
      attackerRoutedCount: 0,
      defenderRoutedCount: 2,
      warScoreDelta: 8,
    }
    const jaText = ja.render('war.battle_occurred', params)
    expect(jaText).toContain('敗走') // outcomeQuality=rout のラベル
    expect(jaText).not.toContain('{{') // 全 placeholder 解決済 (param 欠落なし)

    const enText = en.render('war.battle_occurred', params)
    expect(enText).toContain('rout') // en の rout ラベルは 'rout'
    expect(enText).not.toContain('{{')
  })

  it('falls back to the raw enum string for an unknown value (safe degradation)', () => {
    const text = en.render('war.battle_occurred', {
      ...battleParams,
      battlefieldKind: 'made_up_kind',
    })
    expect(text).toContain('made_up_kind')
  })
})

// v0.38: chronicle 専用 i18n キーが実 yaml で解決するか end-to-end 検証する。
//   battle narrative (events ns) と category badge (ui ns) は CLI / unit test / npm check の
//   どの自動経路も通らない (CLI は raw event ログ、unit test は projection の構造のみ)。
//   解決失敗時の挙動: narrative は raw キー文字列、badge は `chronicle.category.war` に化ける退行。
async function buildChronicleI18n(
  locale: LocaleCode,
): Promise<{ renderer: EventRenderer; inst: i18n }> {
  const loader = createNodeResourceLoader()
  const bundles = await loader.loadAllNamespaceResources(locale)
  const inst: i18n = i18next.createInstance()
  await inst.init({
    lng: locale,
    fallbackLng: 'en',
    ns: ['events', 'ui'],
    defaultNS: 'events',
    resources: { [locale]: bundles },
    interpolation: { escapeValue: false },
  })
  return { renderer: createEventRenderer(inst, createNameTranslator({}, undefined)), inst }
}

describe('v0.38 chronicle i18n keys resolve (battle narrative + category badge)', () => {
  let jaR: EventRenderer
  let enR: EventRenderer
  let jaInst: i18n
  let enInst: i18n
  beforeAll(async () => {
    const ja = await buildChronicleI18n('ja')
    const en = await buildChronicleI18n('en')
    jaR = ja.renderer
    enR = en.renderer
    jaInst = ja.inst
    enInst = en.inst
  })

  const narrativeParams: EventMessageParams = {
    province: 'TestProv',
    battlefieldKind: 'open_field',
    winnerName: 'Albrecht',
    attackerName: 'Albrecht',
    defenderName: 'Balthazar',
    attackerRegimentCount: 3,
    defenderRegimentCount: 6,
    result: 'attacker_victory',
    attackerRoutedCount: 1,
    defenderRoutedCount: 4,
    ticksElapsed: 3,
    warScoreDelta: 7,
  }

  const narrativeKeys = [
    'chronicle.battle.outnumbered_victory',
    'chronicle.battle.decisive_victory',
    'chronicle.battle.narrow_victory',
  ]
  for (const key of narrativeKeys) {
    it(`renders ${key} (no raw key, no unresolved placeholder, enum resolved)`, () => {
      const jaText = jaR.render(key, narrativeParams)
      expect(jaText).not.toBe(key) // 解決した (未解決なら defaultValue=messageKey が返る)
      expect(jaText).not.toContain('{{') // 全 placeholder 解決
      expect(jaText).not.toContain('open_field') // battlefieldKind enum ラベル解決
      expect(jaText).not.toContain('attacker_victory') // result enum ラベル解決

      const enText = enR.render(key, narrativeParams)
      expect(enText).not.toBe(key)
      expect(enText).not.toContain('{{')
    })
  }

  const categories = [
    'war',
    'battle',
    'land',
    'house',
    'office',
    'faction',
    'revolt',
    'life',
    'development',
    'governance',
    'disaster',
  ]
  it('resolves chronicle.category.* badge labels in the ui namespace (no raw-key regression)', () => {
    expect(jaInst.t('chronicle.category.war', { ns: 'ui' })).toBe('戦争')
    expect(jaInst.t('chronicle.category.office', { ns: 'ui' })).toBe('任官')
    expect(jaInst.t('chronicle.category.faction', { ns: 'ui' })).toBe('派閥')
    expect(enInst.t('chronicle.category.war', { ns: 'ui' })).toBe('War')
    expect(enInst.t('chronicle.category.faction', { ns: 'ui' })).toBe('Faction')
    for (const cat of categories) {
      const key = `chronicle.category.${cat}`
      expect(jaInst.t(key, { ns: 'ui' })).not.toBe(key)
      expect(enInst.t(key, { ns: 'ui' })).not.toBe(key)
    }
  })

  // EntityChronicleSection の section title は detail.<kind>.chronicle (ui ns)。
  //   過去に detail.person.chronicle が play ブロックへ誤配置され raw キーが表示される退行があった。
  //   全 6 kind の title が ui ns で解決することを固定し、再発を防ぐ。
  it('resolves all six detail.<kind>.chronicle section titles in the ui namespace', () => {
    const kinds = ['polity', 'house', 'person', 'holding', 'province', 'war']
    for (const kind of kinds) {
      const key = `detail.${kind}.chronicle`
      expect(jaInst.t(key, { ns: 'ui' })).not.toBe(key)
      expect(enInst.t(key, { ns: 'ui' })).not.toBe(key)
    }
  })

  // v0.38 Phase 3 追補: faction event を chronicle 化したので、その messageKey が実 emit params で
  //   クリーンに解決するか検証する。leader-centric reword 前は {{faction}} が emit params に無く
  //   literal 表示される既存バグがあった (EventLog も同様)。emit params を模した値で未解決が無いことを固定。
  it('renders all faction.* event templates cleanly with their emitted params (no unresolved placeholder)', () => {
    const cases: { key: string; params: EventMessageParams }[] = [
      { key: 'faction.founded', params: { person: 'Albert' } },
      // reason は enum コード (enum.factionDissolveReason.* で解決)
      { key: 'faction.dissolved', params: { leader: 'Albert', reason: 'leader_died' } },
      { key: 'faction.leader_changed', params: { newLeader: 'Berna', oldLeader: 'Albert' } },
      { key: 'faction.leader_bankrupt', params: { person: 'Albert' } },
      { key: 'faction.member_recruited', params: { person: 'Kai', leader: 'Albert' } },
      { key: 'faction.member_abandoned', params: { person: 'Kai', leader: 'Albert' } },
      { key: 'faction.funds_shortage', params: { person: 'Albert' } },
    ]
    for (const { key, params } of cases) {
      const jaText = jaR.render(key, params)
      expect(jaText).not.toBe(key)
      expect(jaText).not.toContain('{{')
      const enText = enR.render(key, params)
      expect(enText).not.toBe(key)
      expect(enText).not.toContain('{{')
    }
  })
})
