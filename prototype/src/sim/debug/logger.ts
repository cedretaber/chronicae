export type DebugLogger = {
  log: (tag: string, fields: Record<string, string | number | boolean>) => void
}

export function createLogger(debug: boolean): DebugLogger {
  if (!debug) return { log: () => {} }
  return {
    log: (tag: string, fields: Record<string, string | number | boolean>) => {
      const pairs = Object.entries(fields)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ')
      process.stderr.write(`[DEBUG:${tag}] ${pairs}\n`)
    },
  }
}
