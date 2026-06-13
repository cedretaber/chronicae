import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { FactionId, PersonId } from '@/sim/types/ids'
import type { WorldState } from '@/sim/types/world'
import { buildFactionTree } from '@sim/selectors/factionTreeSelectors'
import { usePanZoom } from '@/app/hooks/usePanZoom'
import { useEntityName } from '@/app/hooks/useEntityName'
import { PersonCard } from './shared/PersonCard'
import type { ClickHandler } from './shared/helpers'
import { layoutFactionTree, NODE_W, NODE_H } from './factionTreeLayout'

export function FactionTreePanel({
  factionId,
  state,
  onClose,
  onPersonClick,
  onFactionClick,
}: {
  factionId: FactionId
  state: WorldState
  onClose: () => void
  onPersonClick: ClickHandler
  onFactionClick: (id: FactionId) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const { transform, handlers } = usePanZoom({ minScale: 0.2 })

  const graph = useMemo(() => buildFactionTree(state, factionId), [state, factionId])
  const layout = useMemo(() => (graph ? layoutFactionTree(graph) : null), [graph])

  // node lookup: personId → role / factionId
  const nodeInfo = useMemo(() => {
    const map = new Map<
      string,
      { role: 'leader' | 'member'; factionId: FactionId; depth: number }
    >()
    if (graph) {
      for (const n of graph.nodes) {
        map.set(n.personId, { role: n.role, factionId: n.factionId, depth: n.depth })
      }
    }
    return map
  }, [graph])

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const leaderNameOf = (pid: PersonId): string => {
    const p = state.persons[pid]
    return p ? resolveName('person', p.nameKey, p.nameKey) : pid
  }
  const rootName = graph ? leaderNameOf(graph.rootPersonId) : ''
  const title = t('detail.faction_tree.title', { faction: rootName })

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
            <span className="text-xs text-gray-500">{t('detail.faction_tree.hint')}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* 凡例: ノード外枠の色分け */}
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm border border-amber-500/70 bg-gray-800" />
                {t('detail.faction_tree.legend_leader')}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm border border-gray-500 bg-gray-800" />
                {t('detail.faction_tree.legend_member')}
              </span>
            </div>
            <button
              className="rounded px-2 py-0.5 text-gray-400 hover:bg-gray-700 hover:text-red-400"
              onClick={onClose}
              title={t('detail.faction_tree.close')}
            >
              ×
            </button>
          </div>
        </div>

        {/* 本体: パン/ズーム領域 */}
        <div
          className="relative flex-1 cursor-grab overflow-hidden bg-gray-900 active:cursor-grabbing"
          onMouseDown={handlers.onMouseDown}
          onMouseMove={handlers.onMouseMove}
          onMouseUp={handlers.onMouseUp}
          onMouseLeave={handlers.onMouseUp}
          onWheel={handlers.onWheel}
        >
          {!graph || !layout || graph.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              {t('detail.faction_tree.empty')}
            </div>
          ) : (
            <div
              className="absolute top-0 left-0 origin-top-left"
              style={{
                width: layout.width,
                height: layout.height,
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              }}
            >
              {/* エッジ層 (背面・クリック透過): 親 leader → 子 (メンバー / 傘下 leader) */}
              <svg
                className="pointer-events-none absolute top-0 left-0"
                width={layout.width}
                height={layout.height}
              >
                {layout.edges.map((e) => {
                  const a = layout.pos.get(e.parentId)
                  const c = layout.pos.get(e.childId)
                  if (!a || !c) return null
                  const sx = a.x + NODE_W / 2
                  const sy = a.y + NODE_H
                  const cx = c.x + NODE_W / 2
                  const ct = c.y
                  const midY = (sy + ct) / 2
                  // 傘下 leader (= 別派閥) へのエッジは強調 (実線・amber)。メンバーは灰。
                  const childIsLeader = nodeInfo.get(e.childId)?.role === 'leader'
                  return (
                    <path
                      key={`${e.parentId}->${e.childId}`}
                      d={`M ${sx} ${sy} V ${midY} H ${cx} V ${ct}`}
                      fill="none"
                      stroke={childIsLeader ? '#d97706' : '#4b5563'}
                      strokeWidth={childIsLeader ? 2 : 1.5}
                    />
                  )
                })}
              </svg>

              {/* ノード層 */}
              {graph.nodes.map((node) => {
                const p = layout.pos.get(node.personId)
                if (!p) return null
                const isLeader = node.role === 'leader'
                const borderClass = isLeader ? 'border-amber-500/50' : 'border-gray-700'
                const relationLabel = isLeader
                  ? node.depth === 0
                    ? t('detail.faction_tree.role_leader')
                    : t('detail.faction_tree.role_subleader')
                  : undefined
                return (
                  <div
                    key={node.personId}
                    className={`absolute rounded border ${borderClass} bg-gray-800/95`}
                    style={{ left: p.x, top: p.y, width: NODE_W }}
                  >
                    <PersonCard
                      personId={node.personId}
                      worldState={state}
                      onPersonClick={onPersonClick}
                      {...(relationLabel !== undefined ? { relationLabel } : {})}
                    />
                    {isLeader && (
                      <button
                        className="w-full truncate px-1 pb-0.5 text-left text-xs text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onFactionClick(node.factionId)}
                      >
                        ◈{' '}
                        {t('detail.faction_tree.faction_of', {
                          leader: leaderNameOf(node.personId),
                        })}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
