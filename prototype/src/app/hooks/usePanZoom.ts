import { useCallback, useRef, useState } from 'react'

export type Transform = { x: number; y: number; scale: number }

const DEFAULT_MIN_SCALE = 1.0
const MAX_SCALE = 5
const ZOOM_SENSITIVITY = 0.001

// minScale を可変にして、家系図など全体俯瞰のためズームアウト (< 1.0) したい用途に対応する。
// 既定は 1.0 (地図と同じ振る舞い)。
export function usePanZoom(options?: { minScale?: number }) {
  const MIN_SCALE = options?.minScale ?? DEFAULT_MIN_SCALE
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 })
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const animFrameRef = useRef<number | null>(null)

  const cancelAnimation = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
  }, [])

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      cancelAnimation()
      dragging.current = true
      lastPos.current = { x: e.clientX, y: e.clientY }
    },
    [cancelAnimation],
  )

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
  }, [])

  const onMouseUp = useCallback(() => {
    dragging.current = false
  }, [])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      cancelAnimation()
      const rect = e.currentTarget.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      setTransform((t) => {
        const delta = -e.deltaY * ZOOM_SENSITIVITY
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * (1 + delta)))
        const ratio = newScale / t.scale
        return {
          x: mx - ratio * (mx - t.x),
          y: my - ratio * (my - t.y),
          scale: newScale,
        }
      })
    },
    [cancelAnimation, MIN_SCALE],
  )

  const animateTo = useCallback(
    (target: Transform, durationMs = 400) => {
      cancelAnimation()
      const startTime = performance.now()
      let startTransform: Transform | null = null

      function step(now: number): void {
        if (!startTransform) {
          // Capture start on first frame to avoid stale closure
          setTransform((current) => {
            startTransform = current
            return current
          })
          animFrameRef.current = requestAnimationFrame(step)
          return
        }

        const elapsed = now - startTime
        const progress = Math.min(1, elapsed / durationMs)
        const ease = 1 - (1 - progress) * (1 - progress)

        const lerped: Transform = {
          x: startTransform.x + (target.x - startTransform.x) * ease,
          y: startTransform.y + (target.y - startTransform.y) * ease,
          scale: startTransform.scale + (target.scale - startTransform.scale) * ease,
        }
        setTransform(lerped)

        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(step)
        } else {
          animFrameRef.current = null
        }
      }

      animFrameRef.current = requestAnimationFrame(step)
    },
    [cancelAnimation],
  )

  const zoomBy = useCallback(
    (factor: number, containerEl?: HTMLElement | null) => {
      cancelAnimation()
      setTransform((t) => {
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor))
        const ratio = newScale / t.scale
        const cx = containerEl ? containerEl.clientWidth / 2 : 0
        const cy = containerEl ? containerEl.clientHeight / 2 : 0
        return {
          x: cx - ratio * (cx - t.x),
          y: cy - ratio * (cy - t.y),
          scale: newScale,
        }
      })
    },
    [cancelAnimation, MIN_SCALE],
  )

  const resetZoom = useCallback(() => {
    cancelAnimation()
    setTransform({ x: 0, y: 0, scale: 1 })
  }, [cancelAnimation])

  const handlers = { onMouseDown, onMouseMove, onMouseUp, onWheel }

  return { transform, handlers, animateTo, zoomBy, resetZoom }
}
