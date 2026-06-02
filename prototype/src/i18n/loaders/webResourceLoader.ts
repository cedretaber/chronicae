import YAML from 'yaml'
import type { I18nResourceLoader, LocaleCode } from '../types'
import { createResourceLoader } from './resourceLoaderFactory'

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

export function createWebResourceLoader(): I18nResourceLoader {
  // eslint-disable-next-line @typescript-eslint/require-await
  return createResourceLoader(async (locale: LocaleCode, relPath: string) =>
    parseYaml(yamlModules[`../locales/${locale}/${relPath}`]),
  )
}
