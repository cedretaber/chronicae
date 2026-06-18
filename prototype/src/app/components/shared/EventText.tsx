import { Fragment, type ReactNode } from 'react'
import type { EventEntityRef, EventMessageParams } from '@sim/types/event'
import type { ClanId } from '@sim/types/ids'
import type { WorldState } from '@sim/types/world'
import { useRenderEventSegments } from '@/app/hooks/useRenderEvent'
import { useEntityName } from '@/app/hooks/useEntityName'
import {
  getPolityShortName,
  getHouseDisplayName,
  getHoldingShortName,
} from '@/app/hooks/entityNameHelpers'
import { useSimulationStore, type EntityType } from '@/app/stores/simulationStore'
import { CHRONICLE_PALETTES, type ChronicleTone } from '@/app/theme/chronicle'

// イベント本文を「素のテキスト + クリック可能なエンティティ参照」として描く共有コンポーネント。
//   本文中の国名・家名・人名・地名等は、対応する entityRef があれば枠付きチップ (リンク) になる。
//   本文に現れない参照 (会戦 ⚔・総大将など) は従来どおり末尾チップとして補う (重複は出さない)。
//   EventLog (メイン日録) と ChronicleAnnal (国/家/個人の年代記) が共有する。

type EntityLink = { id: string; type: EntityType; name: string }

// entityRef を「detail window を開ける表示名つきリンク」に解決する (存在しない/window 無し → null)。
//   インライン本文・末尾チップ双方がこの 1 箇所を使う (リンク可能種別の列挙を 1 本に集約)。
//   war/faction/goal/aim/project 等は終結で消える・window が無い等の理由で null を返しリンク化しない。
function resolveEntityLink(
  state: WorldState,
  resolveName: ReturnType<typeof useEntityName>,
  ref: Pick<EventEntityRef, 'kind' | 'id'>,
): EntityLink | null {
  switch (ref.kind) {
    case 'person': {
      const p = state.persons[ref.id as keyof typeof state.persons]
      return p
        ? { id: ref.id, type: 'person', name: resolveName('person', p.nameKey, p.nameKey) }
        : null
    }
    case 'house': {
      const h = state.houses[ref.id as keyof typeof state.houses]
      return h
        ? { id: ref.id, type: 'house', name: getHouseDisplayName(resolveName, h, h.nameKey) }
        : null
    }
    case 'polity': {
      const pl = state.polities[ref.id as keyof typeof state.polities]
      return pl
        ? { id: ref.id, type: 'polity', name: getPolityShortName(state, resolveName, pl.id) }
        : null
    }
    case 'province': {
      const pr = state.provinces[ref.id as keyof typeof state.provinces]
      return pr
        ? { id: ref.id, type: 'province', name: resolveName('province', pr.nameKey, ref.id) }
        : null
    }
    case 'holding': {
      const ho = state.holdings[ref.id as keyof typeof state.holdings]
      return ho
        ? { id: ref.id, type: 'holding', name: getHoldingShortName(state, resolveName, ho.id) }
        : null
    }
    case 'clan': {
      const c = state.clans[ref.id as ClanId]
      if (!c) return null
      const nh = state.houses[c.nameSourceHouseId]
      return { id: ref.id, type: 'clan', name: getHouseDisplayName(resolveName, nh, ref.id) }
    }
    case 'battleLog': {
      const b = state.battleLogs[ref.id as keyof typeof state.battleLogs]
      if (!b) return null
      const prov = state.provinces[b.provinceId]
      const place = prov
        ? resolveName('province', prov.nameKey, b.provinceId)
        : (b.provinceId as string)
      return { id: ref.id, type: 'battleLog', name: `⚔ ${place}` }
    }
    default:
      return null
  }
}

// hover で鉄丹 (年見出しの朱) に変化させ「リンクである」ことを明示する (tone 別の rubric 色)。
const HOVER_CLASS: Record<ChronicleTone, string> = {
  dark: 'hover:border-[#CC7A5C] hover:text-[#CC7A5C]',
  vellum: 'hover:border-[#9E3B2E] hover:text-[#9E3B2E]',
}

function LinkChip({
  name,
  title,
  tone,
  onClick,
}: {
  name: string
  title: string
  tone: ChronicleTone
  onClick: () => void
}) {
  const p = CHRONICLE_PALETTES[tone]
  return (
    <button
      type="button"
      className={`mx-px rounded-sm border px-1 align-baseline text-[10px] transition-colors ${HOVER_CLASS[tone]}`}
      style={{ borderColor: p.rail, color: p.category }}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={title}
    >
      {name}
    </button>
  )
}

export function EventText({
  event,
  tone,
}: {
  event: {
    messageKey: string
    messageParams: EventMessageParams
    entityRefs: readonly EventEntityRef[]
  }
  tone: ChronicleTone
}) {
  const renderSegments = useRenderEventSegments()
  const session = useSimulationStore((s) => s.session)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)
  const resolveName = useEntityName()

  const segments = renderSegments(event)
  const state = session?.currentState

  const nodes: ReactNode[] = []
  // 本文中でリンク化済みの (kind,id)。同一エンティティの 2 回目以降はテキストにし (チップ過多回避)、
  //   末尾チップからも除外する (本文で既に辿れるため)。
  const linkedKeys = new Set<string>()

  segments.forEach((seg, i) => {
    if (seg.kind === 'text') {
      nodes.push(<Fragment key={i}>{seg.text}</Fragment>)
      return
    }
    const key = `${seg.entityKind}:${seg.id}`
    const link = state
      ? resolveEntityLink(state, resolveName, { kind: seg.entityKind, id: seg.id })
      : null
    if (!link || linkedKeys.has(key)) {
      // リンク不可 (window 無し/消滅) または同一エンティティの再出現はテキストのまま。
      //   表示名は本文の文法に合う segment 側 (seg.text) を使い、link.name は経路解決にのみ使う。
      nodes.push(<Fragment key={i}>{seg.text}</Fragment>)
      return
    }
    linkedKeys.add(key)
    nodes.push(
      <LinkChip
        key={i}
        name={seg.text}
        title={`${link.type}: ${seg.text}`}
        tone={tone}
        onClick={() => openDetailWindow(link.type, seg.id)}
      />,
    )
  })

  // 末尾チップ: 本文に現れなかった参照のみ (種別ごとに先頭 1 件)。会戦 ⚔・総大将など本文に名が
  //   出ない参照を補完する。本文でリンク済みの種別/エンティティは重複させない。
  const trailing: EntityLink[] = []
  if (state) {
    const seenTrailingKinds = new Set<string>()
    for (const ref of event.entityRefs) {
      if (linkedKeys.has(`${ref.kind}:${ref.id}`)) continue
      if (seenTrailingKinds.has(ref.kind)) continue
      const link = resolveEntityLink(state, resolveName, ref)
      if (!link) continue
      seenTrailingKinds.add(ref.kind)
      trailing.push(link)
    }
  }

  return (
    <span>
      {nodes}
      {trailing.length > 0 && (
        <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
          {trailing.map((it) => (
            <LinkChip
              key={`${it.type}:${it.id}`}
              name={it.name}
              title={`${it.type}: ${it.name}`}
              tone={tone}
              onClick={() => openDetailWindow(it.type, it.id)}
            />
          ))}
        </span>
      )}
    </span>
  )
}
