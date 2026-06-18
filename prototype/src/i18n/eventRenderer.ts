import type { i18n } from 'i18next'
import type {
  EventEntityKind,
  EventEntityRef,
  EventMessageParams,
  EventMessageParamValue,
} from '@sim/types/event'
import type { NameTranslator } from './nameTranslator'

// イベント本文を「素のテキスト断片」と「クリック可能なエンティティ参照断片」の列に分解した結果。
//   app 層 (EventText) が text はそのまま、link は枠付きチップに描く。i18n 層は UI 方針を持たず、
//   「このトークンは (entityKind,id) を表す」というデータだけを返す (リンク可否・存在確認は app 層)。
export type EventSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; entityKind: EventEntityKind; id: string; text: string }

export type EventRenderer = {
  render(messageKey: string, messageParams: EventMessageParams): string
  renderSegments(
    messageKey: string,
    messageParams: EventMessageParams,
    entityRefs: readonly EventEntityRef[],
  ): EventSegment[]
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g

export function createEventRenderer(
  i18nInstance: i18n,
  nameTranslator: NameTranslator,
): EventRenderer {
  function renderSegments(
    messageKey: string,
    messageParams: EventMessageParams,
    entityRefs: readonly EventEntityRef[],
  ): EventSegment[] {
    const template = i18nInstance.t(messageKey, {
      ns: 'events',
      defaultValue: messageKey,
    })

    const ownerCategory = resolveOwnerCategory(messageParams)
    // nameParam の key (= nameKey) から entityRef を引く対応表。emit 側は name param の nameKey と
    //   同じ nameKey を entityRef にも渡している (warEvents/marriage/birth/office/award すべてで確認)。
    //   nameKey 衝突時 (holding 由来 Polity は province の nameKey を借りる) は最初の ref を採用する
    //   — 既知の限界 (稀。どちらも当該イベントの関連エンティティなので致命的でない)。
    const nameKeyToRef = buildNameKeyMap(entityRefs)

    const segments: EventSegment[] = []
    const pushText = (text: string) => {
      if (text.length === 0) return
      const last = segments[segments.length - 1]
      if (last && last.kind === 'text') last.text += text
      else segments.push({ kind: 'text', text })
    }

    PLACEHOLDER_RE.lastIndex = 0
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = PLACEHOLDER_RE.exec(template)) !== null) {
      const key = match[1] ?? ''
      if (match.index > lastIndex) pushText(template.slice(lastIndex, match.index))
      lastIndex = PLACEHOLDER_RE.lastIndex

      const value = messageParams[key]
      if (value === undefined) {
        pushText(`{{${key}}}`)
        continue
      }

      const text = resolveTokenText(key, value, messageKey, ownerCategory)
      const link = resolveTokenLink(value, nameKeyToRef)
      if (link) {
        segments.push({ kind: 'link', entityKind: link.kind, id: link.id, text })
      } else {
        pushText(text)
      }
    }
    if (lastIndex < template.length) pushText(template.slice(lastIndex))
    return segments
  }

  // value (非 undefined) を表示文字列に解決する。enum/kind/reason 系の特殊解決を含み、
  //   render() と renderSegments() で同一ロジックを共有する (二重化による enum キー不一致回帰を防ぐ)。
  function resolveTokenText(
    key: string,
    value: EventMessageParamValue,
    messageKey: string,
    ownerCategory: string | undefined,
  ): string {
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
    //   v0.42: political_right event の rightKind / revokeReason も同方式。
    if (
      (key === 'battlefieldKind' ||
        key === 'result' ||
        key === 'avoidingSide' ||
        key === 'outcomeQuality' ||
        key === 'breakthroughSide' ||
        key === 'rightKind' ||
        key === 'revokeReason' ||
        key === 'occupation' ||
        key === 'rebelClass' ||
        // v0.44: 成果成長・評判イベントの enum param
        key === 'ability' ||
        key === 'category' ||
        key === 'sourceKind' ||
        // v0.45: 天才の型
        key === 'geniusType' ||
        // v0.48: Crisis の種別
        key === 'crisisKind' ||
        // v0.48.1: 設備破壊イベントの設備種別・破壊種別
        key === 'improvementKind' ||
        key === 'breakdownOutcome') &&
      typeof value === 'string'
    ) {
      const translated = i18nInstance.t(`enum.${key}.${value}`, {
        ns: 'events',
        defaultValue: '',
      })
      if (translated) return translated
    }

    return resolveParam(value, nameTranslator)
  }

  return {
    render(messageKey: string, messageParams: EventMessageParams): string {
      // 文字列版は「リンクなし」= entityRefs 空の segments を結合したものと同一 (ロジックは 1 本)。
      return renderSegments(messageKey, messageParams, [])
        .map((s) => s.text)
        .join('')
    },
    renderSegments,
  }
}

// nameKey → 最初に出現した ref (kind,id)。nameKey を持たない ref (例: nameKey 未指定で emit された
//   holding ref) は対象外 = name param と突き合わせられずテキストのまま (リンク化しない)。
function buildNameKeyMap(
  entityRefs: readonly EventEntityRef[],
): Map<string, { kind: EventEntityKind; id: string }> {
  const map = new Map<string, { kind: EventEntityKind; id: string }>()
  for (const ref of entityRefs) {
    if (ref.nameKey === undefined) continue
    if (map.has(ref.nameKey)) continue
    map.set(ref.nameKey, { kind: ref.kind, id: ref.id })
  }
  return map
}

function resolveTokenLink(
  value: EventMessageParamValue,
  nameKeyToRef: Map<string, { kind: EventEntityKind; id: string }>,
): { kind: EventEntityKind; id: string } | null {
  if (typeof value !== 'object') return null
  if (value.kind === 'entity') return { kind: value.entityKind, id: value.id }
  if (value.kind === 'name') return nameKeyToRef.get(value.key) ?? null
  return null
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
