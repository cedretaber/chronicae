import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { tick } from '@sim/tick/tick'
import { generateWorld } from '@sim/worldgen/generateWorld'
import { defaultConfig } from '@sim/config/defaultConfig'

/**
 * イベントメッセージの「翻訳 placeholder」と「emit 側 messageParams」の整合を守る回帰テスト。
 *
 * eventRenderer は `{{name}}` を messageParams[name] で置換し、未定義なら `{{name}}` をそのまま
 * 残す（= ログが壊れて見える）。messageParams は緩い Record 型なので、emit 側で placeholder 名を
 * typo / リネームしてもコンパイルでは捕まらない（実際 house.split / owner_changed_extinction が
 * fromHouse/toHouse のまま放置されていた）。本テストでその drift を静的に検出する。
 *
 * 検査対象: createSimEvent / emitEvent に messageParams を **object literal で直接** 渡している
 * emit site。messageParams を変数で組み立てている site は静的抽出できないため、目視確認済みの
 * key のみ ALLOW_DYNAMIC_PARAMS に明記する（隠さず可視化する）。messageKey を動的生成している
 * 経路や汎用 helper 経由の emit は本テストの対象外（静的抽出の限界。コメントで明示）。
 */

const i18nDir = fileURLToPath(new URL('.', import.meta.url))
const simDir = fileURLToPath(new URL('../sim', import.meta.url))

// messageParams を変数で構築しており静的抽出できないが、定義を目視確認済みの messageKey。
// 追加する際は emit 側の変数定義が当該 key の placeholder をすべて満たすことを必ず確認すること。
// - regiment.reformed: regimentReinforcementSystem.ts で { owner, province } を構築（placeholder と一致）
// - supply.attrition: warSupplySystem.ts で { side, supplyPressure, strengthDamage, organizationDamage, moraleDamage, collapsedRegimentCount } を構築
const ALLOW_DYNAMIC_PARAMS = new Set<string>(['regiment.reformed', 'supply.attrition'])

function flatten(obj: unknown, prefix: string, out: Record<string, string[]>): void {
  if (!obj || typeof obj !== 'object') return
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') {
      out[key] = [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] as string)
    } else if (v && typeof v === 'object') {
      flatten(v, key, out)
    }
  }
}

function placeholdersByKey(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const loc of ['ja', 'en']) {
    const doc: unknown = parseYaml(readFileSync(`${i18nDir}locales/${loc}/events.yaml`, 'utf8'))
    const flat: Record<string, string[]> = {}
    flatten(doc, '', flat)
    for (const [k, phs] of Object.entries(flat)) {
      if (!map.has(k)) map.set(k, new Set())
      const set = map.get(k)!
      for (const p of phs) set.add(p)
    }
  }
  return map
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) return walk(p)
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
  })
}

// messageParams object literal の body から depth-0 の key を抽出（`key: value` と shorthand `key,` 両対応）。
function topLevelKeys(body: string): Set<string> {
  const keys = new Set<string>()
  let depth = 0
  for (const ln of body.split('\n')) {
    const m = /^\s*(\w+)\s*(?::|,\s*$|$)/.exec(ln)
    if (m && depth === 0) keys.add(m[1] as string)
    for (const c of ln) {
      if (c === '{' || c === '(' || c === '[') depth++
      else if (c === '}' || c === ')' || c === ']') depth--
    }
  }
  return keys
}

type EmitSite = { key: string; params: Set<string> | null; file: string }

function emitSites(): EmitSite[] {
  const sites: EmitSite[] = []
  for (const file of walk(simDir)) {
    const txt = readFileSync(file, 'utf8')
    const re = /messageKey:\s*['"`]([^'"`]+)['"`]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(txt))) {
      const key = m[1] as string
      const win = txt.slice(Math.max(0, m.index - 250), m.index + 900)
      const pmIdx = win.search(/messageParams:\s*\{/)
      let params: Set<string> | null = null
      if (pmIdx >= 0) {
        const start = win.indexOf('{', pmIdx)
        let depth = 0
        let end = -1
        for (let i = start; i < win.length; i++) {
          if (win[i] === '{') depth++
          else if (win[i] === '}') {
            depth--
            if (depth === 0) {
              end = i
              break
            }
          }
        }
        if (end > start) params = topLevelKeys(win.slice(start + 1, end))
      }
      sites.push({ key, params, file: file.replace(`${simDir}/`, '') })
    }
  }
  return sites
}

describe('event messageParams cover translation placeholders', () => {
  it('every direct-literal emit site provides all placeholders its messageKey needs', () => {
    const ph = placeholdersByKey()
    const sites = emitSites()
    const failures: string[] = []

    for (const s of sites) {
      const need = ph.get(s.key)
      if (!need || need.size === 0) continue
      if (s.params === null) {
        // messageParams が変数構築 — 静的抽出不能。許可リスト外なら手動確認を促して fail。
        if (!ALLOW_DYNAMIC_PARAMS.has(s.key)) {
          failures.push(
            `${s.key}: messageParams built dynamically @ ${s.file} — verify it provides [${[...need].join(', ')}] then add to ALLOW_DYNAMIC_PARAMS`,
          )
        }
        continue
      }
      const missing = [...need].filter((p) => !s.params!.has(p))
      if (missing.length > 0) {
        failures.push(
          `${s.key}: missing param(s) [${missing.join(', ')}] (provides [${[...s.params].join(', ')}]) @ ${s.file}`,
        )
      }
    }

    expect(failures, `\nmessageParams/placeholder mismatch:\n${failures.join('\n')}\n`).toEqual([])
  })

  it('audit covers a meaningful number of emit sites (guards against extraction regressions)', () => {
    // 抽出が壊れて 0 件になると上のテストが空振りで pass してしまうため下限を置く。
    const direct = emitSites().filter((s) => s.params !== null)
    expect(direct.length).toBeGreaterThan(30)
  })
})

/**
 * 静的解析の死角（動的 messageKey の三項分岐・template literal・helper 経由 emit）を埋める
 * runtime 監査。実際に tick を回し、**発火した**全イベントについて
 * 翻訳 placeholder ⊆ Object.keys(messageParams) を検査する（render 不要で生 key/params を見る）。
 * これにより diplomatic_play / war / conflict など動的 key の subsystem も実発火分を網羅する。
 * 注: 短期 run で発火しない稀少イベント（長期戦争など）は CLI 長期 multi-seed 監査で別途確認する。
 */
describe('fired-event messageParams cover translation placeholders (runtime)', () => {
  it('no event emitted over 40y x 2 seeds is missing a needed placeholder', () => {
    const ph = placeholdersByKey()
    const failures = new Map<string, string>()
    for (const seed of ['1', '42']) {
      const gen = generateWorld(seed)
      let state = gen.world
      let rng = gen.rng
      for (let i = 0; i < 40 * 48; i++) {
        const res = tick({ state, rng, config: defaultConfig })
        state = res.state
        rng = res.rng
        for (const e of res.events) {
          const need = ph.get(e.messageKey)
          if (!need || need.size === 0) continue
          const have = new Set(Object.keys(e.messageParams ?? {}))
          const missing = [...need].filter((p) => !have.has(p))
          if (missing.length > 0 && !failures.has(e.messageKey)) {
            failures.set(
              e.messageKey,
              `${e.messageKey}: missing [${missing.join(', ')}] (provides [${[...have].join(', ')}]) @ seed ${seed} year ${state.currentYear}`,
            )
          }
        }
      }
    }
    expect(
      [...failures.values()],
      `\nfired events missing placeholders:\n${[...failures.values()].join('\n')}\n`,
    ).toEqual([])
  }, 120000)
})
