import i18next, { type Resource } from 'i18next'
import type { i18n } from 'i18next'
import type { LocaleCode, I18nResourceLoader, I18nNamespace } from './types'

export type CreateI18nOptions = {
  locale: LocaleCode
  fallbackLocale: LocaleCode
  resourceLoader: I18nResourceLoader
  preloadLocales?: LocaleCode[]
}

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

export async function createChronicaeI18n(options: CreateI18nOptions): Promise<i18n> {
  const { locale, fallbackLocale, resourceLoader } = options

  const localeSet = new Set<LocaleCode>([locale, fallbackLocale, ...(options.preloadLocales ?? [])])
  const localesToLoad: LocaleCode[] = [...localeSet]

  const resources: Record<string, Record<string, unknown>> = {}

  for (const loc of localesToLoad) {
    resources[loc] = {}
    const nsResources = await resourceLoader.loadAllNamespaceResources(loc)
    for (const ns of ALL_NAMESPACES) {
      const bundle = nsResources[ns]
      if (bundle) {
        resources[loc][ns] = bundle
      }
    }
  }

  await i18next.init({
    lng: locale,
    fallbackLng: fallbackLocale,
    ns: ALL_NAMESPACES,
    defaultNS: 'ui',
    resources: resources as Resource,
    interpolation: {
      escapeValue: false,
    },
  })

  return i18next
}
