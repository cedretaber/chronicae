import fs from 'node:fs/promises'
import path from 'node:path'
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
  'intents',
  'decision_reasons',
  'perceptions',
]

function getLocalesDir(): string {
  return path.resolve(import.meta.dirname, '..', 'locales')
}

async function readYamlFile(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed: unknown = YAML.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return undefined
  } catch {
    return undefined
  }
}

export function createNodeResourceLoader(): I18nResourceLoader {
  const localesDir = getLocalesDir()

  return {
    async loadNamespaceResources(
      locale: LocaleCode,
      namespace: I18nNamespace,
    ): Promise<I18nResourceBundle | undefined> {
      return readYamlFile(path.join(localesDir, locale, `${namespace}.yaml`))
    },

    async loadAllNamespaceResources(
      locale: LocaleCode,
    ): Promise<Partial<Record<I18nNamespace, I18nResourceBundle>>> {
      const result: Partial<Record<I18nNamespace, I18nResourceBundle>> = {}
      for (const ns of ALL_NAMESPACES) {
        const bundle = await readYamlFile(path.join(localesDir, locale, `${ns}.yaml`))
        if (bundle) result[ns] = bundle
      }
      return result
    },

    async loadNameTranslation(
      locale: LocaleCode,
      category: NameCategory,
    ): Promise<Record<string, string> | undefined> {
      const parsed = await readYamlFile(path.join(localesDir, locale, 'names', `${category}.yaml`))
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
