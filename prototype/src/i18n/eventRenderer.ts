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

      const ownerCategory = resolveOwnerCategory(messageParams)

      return template.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string) => {
        const value = messageParams[key]
        if (value === undefined) return `{{${key}}}`

        if (key === 'kind' && typeof value === 'string' && ownerCategory) {
          const ns = messageKey.startsWith('goal.') ? 'goals' : 'aims'
          const translated = i18nInstance.t(`${ownerCategory}.${value}`, {
            ns,
            defaultValue: '',
          })
          if (translated) return translated
        }

        // v0.35/v0.37: battle event の enum 文字列 (battlefieldKind / result / avoidingSide /
        //   outcomeQuality / breakthroughSide) を events ns の enum.<key>.<value> ラベルへ解決する。
        //   未定義なら raw fallback。
        if (
          (key === 'battlefieldKind' ||
            key === 'result' ||
            key === 'avoidingSide' ||
            key === 'outcomeQuality' ||
            key === 'breakthroughSide') &&
          typeof value === 'string'
        ) {
          const translated = i18nInstance.t(`enum.${key}.${value}`, {
            ns: 'events',
            defaultValue: '',
          })
          if (translated) return translated
        }

        return resolveParam(value, nameTranslator)
      })
    },
  }
}

function resolveOwnerCategory(params: EventMessageParams): string | undefined {
  const owner = params['owner']
  if (owner && typeof owner === 'object' && 'kind' in owner && owner.kind === 'name') {
    return owner.category
  }
  return undefined
}

function resolveParam(value: EventMessageParamValue, nameTranslator: NameTranslator): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(Math.round(value))
  if (typeof value === 'boolean') return String(value)
  if (value.kind === 'name') return nameTranslator.resolve(value.category, value.key)
  if (value.kind === 'entity') return value.id
  return String(value)
}
