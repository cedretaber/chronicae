import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSimulationStore, type DetailWindow } from '@/app/stores/simulationStore'

type Props = {
  win: DetailWindow
  title: string
  children: ReactNode
}

export function DraggableWindow({ win, title, children }: Props) {
  const focusDetailWindow = useSimulationStore((s) => s.focusDetailWindow)
  const closeDetailWindow = useSimulationStore((s) => s.closeDetailWindow)
  const moveDetailWindow = useSimulationStore((s) => s.moveDetailWindow)

  const [dragging, setDragging] = useState(false)
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })

  useEffect(() => {
    if (!dragging) return
    const onMouseMove = (e: MouseEvent) => {
      const { dx, dy } = dragOffsetRef.current
      moveDetailWindow(win.id, { x: e.clientX - dx, y: e.clientY - dy })
    }
    const onMouseUp = () => setDragging(false)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragging, moveDetailWindow, win.id])

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    focusDetailWindow(win.id)
    dragOffsetRef.current = {
      dx: e.clientX - win.position.x,
      dy: e.clientY - win.position.y,
    }
    setDragging(true)
  }

  return (
    <div
      className="fixed flex w-[360px] flex-col overflow-hidden rounded border border-gray-700 bg-gray-800 text-white shadow-xl"
      style={{
        left: win.position.x,
        top: win.position.y,
        zIndex: 100 + win.zIndex,
        maxHeight: '80vh',
      }}
      onMouseDown={() => focusDetailWindow(win.id)}
    >
      <div
        className="flex shrink-0 cursor-move items-center justify-between border-b border-gray-600 bg-gray-900 px-3 py-1.5 text-xs font-semibold text-gray-200 select-none"
        onMouseDown={onHeaderMouseDown}
      >
        <span className="truncate">{title}</span>
        <button
          className="ml-2 rounded px-1 text-gray-400 hover:bg-gray-700 hover:text-red-400"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            closeDetailWindow(win.id)
          }}
          title="Close"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
