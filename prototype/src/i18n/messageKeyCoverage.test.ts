import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import YAML from 'yaml'

// sim 層が emit する literal messageKey は、すべて events.yaml (ja/en) で解決できなければならない。
//   解決できないと EventLog / Chronicle に raw キー (例: "house.founded") がそのまま表示される。
//   この退行は typecheck / lint / CLI smoke のどれでも捕まらない (CLI は raw event ログ・React 非経由)。
//   過去に house.founded / house.cadet_founded / project.sell_land.started が events.yaml 欠落で
//   raw 表示された実績があるため、source を走査して網羅的に保証する。
//   注: 動的キー (テンプレートリテラル `project.failed.${reason}`) は単一引用符リテラルでないので拾わない。
//       それらは defaultValue や個別テストの責務。ここは「literal messageKey の取りこぼし」を防ぐ。

const here = path.dirname(fileURLToPath(import.meta.url))
const simDir = path.resolve(here, '../sim')
const localesDir = path.resolve(here, 'locales')

function collectTsFiles(dir: string, acc: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) collectTsFiles(full, acc)
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) acc.push(full)
  }
  return acc
}

function collectLiteralMessageKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  const re = /messageKey:\s*'([^']+)'/g
  for (const file of collectTsFiles(simDir, [])) {
    const text = readFileSync(file, 'utf8')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const key = m[1]
      if (key && !keys.has(key)) keys.set(key, path.relative(simDir, file))
    }
  }
  return keys
}

function flattenKeys(obj: unknown, prefix: string, out: Set<string>): void {
  if (obj === null || typeof obj !== 'object') return
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flattenKeys(v, key, out)
    else out.add(key)
  }
}

function loadEventKeys(locale: string): Set<string> {
  const doc: unknown = YAML.parse(
    readFileSync(path.join(localesDir, locale, 'events.yaml'), 'utf8'),
  )
  const out = new Set<string>()
  flattenKeys(doc, '', out)
  return out
}

describe('event messageKey coverage', () => {
  it('every literal messageKey emitted in sim resolves in both ja and en events.yaml', () => {
    const emitted = collectLiteralMessageKeys()
    const ja = loadEventKeys('ja')
    const en = loadEventKeys('en')

    const missing: string[] = []
    for (const [key, file] of emitted) {
      if (!ja.has(key)) missing.push(`${key} (ja) <- ${file}`)
      if (!en.has(key)) missing.push(`${key} (en) <- ${file}`)
    }

    expect(emitted.size).toBeGreaterThan(0) // 走査が空振りしていないことの sanity check
    expect(missing).toEqual([])
  })
})
