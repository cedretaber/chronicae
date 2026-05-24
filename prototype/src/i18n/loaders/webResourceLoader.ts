import YAML from 'yaml'
import type {
  I18nResourceLoader,
  I18nResourceBundle,
  I18nNamespace,
  LocaleCode,
  NameCategory,
} from '../types'

const NAME_CATEGORIES: NameCategory[] = [
  'person',
  'house',
  'province',
  'polity',
  'holding',
  'state_region',
]

const ALL_NAMESPACES: I18nNamespace[] = [
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

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
const yamlModules = import.meta.glob('../locales/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function parseYaml(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined
  const parsed: unknown = YAML.parse(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
  }
  return undefined
}

function findModule(locale: LocaleCode, filePath: string): string | undefined {
  const key = `../locales/${locale}/${filePath}`
  return yamlModules[key]
}

export function createWebResourceLoader(): I18nResourceLoader {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async loadNamespaceResources(
      locale: LocaleCode,
      namespace: I18nNamespace,
    ): Promise<I18nResourceBundle | undefined> {
      return parseYaml(findModule(locale, `${namespace}.yaml`))
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async loadAllNamespaceResources(
      locale: LocaleCode,
    ): Promise<Partial<Record<I18nNamespace, I18nResourceBundle>>> {
      const result: Partial<Record<I18nNamespace, I18nResourceBundle>> = {}
      for (const ns of ALL_NAMESPACES) {
        const bundle = parseYaml(findModule(locale, `${ns}.yaml`))
        if (bundle) {
          result[ns] = bundle
        }
      }
      return result
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async loadNameTranslation(
      locale: LocaleCode,
      category: NameCategory,
    ): Promise<Record<string, string> | undefined> {
      const parsed = parseYaml(findModule(locale, `names/${category}.yaml`))
      if (!parsed) return undefined
      const result: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') result[k] = v
      }
      return result
    },

    async loadAllNameTranslations(
      locale: LocaleCode,
    ): Promise<Partial<Record<NameCategory, Record<string, string>>>> {
      const result: Partial<Record<NameCategory, Record<string, string>>> = {}
      for (const cat of NAME_CATEGORIES) {
        const trans = await this.loadNameTranslation(locale, cat)
        if (trans) result[cat] = trans
      }
      return result
    },
  }
}
