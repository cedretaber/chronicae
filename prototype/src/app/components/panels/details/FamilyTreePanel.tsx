import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HouseId } from '@/sim/types/ids'
import type { WorldState } from '@/sim/types/world'
import { buildHouseFamilyTree } from '@sim/selectors/familyTreeSelectors'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getHouseDisplayName } from '@/app/hooks/entityNameHelpers'
import { PersonCard } from './shared/PersonCard'
import type { ClickHandler } from './shared/helpers'
import { layoutFamilyTree, NODE_W, NODE_H, COL_W } from './familyTreeLayout'
import type { ParentsLookup, EntityId } from './familyTreeLayout'
import { TreeModal } from './shared/TreeModal'
import { collectLineage } from './treeLineage'

// ホバー系統ハイライトで「系統外」を減光する不透明度。
const DIM = 0.16

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
  const [hovered, setHovered] = useState<EntityId | null>(null)

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

  // displayed なノードに限った親/子の隣接 (ホバー系統計算用)。
  const displayed = useMemo(() => new Set<EntityId>(graph.nodes.map((n) => n.personId)), [graph])
  const displayedParentsOf = useMemo(() => {
    const m = new Map<EntityId, EntityId[]>()
    for (const n of graph.nodes) {
      const p = parentsOf.get(n.personId)
      const out: EntityId[] = []
      if (p?.fatherId !== undefined && displayed.has(p.fatherId)) out.push(p.fatherId)
      if (p?.motherId !== undefined && displayed.has(p.motherId)) out.push(p.motherId)
      m.set(n.personId, out)
    }
    return m
  }, [graph, parentsOf, displayed])
  const childrenOf = useMemo(() => {
    const m = new Map<EntityId, EntityId[]>()
    for (const [child, pars] of displayedParentsOf) {
      for (const par of pars) {
        const arr = m.get(par)
        if (arr) arr.push(child)
        else m.set(par, [child])
      }
    }
    return m
  }, [displayedParentsOf])

  const lineage = useMemo(() => {
    if (!hovered) return null
    return collectLineage(
      hovered,
      (id) => displayedParentsOf.get(id) ?? [],
      (id) => childrenOf.get(id) ?? [],
    )
  }, [hovered, displayedParentsOf, childrenOf])

  const nodeOpacity = (id: EntityId): number => (lineage && !lineage.has(id) ? DIM : 1)

  const house = state.houses[houseId]
  const houseName = getHouseDisplayName(resolveName, house, houseId)
  const title = t('detail.family_tree.title', { house: houseName })
  const houseNameOf = (id: HouseId): string =>
    getHouseDisplayName(resolveName, state.houses[id], id)

  const legend = (
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
  )

  return (
    <TreeModal
      title={title}
      hint={t('detail.family_tree.hint')}
      legend={legend}
      onClose={onClose}
      contentWidth={layout.width}
      contentHeight={layout.height}
      fitKey={houseId}
      empty={graph.nodes.length === 0}
      emptyText={t('detail.family_tree.empty')}
    >
      {({ lod }) => (
        <>
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
              const dim = lineage && !(lineage.has(cl.aId) && lineage.has(cl.bId)) ? DIM : 1
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
                    opacity={dim}
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
                  opacity={dim}
                />
              )
            })}
            {/* 親子線: 父母の中点から子へ 1 本 */}
            {graph.nodes.map((node) => {
              const src = layout.childSource.get(node.personId)
              const c = layout.pos.get(node.personId)
              if (!src || !c) return null
              const inLine =
                lineage &&
                lineage.has(node.personId) &&
                (displayedParentsOf.get(node.personId) ?? []).some((p) => lineage.has(p))
              const dim = lineage && !inLine ? DIM : 1
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
                  opacity={dim}
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
            const person = state.persons[node.personId]
            const personName = person
              ? resolveName('person', person.nameKey, person.nameKey)
              : (node.personId as string)
            return (
              <div
                key={node.personId}
                className={`absolute rounded border ${borderClass} bg-gray-800/95`}
                style={{ left: p.x, top: p.y, width: NODE_W, opacity: nodeOpacity(node.personId) }}
                onMouseEnter={() => setHovered(node.personId)}
                onMouseLeave={() => setHovered(null)}
              >
                {lod === 'compact' ? (
                  // ズームアウト時: 名前のみの簡易ノード (大きめ太字で縮小しても読める)。
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
                    />
                    {relationLabel !== undefined && linkHouseId !== undefined && (
                      <button
                        className="w-full truncate px-1 pb-0.5 text-left text-xs text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onHouseClick(linkHouseId, 'house')}
                      >
                        {relationLabel}
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </>
      )}
    </TreeModal>
  )
}
