import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getCachedNames } from './nameCache'

export function useEntityName(): (
  category: string,
  nameKey: string | undefined,
  fallbackName: string,
) => string {
  const { i18n } = useTranslation()
  const locale = i18n.language

  return useCallback(
    (category: string, nameKey: string | undefined, fallbackName: string): string => {
      if (!nameKey) return fallbackName
      const localeNames = getCachedNames(locale)
      const resolved = localeNames[category]?.[nameKey]
      if (resolved) return resolved
      if (locale !== 'en') {
        const enNames = getCachedNames('en')
        const enResolved = enNames[category]?.[nameKey]
        if (enResolved) return enResolved
      }
      return fallbackName
    },
    [locale],
  )
}
