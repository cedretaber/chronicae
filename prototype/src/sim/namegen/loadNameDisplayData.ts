import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import type { NameDisplayData } from './nameDisplayResolver'

const CATEGORIES = ['person', 'house', 'province', 'polity', 'state_region', 'holding']

export function loadNameDisplayData(localesDir?: string): NameDisplayData {
  const dir = localesDir ?? path.resolve(import.meta.dirname, '../../i18n/locales')
  const data: NameDisplayData = {}
  for (const cat of CATEGORIES) {
    const filePath = path.join(dir, 'en', 'names', `${cat}.yaml`)
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed: unknown = YAML.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const result: Record<string, string> = {}
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string') result[k] = v
        }
        data[cat] = result
      }
    } catch {
      // File not found or parse error — skip
    }
  }
  return data
}
