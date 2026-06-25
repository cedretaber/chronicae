import { appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ChronicleWriter } from '@sim/chronicle/chronicleStore'
import type { ChronicleEntry } from '@sim/types/chronicle'

export function createChronicleFileWriter(opts: {
  seed: string
  dir: string
  tag?: string
}): ChronicleWriter & { filePath: string } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
  const parts = ['chronicle', timestamp, `seed${opts.seed}`]
  if (opts.tag) parts.push(opts.tag)
  const fileName = parts.join('-') + '.jsonl'
  const filePath = path.resolve(opts.dir, fileName)

  writeFileSync(filePath, '', 'utf8')

  return {
    filePath,
    append(entries: ChronicleEntry[]): void {
      if (entries.length === 0) return
      const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
      appendFileSync(filePath, lines, 'utf8')
    },
    flush() {
      return Promise.resolve()
    },
    clear() {
      return Promise.resolve()
    },
  }
}
