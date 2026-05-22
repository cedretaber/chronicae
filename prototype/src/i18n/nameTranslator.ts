export type NameDisplayData = Record<string, Record<string, string>>

export type NameTranslator = {
  resolve(category: string, nameKey: string): string
}

export function createNameTranslator(
  data: NameDisplayData,
  fallback?: NameDisplayData,
): NameTranslator {
  return {
    resolve(category: string, nameKey: string): string {
      return data[category]?.[nameKey] ?? fallback?.[category]?.[nameKey] ?? nameKey
    },
  }
}
