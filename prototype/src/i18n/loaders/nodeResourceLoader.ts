import fs from 'node:fs/promises'
import path from 'node:path'
import YAML from 'yaml'
import type { I18nResourceLoader, LocaleCode } from '../types'
import { createResourceLoader } from './resourceLoaderFactory'

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
  return createResourceLoader((locale: LocaleCode, relPath: string) =>
    readYamlFile(path.join(localesDir, locale, relPath)),
  )
}
