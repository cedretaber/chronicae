import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSimulationStore, type DetailWindow } from '@/app/stores/simulationStore'

type Props = {
  win: DetailWindow
  title: string
  children: ReactNode
  // 'vellum' = 年代記パネル専用の「写本ページ」スキン。暗いマップの上に物理的な文書を
  //   置いたように見せる。既定 (default) の暗色ウィンドウとは枠・ヘッダー・タイトル書体が異なる。
  variant?: 'default' | 'vellum'
}

export function DraggableWindow({ win, title, children, variant = 'default' }: Props) {
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

  const vellum = variant === 'vellum'
  const frameClass = vellum
    ? // 強い暗影で暗いマップから紙面を「浮かせ」、意図した文書だと読ませる。角丸は控えめ。
      'border-[#CBBD9B] bg-[#E6DDC7] text-[#3A3326] shadow-[0_10px_34px_rgba(0,0,0,0.55)]'
    : 'rounded border-gray-700 bg-gray-800 text-white shadow-xl'
  const headerClass = vellum
    ? 'border-[#CBBD9B] bg-[#DCD2B6] text-[#5A5140]'
    : 'border-gray-600 bg-gray-900 text-xs font-semibold text-gray-200'
  const closeClass = vellum
    ? 'text-[#8A7F68] hover:bg-[#CBBD9B] hover:text-[#9E3B2E]'
    : 'text-gray-400 hover:bg-gray-700 hover:text-red-400'

  return (
    <div
      className={`fixed flex w-[360px] flex-col overflow-hidden border ${frameClass}`}
      style={{
        left: win.position.x,
        top: win.position.y,
        zIndex: 100 + win.zIndex,
        maxHeight: '80vh',
      }}
      onMouseDown={() => focusDetailWindow(win.id)}
    >
      <div
        className={`flex shrink-0 cursor-move items-center justify-between border-b px-3 py-1.5 select-none ${headerClass}`}
        onMouseDown={onHeaderMouseDown}
      >
        <span
          className={vellum ? 'truncate text-sm tracking-wide' : 'truncate'}
          style={vellum ? { fontFamily: "'Spectral', Georgia, serif" } : undefined}
        >
          {title}
        </span>
        <button
          className={`ml-2 rounded px-1 ${closeClass}`}
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
