export type DebugLogger = {
  log: (tag: string, fields: Record<string, string | number | boolean>) => void
  perf: (system: string, ms: number) => void
}

export function createLogger(debug: boolean): DebugLogger {
  if (!debug) return { log: () => {}, perf: () => {} }
  return {
    log: (tag: string, fields: Record<string, string | number | boolean>) => {
      const pairs = Object.entries(fields)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ')
      process.stderr.write(`[DEBUG:${tag}] ${pairs}\n`)
    },
    perf: (system: string, ms: number) => {
      process.stderr.write(`[PERF:${system}] ms=${ms.toFixed(3)}\n`)
    },
  }
}
