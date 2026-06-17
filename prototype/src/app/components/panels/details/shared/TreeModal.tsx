import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { usePanZoom } from '@/app/hooks/usePanZoom'

// 家系図・派閥図で共有する全画面モーダルのシェル + pan/zoom 土台。
//   - 開いた瞬間に全体フィット (entity ごとに 1 回)。graph/layout は毎 tick 再生成され
//     contentWidth/Height の identity が変わるため、フィット effect の依存は fitKey (entity id)
//     のみにし、再生中にユーザーの pan/zoom を奪わない。最新寸法は ref 経由で読む。
//   - ズーム/フィット操作ボタン (地図と同じスタイル)。
//   - LOD: scale が閾値未満なら 'compact' を子へ渡す (ズームアウト時は簡易ノード表示)。
//   children は render-prop で、現在の scale と lod を受け取り SVG エッジ + ノードを描く。

const LOD_THRESHOLD = 0.5

export type TreeLod = 'compact' | 'full'

export function TreeModal({
  title,
  hint,
  legend,
  onClose,
  contentWidth,
  contentHeight,
  fitKey,
  empty = false,
  emptyText,
  children,
}: {
  title: string
  hint?: string
  legend?: ReactNode
  onClose: () => void
  contentWidth: number
  contentHeight: number
  fitKey: string
  empty?: boolean
  emptyText?: string
  children: (ctx: { scale: number; lod: TreeLod }) => ReactNode
}) {
  const { transform, handlers, zoomBy, fitTo } = usePanZoom({ minScale: 0.2 })
  const bodyRef = useRef<HTMLDivElement>(null)

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 開いた瞬間 (entity ごと) に全体フィット。初回ペイント前に適用しコーナー表示のチラつきを防ぐ。
  //   依存は fitKey のみ: contentWidth/Height は毎 tick identity が変わるため依存に含めない
  //   (含めると再生中にユーザーの pan/zoom を毎 tick 奪う)。effect は毎レンダー再生成されるので
  //   fitKey 変化時には「その時点の最新寸法」をクロージャで捕捉して実行する。
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (contentWidth > 0 && contentHeight > 0) fitTo(contentWidth, contentHeight, el, { pad: 48 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  const lod: TreeLod = transform.scale < LOD_THRESHOLD ? 'compact' : 'full'

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[90vh] w-[94vw] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ヘッダ */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-700 bg-gray-950 px-4 py-2">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-semibold text-gray-100">{title}</span>
            {hint && <span className="text-xs text-gray-500">{hint}</span>}
          </div>
          <div className="flex items-center gap-3">
            {legend}
            <button
              className="rounded px-2 py-0.5 text-gray-400 hover:bg-gray-700 hover:text-red-400"
              onClick={onClose}
              title="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* 本体: パン/ズーム領域 */}
        <div
          ref={bodyRef}
          className="relative flex-1 cursor-grab overflow-hidden bg-gray-900 active:cursor-grabbing"
          onMouseDown={handlers.onMouseDown}
          onMouseMove={handlers.onMouseMove}
          onMouseUp={handlers.onMouseUp}
          onMouseLeave={handlers.onMouseUp}
          onWheel={handlers.onWheel}
        >
          {empty ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              {emptyText}
            </div>
          ) : (
            <>
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{
                  width: contentWidth,
                  height: contentHeight,
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                }}
              >
                {children({ scale: transform.scale, lod })}
              </div>

              {/* ズーム操作 (地図と同じスタイル)。pan 開始を誘発しないよう mousedown を止める。 */}
              <div
                className="absolute bottom-3 left-3 z-10 flex flex-col gap-1"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  className="flex h-8 w-8 items-center justify-center rounded bg-gray-800/80 text-lg text-white hover:bg-gray-700"
                  onClick={() => zoomBy(1.5, bodyRef.current)}
                  title="Zoom in"
                >
                  +
                </button>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded bg-gray-800/80 text-lg text-white hover:bg-gray-700"
                  onClick={() => zoomBy(1 / 1.5, bodyRef.current)}
                  title="Zoom out"
                >
                  −
                </button>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded bg-gray-800/80 text-sm text-white hover:bg-gray-700"
                  onClick={() =>
                    fitTo(contentWidth, contentHeight, bodyRef.current, {
                      pad: 48,
                      animate: true,
                    })
                  }
                  title="Fit to view"
                >
                  ⊡
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
