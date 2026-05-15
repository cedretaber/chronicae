export type DebugLogger = {
  log: (msg: string) => void
}

export function createLogger(debug: boolean): DebugLogger {
  return {
    log: debug
      ? (msg: string) => {
          console.error('[DEBUG] ' + msg)
        }
      : () => {},
  }
}
