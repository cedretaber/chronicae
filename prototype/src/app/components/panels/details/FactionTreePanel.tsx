import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FactionId, PersonId } from '@/sim/types/ids'
import type { WorldState } from '@/sim/types/world'
import { buildFactionTree } from '@sim/selectors/factionTreeSelectors'
import { useEntityName } from '@/app/hooks/useEntityName'
import { PersonCard } from './shared/PersonCard'
import type { ClickHandler } from './shared/helpers'
import { layoutFactionTree, NODE_W, NODE_H } from './factionTreeLayout'
import { TreeModal } from './shared/TreeModal'
import { collectLineage } from './treeLineage'

// ホバー系統ハイライトで「系列外」を減光する不透明度。
const DIM = 0.16

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
  const [hovered, setHovered] = useState<string | null>(null)

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

  // 親 (単一) / 子の隣接 (ホバー系列計算用)。
  const parentOf = useMemo(() => {
    const m = new Map<string, string[]>()
    if (graph) {
      for (const n of graph.nodes) {
        m.set(n.personId, n.parentPersonId !== null ? [n.parentPersonId] : [])
      }
    }
    return m
  }, [graph])
  const childrenOf = useMemo(() => {
    const m = new Map<string, string[]>()
    if (graph) {
      for (const n of graph.nodes) {
        if (n.parentPersonId !== null) {
          const arr = m.get(n.parentPersonId)
          if (arr) arr.push(n.personId)
          else m.set(n.parentPersonId, [n.personId])
        }
      }
    }
    return m
  }, [graph])

  const lineage = useMemo(() => {
    if (!hovered) return null
    return collectLineage(
      hovered,
      (id) => parentOf.get(id) ?? [],
      (id) => childrenOf.get(id) ?? [],
    )
  }, [hovered, parentOf, childrenOf])

  const nodeOpacity = (id: string): number => (lineage && !lineage.has(id) ? DIM : 1)

  const leaderNameOf = (pid: PersonId): string => {
    const p = state.persons[pid]
    return p ? resolveName('person', p.nameKey, p.nameKey) : pid
  }
  const rootName = graph ? leaderNameOf(graph.rootPersonId) : ''
  const title = t('detail.faction_tree.title', { faction: rootName })

  const legend = (
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
  )

  return (
    <TreeModal
      title={title}
      hint={t('detail.faction_tree.hint')}
      legend={legend}
      onClose={onClose}
      contentWidth={layout?.width ?? 0}
      contentHeight={layout?.height ?? 0}
      fitKey={factionId}
      empty={!graph || !layout || graph.nodes.length === 0}
      emptyText={t('detail.faction_tree.empty')}
    >
      {({ lod }) =>
        graph && layout ? (
          <>
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
                const childIsLeader = nodeInfo.get(e.childId)?.role === 'leader'
                const dim =
                  lineage && !(lineage.has(e.parentId) && lineage.has(e.childId)) ? DIM : 1
                return (
                  <path
                    key={`${e.parentId}->${e.childId}`}
                    d={`M ${sx} ${sy} V ${midY} H ${cx} V ${ct}`}
                    fill="none"
                    stroke={childIsLeader ? '#d97706' : '#4b5563'}
                    strokeWidth={childIsLeader ? 2 : 1.5}
                    opacity={dim}
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
              const personName = leaderNameOf(node.personId)
              return (
                <div
                  key={node.personId}
                  className={`absolute rounded border ${borderClass} bg-gray-800/95`}
                  style={{
                    left: p.x,
                    top: p.y,
                    width: NODE_W,
                    opacity: nodeOpacity(node.personId),
                  }}
                  onMouseEnter={() => setHovered(node.personId)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {lod === 'compact' ? (
                    // ズームアウト時: 名前のみの簡易ノード。
                    <button
                      className="flex w-full items-center justify-center px-2 text-center text-lg leading-tight font-semibold text-gray-100"
                      style={{ height: NODE_H }}
                      onClick={() => onPersonClick(node.personId, 'person')}
                      title={personName}
                    >
                      <span className="line-clamp-2">{personName}</span>
                    </button>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              )
            })}
          </>
        ) : null
      }
    </TreeModal>
  )
}
