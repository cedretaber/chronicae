import { useCallback, useRef, useState } from 'react'

type Transform = { x: number; y: number; scale: number }

const MIN_SCALE = 0.3
const MAX_SCALE = 5
const ZOOM_SENSITIVITY = 0.001

export function usePanZoom() {
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 })
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
  }, [])

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

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
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
  }, [])

  const handlers = { onMouseDown, onMouseMove, onMouseUp, onWheel }

  return { transform, handlers }
}
