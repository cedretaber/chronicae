export type NameDisplayData = Record<string, Record<string, string>>
// e.g. { person: { aldric: "Aldric", ... }, house: { arden: "Arden", ... } }

export function resolveNameDisplay(
  data: NameDisplayData,
  category: string,
  nameKey: string,
): string {
  return data[category]?.[nameKey] ?? nameKey
}
