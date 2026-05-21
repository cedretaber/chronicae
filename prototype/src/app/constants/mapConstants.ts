export const MAP_ICON_CONFIG = {
  provinceUrbanIconThreshold: 0.14,
  provinceIconSize: 80,
  provinceBadgeSize: 24,
  backgroundOpacity: 0.55,
}

export const ZOOM_THRESHOLDS = {
  FAR_TO_MEDIUM: 1.8,
  MEDIUM_TO_NEAR: 3.5,
} as const

export type ZoomTier = 'far' | 'medium' | 'near'

export function getZoomTier(scale: number): ZoomTier {
  if (scale < ZOOM_THRESHOLDS.FAR_TO_MEDIUM) return 'far'
  if (scale < ZOOM_THRESHOLDS.MEDIUM_TO_NEAR) return 'medium'
  return 'near'
}

export const UNIFIED_ICON_SIZE = {
  near: 30,
  medium: 18,
  badgeNear: 10,
  badgeMedium: 6,
} as const
