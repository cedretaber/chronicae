import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import YAML from 'yaml'
import { createEventRenderer } from '../../i18n/eventRenderer'
import { createNameTranslator } from '../../i18n/nameTranslator'
import type { EventMessageParams } from '@sim/types/event'
import type { NameCategory } from '../../i18n/types'

const NAME_CATEGORIES: NameCategory[] = [
  'person',
  'house',
  'province',
  'polity',
  'holding',
  'state_region',
]

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
const nameYamlModules = import.meta.glob('../../i18n/locales/*/names/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function loadNamesForLocale(locale: string): Record<string, Record<string, string>> {
  const data: Record<string, Record<string, string>> = {}
  for (const cat of NAME_CATEGORIES) {
    const key = `../../i18n/locales/${locale}/names/${cat}.yaml`
    const raw = nameYamlModules[key]
    if (!raw) continue
    const parsed: unknown = YAML.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const result: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') result[k] = v
      }
      data[cat] = result
    }
  }
  return data
}

const nameCache = new Map<string, Record<string, Record<string, string>>>()

function getCachedNames(locale: string): Record<string, Record<string, string>> {
  let cached = nameCache.get(locale)
  if (!cached) {
    cached = loadNamesForLocale(locale)
    nameCache.set(locale, cached)
  }
  return cached
}

export function useRenderEvent(): (event: {
  messageKey: string
  messageParams: EventMessageParams
}) => string {
  const { i18n } = useTranslation()
  const locale = i18n.language

  return useMemo(() => {
    const localeNames = getCachedNames(locale)
    const fallbackNames = locale !== 'en' ? getCachedNames('en') : undefined
    const nameTranslator = createNameTranslator(localeNames, fallbackNames)
    const renderer = createEventRenderer(i18n, nameTranslator)
    return (event: { messageKey: string; messageParams: EventMessageParams }) =>
      renderer.render(event.messageKey, event.messageParams)
  }, [locale, i18n])
}
