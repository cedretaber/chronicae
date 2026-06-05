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

        // task event の {{task}} も aim kind (taskSystem が aim.kind を渡す) — kind と同じ解決
        const isKindLike = key === 'kind' || (key === 'task' && messageKey.startsWith('task.'))
        if (isKindLike && typeof value === 'string') {
          // project event の kind は ProjectKind enum — events ns の enum.projectKind.* で解決
          // (goal/aim kind と違い owner 種別で語彙が分かれないため flat なラベル表)
          if (messageKey.startsWith('project.')) {
            const translated = i18nInstance.t(`enum.projectKind.${value}`, {
              ns: 'events',
              defaultValue: '',
            })
            if (translated) return translated
          } else if (ownerCategory) {
            // goal kind は 'goal.*' に加え 'person.goal.*' などネスト形もある
            const ns = /(^|\.)goal\./.test(messageKey) ? 'goals' : 'aims'
            const translated = i18nInstance.t(`${ownerCategory}.${value}`, {
              ns,
              defaultValue: '',
            })
            if (translated) return translated
          }
        }

        // task cancel 理由 / land contract 移転理由 / faction 解散理由は messageKey 限定の
        // enum ラベル (param 名 'reason' はイベント間で語彙が異なるため、key だけでは解決先を決めない)
        if (key === 'reason' && typeof value === 'string') {
          const enumKey = messageKey.startsWith('task.')
            ? 'taskCancelReason'
            : messageKey === 'land_contract.transferred'
              ? 'landTransferReason'
              : messageKey === 'faction.dissolved'
                ? 'factionDissolveReason'
                : undefined
          if (enumKey) {
            const translated = i18nInstance.t(`enum.${enumKey}.${value}`, {
              ns: 'events',
              defaultValue: '',
            })
            if (translated) return translated
          }
        }

        // v0.35/v0.37: battle event の enum 文字列 (battlefieldKind / result / avoidingSide /
        //   outcomeQuality / breakthroughSide) を events ns の enum.<key>.<value> ラベルへ解決する。
        //   未定義なら raw fallback。
        //   v0.42: political_right event の rightKind / revokeReason、plot event の plotType も同方式。
        if (
          (key === 'battlefieldKind' ||
            key === 'result' ||
            key === 'avoidingSide' ||
            key === 'outcomeQuality' ||
            key === 'breakthroughSide' ||
            key === 'rightKind' ||
            key === 'revokeReason' ||
            key === 'plotType' ||
            key === 'occupation' ||
            key === 'rebelClass') &&
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
  // task 系イベントは owner でなく person param で主体を渡す — fallback に使う
  const owner = params['owner'] ?? params['person']
  if (owner && typeof owner === 'object' && 'kind' in owner && owner.kind === 'name') {
    // v0.41: owner の nameParam category は holding 由来 Polity だと 'province'/'city' に
    //   なる (名前解決用)。だが goal/aim kind ラベルの名前空間は owner の「種別」
    //   ('polity'/'house'/'person') を要求するため、地名カテゴリは polity に丸める。
    const c = owner.category
    if (c === 'province' || c === 'city' || c === 'polity') return 'polity'
    return c
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
