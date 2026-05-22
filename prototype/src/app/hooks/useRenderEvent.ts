import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createEventRenderer } from '../../i18n/eventRenderer'
import { createNameTranslator } from '../../i18n/nameTranslator'
import type { EventMessageParams } from '@sim/types/event'
import { getCachedNames } from './nameCache'

export function useRenderEvent(): (event: {
  messageKey: string
  messageParams: EventMessageParams
}) => string {
  const { i18n } = useTranslation()
  const locale = i18n.language

  return useMemo(() => {
    const localeNames = getCachedNames(locale)
    const fallbackNames = locale !== 'en' ? getCachedNames('en') : undefined
    const nameTranslator = createNameTranslator(localeNames, fallbackNames)
    const renderer = createEventRenderer(i18n, nameTranslator)
    return (event: { messageKey: string; messageParams: EventMessageParams }) =>
      renderer.render(event.messageKey, event.messageParams)
  }, [locale, i18n])
}
