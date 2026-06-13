import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { HouseId } from '@/sim/types/ids'
import type { WorldState } from '@/sim/types/world'
import { buildHouseFamilyTree } from '@sim/selectors/familyTreeSelectors'
import { usePanZoom } from '@/app/hooks/usePanZoom'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getHouseDisplayName } from '@/app/hooks/entityNameHelpers'
import { PersonCard } from './shared/PersonCard'
import type { ClickHandler } from './shared/helpers'
import { layoutFamilyTree, NODE_W, NODE_H, COL_W } from './familyTreeLayout'
import type { ParentsLookup, EntityId } from './familyTreeLayout'

export function FamilyTreePanel({
  houseId,
  state,
  onClose,
  onPersonClick,
  onHouseClick,
}: {
  houseId: HouseId
  state: WorldState
  onClose: () => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const { transform, handlers } = usePanZoom({ minScale: 0.2 })

  const graph = useMemo(() => buildHouseFamilyTree(state, houseId), [state, houseId])
  const parentsOf = useMemo<ParentsLookup>(() => {
    const map: ParentsLookup = new Map()
    for (const n of graph.nodes) {
      const p = state.persons[n.personId]
      const entry: { fatherId?: EntityId; motherId?: EntityId } = {}
      if (p?.fatherId !== undefined) entry.fatherId = p.fatherId
      if (p?.motherId !== undefined) entry.motherId = p.motherId
      map.set(n.personId, entry)
    }
    return map
  }, [graph, state])
  const layout = useMemo(() => layoutFamilyTree(graph, parentsOf), [graph, parentsOf])

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const house = state.houses[houseId]
  const houseName = getHouseDisplayName(resolveName, house, houseId)
  const title = t('detail.family_tree.title', { house: houseName })

  const houseNameOf = (id: HouseId): string => {
    const h = state.houses[id]
    return getHouseDisplayName(resolveName, h, id)
  }

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
            <span className="text-xs text-gray-500">{t('detail.family_tree.hint')}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* 凡例: ノード外枠の色分け */}
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm border border-gray-500 bg-gray-800" />
                {t('detail.family_tree.legend_blood')}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm border border-pink-500/70 bg-gray-800" />
                {t('detail.family_tree.legend_married_in')}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm border border-amber-500/70 bg-gray-800" />
                {t('detail.family_tree.legend_married_out')}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm border border-emerald-500/70 bg-gray-800" />
                {t('detail.family_tree.legend_branched_from')}
              </span>
            </div>
            <button
              className="rounded px-2 py-0.5 text-gray-400 hover:bg-gray-700 hover:text-red-400"
              onClick={onClose}
              title={t('detail.family_tree.close')}
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
          {graph.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              {t('detail.family_tree.empty')}
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
              {/* エッジ層 (背面・クリック透過) */}
              <svg
                className="pointer-events-none absolute top-0 left-0"
                width={layout.width}
                height={layout.height}
              >
                {/* 夫婦線 (破線)。隣接は横一直線、非隣接 (再婚等) は行の下を回す U 字。 */}
                {layout.coupleLines.map((cl, i) => {
                  const a = layout.pos.get(cl.aId)
                  const b = layout.pos.get(cl.bId)
                  if (!a || !b) return null
                  const left = a.x <= b.x ? a : b
                  const right = a.x <= b.x ? b : a
                  const adjacent = left.y === right.y && right.x - left.x <= COL_W * 1.6
                  if (adjacent) {
                    return (
                      <line
                        key={`cp-${i}`}
                        x1={left.x + NODE_W}
                        y1={left.y + NODE_H / 2}
                        x2={right.x}
                        y2={right.y + NODE_H / 2}
                        stroke="#9ca3af"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                      />
                    )
                  }
                  const lcx = left.x + NODE_W / 2
                  const rcx = right.x + NODE_W / 2
                  const dipY = Math.max(left.y, right.y) + NODE_H + 16
                  return (
                    <path
                      key={`cp-${i}`}
                      d={`M ${lcx} ${left.y + NODE_H} V ${dipY} H ${rcx} V ${right.y + NODE_H}`}
                      fill="none"
                      stroke="#9ca3af"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  )
                })}
                {/* 親子線: 父母の中点から子へ 1 本 (同世代の兄弟は同一起点で sibling bus を形成) */}
                {graph.nodes.map((node) => {
                  const src = layout.childSource.get(node.personId)
                  const c = layout.pos.get(node.personId)
                  if (!src || !c) return null
                  const cx = c.x + NODE_W / 2
                  const ct = c.y
                  const midY = (src.y + ct) / 2
                  return (
                    <path
                      key={`pc-${node.personId}`}
                      d={`M ${src.x} ${src.y} V ${midY} H ${cx} V ${ct}`}
                      fill="none"
                      stroke="#4b5563"
                      strokeWidth={1.5}
                    />
                  )
                })}
              </svg>

              {/* 不詳 placeholder 層 */}
              {layout.placeholderIds.map((pid) => {
                const p = layout.pos.get(pid)
                if (!p) return null
                return (
                  <div
                    key={pid}
                    className="absolute flex items-center justify-center rounded border border-dashed border-gray-600 bg-gray-800/60 text-xs text-gray-500"
                    style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                  >
                    {t('detail.family_tree.unknown_parent')}
                  </div>
                )
              })}

              {/* ノード層 */}
              {graph.nodes.map((node) => {
                const p = layout.pos.get(node.personId)
                if (!p) return null
                const borderClass =
                  node.relation === 'married_in'
                    ? 'border-pink-500/50'
                    : node.relation === 'married_out'
                      ? 'border-amber-500/50'
                      : node.branchedFromHouseId !== undefined
                        ? 'border-emerald-500/50'
                        : 'border-gray-700'
                // 婚入/婚出は相手家、分家創設者は分家元の家へリンクするラベルを 1 つ出す。
                const linkHouseId = node.otherHouseId ?? node.branchedFromHouseId
                const relationLabel =
                  node.otherHouseId !== undefined
                    ? node.relation === 'married_in'
                      ? t('detail.family_tree.relation_married_in', {
                          house: houseNameOf(node.otherHouseId),
                        })
                      : node.relation === 'married_out'
                        ? t('detail.family_tree.relation_married_out', {
                            house: houseNameOf(node.otherHouseId),
                          })
                        : undefined
                    : node.branchedFromHouseId !== undefined
                      ? t('detail.family_tree.relation_branched_from', {
                          house: houseNameOf(node.branchedFromHouseId),
                        })
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
                    />
                    {relationLabel !== undefined && linkHouseId !== undefined && (
                      <button
                        className="w-full truncate px-1 pb-0.5 text-left text-xs text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onHouseClick(linkHouseId, 'house')}
                      >
                        {relationLabel}
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
