import type {
  I18nResourceLoader,
  I18nResourceBundle,
  I18nNamespace,
  LocaleCode,
  NameCategory,
} from '../types'

/** 名前翻訳 (names/<category>.yaml) を読み込むカテゴリ。 */
export const NAME_CATEGORIES: NameCategory[] = [
  'person',
  'house',
  'province',
  'city',
  'polity',
  'holding',
  'state_region',
]

/** ロード対象の全ネームスペース。loader / createI18n で共有する。 */
export const ALL_NAMESPACES: I18nNamespace[] = [
  'ui',
  'entities',
  'roles',
  'events',
  'diplomacy',
  'statuses',
  'explain',
  'goals',
  'aims',
  'tasks',
  'decision_reasons',
  'perceptions',
]

/**
 * ロケール相対パス (例: `ui.yaml`, `names/person.yaml`) から YAML を読み、
 * オブジェクトを返す raw リーダー。環境ごと (web=import.meta.glob / node=fs) に実装が異なる。
 */
export type ReadResource = (
  locale: LocaleCode,
  relPath: string,
) => Promise<Record<string, unknown> | undefined>

/**
 * raw リーダーを差し込んで I18nResourceLoader を組み立てる共有ファクトリ。
 * web/node 間で唯一異なるのは「YAML をどう取得するか」だけなので、そこだけを注入する。
 */
export function createResourceLoader(readResource: ReadResource): I18nResourceLoader {
  async function loadNameTranslation(
    locale: LocaleCode,
    category: NameCategory,
  ): Promise<Record<string, string> | undefined> {
    const parsed = await readResource(locale, `names/${category}.yaml`)
    if (!parsed) return undefined
    const result: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') result[k] = v
    }
    return result
  }

  return {
    async loadNamespaceResources(
      locale: LocaleCode,
      namespace: I18nNamespace,
    ): Promise<I18nResourceBundle | undefined> {
      return readResource(locale, `${namespace}.yaml`)
    },

    async loadAllNamespaceResources(
      locale: LocaleCode,
    ): Promise<Partial<Record<I18nNamespace, I18nResourceBundle>>> {
      const result: Partial<Record<I18nNamespace, I18nResourceBundle>> = {}
      for (const ns of ALL_NAMESPACES) {
        const bundle = await readResource(locale, `${ns}.yaml`)
        if (bundle) result[ns] = bundle
      }
      return result
    },

    loadNameTranslation,

    async loadAllNameTranslations(
      locale: LocaleCode,
    ): Promise<Partial<Record<NameCategory, Record<string, string>>>> {
      const result: Partial<Record<NameCategory, Record<string, string>>> = {}
      for (const cat of NAME_CATEGORIES) {
        const trans = await loadNameTranslation(locale, cat)
        if (trans) result[cat] = trans
      }
      return result
    },
  }
}
