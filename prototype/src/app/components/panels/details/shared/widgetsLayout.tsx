import type { ChronicleEntry, ChronicleCategory } from '@sim/types/chronicle'
import { useTranslation } from 'react-i18next'
import { ChronicleAnnal } from './ChronicleAnnal'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { CHROME } from '@/app/theme/chrome'
import { useSimulationStore, type EntityType } from '@/app/stores/simulationStore'

// Detail パネル共通のヘッダー行。タイトル (text-lg font-bold) と、任意の badge
// (タイトル右隣) / actions (右端、CopyJsonButton や WatchButton 等) を配置する。
// title 直接 span だったパネルも gap-2 ラッパ・gap-1.5 ラッパで囲うが、単一子では
// 視覚的に従来と同一。
export function PanelHeader({
  title,
  badge,
  actions,
}: {
  title: ReactNode
  badge?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold">{title}</span>
        {badge}
      </div>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
  )
}

// Detail パネル共通のセクション見出し。密なパネルで節の切れ目を一目で追えるよう、chrome の
// 冷色アクセント (鋼青) を細い左罫のアンカーにする (= 「計器」面の構造マーカー)。tone='alert'
// は危機など警告節用に赤系。count を渡すと見出し右に件数を添える。
//   従来バラついていた `text-sm font-semibold text-gray-300` / `font-medium` などをこれに統一する。
export function DetailSection({
  title,
  count,
  tone = 'default',
}: {
  title: ReactNode
  count?: number
  tone?: 'default' | 'alert'
}) {
  const accent = tone === 'alert' ? '#b91c1c' : CHROME.accent
  const textColor = tone === 'alert' ? 'text-red-300' : 'text-gray-300'
  return (
    <div
      className={`mt-2 flex items-baseline gap-2 border-l-2 pl-2 text-sm font-semibold ${textColor}`}
      style={{ borderColor: accent }}
    >
      <span>{title}</span>
      {count !== undefined && <span className="font-normal text-gray-500">({count})</span>}
    </div>
  )
}

// DetailSection の 1 段下のサブ見出し。節 (DetailSection/CollapsibleSection) の *内側* で、
// さらに細かい括り (例: 現在の目標の下の「狙い」「外交劇」、指導部ブロックの「役職」「大株主」) を示す。
//   peer 節と区別するため、冷色アクセント罫を持たず・小さめ (text-xs)・薄色 (gray-400)・軽い字下げ。
//   従来バラついていた `<strong>`+inline margin / `text-sm font-semibold text-gray-300` のサブ見出しをこれに統一する。
export function DetailSubSection({ title, count }: { title: ReactNode; count?: number }) {
  return (
    <div className="mt-1.5 flex items-baseline gap-1.5 pl-2 text-xs font-semibold text-gray-400">
      <span>{title}</span>
      {count !== undefined && <span className="font-normal text-gray-500">({count})</span>}
    </div>
  )
}

// 折りたたみ可能なセクション。DetailSection と同じ冷色アクセントの見出しに開閉シェブロンを足し、
// open のとき children を描く。状態は呼び出し側 (useCollapsedSections) が集約管理する controlled。
//   情報量の多い詳細パネルで、ユーザーが不要な節を畳めるようにする (既定は開)。
export function CollapsibleSection({
  title,
  count,
  tone = 'default',
  open,
  onToggle,
  children,
}: {
  title: ReactNode
  count?: number
  tone?: 'default' | 'alert'
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const accent = tone === 'alert' ? '#b91c1c' : CHROME.accent
  const textColor = tone === 'alert' ? 'text-red-300' : 'text-gray-300'
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-baseline gap-1.5 border-l-2 pl-1.5 text-left text-sm font-semibold ${textColor}`}
        style={{ borderColor: accent }}
      >
        <span className="w-3 shrink-0 text-xs text-gray-500">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        {count !== undefined && <span className="font-normal text-gray-500">({count})</span>}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  )
}

// v0.38 §8: 対象 entity の永続歴史 (ChronicleEntry) を時系列降順で表示する共通 section。
//   entries は selector 側で既に降順 sort 済み。category filter を後付けできるよう
//   showCategories prop を最初から受け取る (未指定なら全カテゴリ表示。§8.2)。
//   entityType/entityId を渡すと「完全版を見る」ボタンを出し、全履歴パネルを開ける。
export function EntityChronicleSection({
  title,
  entries,
  limit = 10,
  showCategories,
  entityType,
  entityId,
}: {
  title: string
  entries: ChronicleEntry[]
  limit?: number
  showCategories?: ReadonlySet<ChronicleCategory>
  entityType?: EntityType
  entityId?: string
}) {
  const { t } = useTranslation()
  const openChronicleWindow = useSimulationStore((s) => s.openChronicleWindow)
  const filtered = showCategories ? entries.filter((e) => showCategories.has(e.category)) : entries
  const visible = filtered.slice(0, limit)
  if (filtered.length === 0) return null
  return (
    <div className="mt-2">
      <div className="text-sm font-semibold text-gray-300">{title}:</div>
      {/* インライン年代記は host の暗色ウィンドウに馴染む dark トーン。構造 (時の罫・年見出し・
          週·重要度印·カテゴリ·本文) は FullChroniclePanel の vellum 版と ChronicleAnnal で共有。 */}
      <ChronicleAnnal entries={visible} tone="dark" />
      {entityType && entityId && (
        <button
          className="mt-1 text-xs text-blue-400 hover:text-blue-300"
          onClick={() => openChronicleWindow(entityType, entityId)}
        >
          {t('detail.full_chronicle.open', { count: filtered.length })}
        </button>
      )}
    </div>
  )
}

export function WatchButton({
  isWatching,
  onToggle,
}: {
  isWatching: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      className={`rounded px-2 py-0.5 text-xs transition-colors ${
        isWatching
          ? 'bg-yellow-600 text-white hover:bg-yellow-500'
          : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
      }`}
      onClick={onToggle}
    >
      {isWatching ? `\u2605 ${t('buttons.watching')}` : `\u2606 ${t('buttons.watch')}`}
    </button>
  )
}

// v0.17.4 UI: \u8a73\u7d30\u30d1\u30cd\u30eb\u306e\u5185\u5bb9\u3092 JSON \u5f62\u5f0f\u3067\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u3078\u30b3\u30d4\u30fc\u3059\u308b\u30dc\u30bf\u30f3\u3002
// LLM \u3084\u5916\u90e8\u30c4\u30fc\u30eb\u306b\u300c\u753b\u9762\u3067\u898b\u3048\u3066\u3044\u308b\u4eba\u7269\u30fb\u56fd\u30fb\u5bb6\u30fb\u5dde\u30fbPOP\u300d\u3092\u69cb\u9020\u5316\u5171\u6709\u3059\u308b\u305f\u3081\u306e\u88dc\u52a9\u3002
export function CopyJsonButton({ payload }: { payload: unknown }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleClick = (): void => {
    const text = JSON.stringify(payload, null, 2)
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch((e: unknown) => {
        console.error('Failed to copy JSON to clipboard', e)
      })
  }
  return (
    <button
      className="rounded bg-gray-600 px-2 py-0.5 text-xs text-gray-300 transition-colors hover:bg-gray-500"
      onClick={handleClick}
      title="Copy this entity as JSON to clipboard"
    >
      {copied ? `\u2713 ${t('buttons.copied')}` : `\u29c9 ${t('buttons.copy_json')}`}
    </button>
  )
}
