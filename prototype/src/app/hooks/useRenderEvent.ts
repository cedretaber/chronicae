import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createEventRenderer,
  type EventRenderer,
  type EventSegment,
} from '../../i18n/eventRenderer'
import { createNameTranslator } from '../../i18n/nameTranslator'
import type { EventEntityRef, EventMessageParams } from '@sim/types/event'
import { getCachedNames } from './nameCache'

// locale に紐づく EventRenderer を 1 つ構築して共有する (render / renderSegments 双方の基盤)。
function useEventRenderer(): EventRenderer {
  const { i18n } = useTranslation()
  const locale = i18n.language

  return useMemo(() => {
    const localeNames = getCachedNames(locale)
    const fallbackNames = locale !== 'en' ? getCachedNames('en') : undefined
    const nameTranslator = createNameTranslator(localeNames, fallbackNames)
    return createEventRenderer(i18n, nameTranslator)
  }, [locale, i18n])
}

// イベント本文を素のテキストに解決する (リンクなし)。tooltip / 単純表示用。
export function useRenderEvent(): (event: {
  messageKey: string
  messageParams: EventMessageParams
}) => string {
  const renderer = useEventRenderer()
  return useMemo(
    () => (event) => renderer.render(event.messageKey, event.messageParams),
    [renderer],
  )
}

// イベント本文を「テキスト / クリック可能なエンティティ参照」の列に解決する。EventText が描画する。
export function useRenderEventSegments(): (event: {
  messageKey: string
  messageParams: EventMessageParams
  entityRefs: readonly EventEntityRef[]
}) => EventSegment[] {
  const renderer = useEventRenderer()
  return useMemo(
    () => (event) =>
      renderer.renderSegments(event.messageKey, event.messageParams, event.entityRefs),
    [renderer],
  )
}
