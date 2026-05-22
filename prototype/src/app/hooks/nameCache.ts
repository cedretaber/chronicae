import YAML from 'yaml'
import type { NameCategory } from '../../i18n/types'

const NAME_CATEGORIES: NameCategory[] = [
  'person',
  'house',
  'province',
  'polity',
  'holding',
  'state_region',
  'role',
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

const cache = new Map<string, Record<string, Record<string, string>>>()

export function getCachedNames(locale: string): Record<string, Record<string, string>> {
  let cached = cache.get(locale)
  if (!cached) {
    cached = loadNamesForLocale(locale)
    cache.set(locale, cached)
  }
  return cached
}
