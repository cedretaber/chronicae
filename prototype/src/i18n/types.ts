export type LocaleCode = 'en' | 'ja'

export type I18nNamespace =
  | 'ui'
  | 'entities'
  | 'roles'
  | 'events'
  | 'diplomacy'
  | 'statuses'
  | 'explain'
  | 'goals'
  | 'aims'
  | 'intents'
  | 'decision_reasons'
  | 'perceptions'

export type NameCategory =
  | 'person'
  | 'house'
  | 'province'
  | 'polity'
  | 'holding'
  | 'state_region'
  | 'role'

export type I18nResourceBundle = Record<string, unknown>

export type I18nResourceLoader = {
  loadNamespaceResources(
    locale: LocaleCode,
    namespace: I18nNamespace,
  ): Promise<I18nResourceBundle | undefined>

  loadAllNamespaceResources(
    locale: LocaleCode,
  ): Promise<Partial<Record<I18nNamespace, I18nResourceBundle>>>

  loadNameTranslation(
    locale: LocaleCode,
    category: NameCategory,
  ): Promise<Record<string, string> | undefined>

  loadAllNameTranslations(
    locale: LocaleCode,
  ): Promise<Partial<Record<NameCategory, Record<string, string>>>>
}
