import { useCallback, useRef, useState } from 'react'

export type Transform = { x: number; y: number; scale: number }

const MIN_SCALE = 0.3
const MAX_SCALE = 5
const ZOOM_SENSITIVITY = 0.001

export function usePanZoom() {
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
    [cancelAnimation],
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

  const handlers = { onMouseDown, onMouseMove, onMouseUp, onWheel }

  return { transform, setTransform, handlers, animateTo }
}
