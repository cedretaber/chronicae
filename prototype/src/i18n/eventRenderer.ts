import type { i18n } from 'i18next'
import type { EventMessageParams, EventMessageParamValue } from '@sim/types/event'
import type { NameTranslator } from './nameTranslator'

export type EventRenderer = {
  render(messageKey: string, messageParams: EventMessageParams): string
}

export function createEventRenderer(
  i18nInstance: i18n,
  nameTranslator: NameTranslator,
): EventRenderer {
  return {
    render(messageKey: string, messageParams: EventMessageParams): string {
      const template = i18nInstance.t(messageKey, {
        ns: 'events',
        defaultValue: messageKey,
      })

      return template.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string) => {
        const value = messageParams[key]
        if (value === undefined) return `{{${key}}}`
        return resolveParam(value, nameTranslator)
      })
    },
  }
}

function resolveParam(value: EventMessageParamValue, nameTranslator: NameTranslator): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value.kind === 'name') return nameTranslator.resolve(value.category, value.key)
  if (value.kind === 'entity') return value.id
  return String(value)
}
