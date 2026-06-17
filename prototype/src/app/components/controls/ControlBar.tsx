import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconChevronRight,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBack,
  IconPlayerTrackPrev,
} from '@tabler/icons-react'
import { ConfigPanel } from './ConfigPanel'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { formatYearWeek } from '@/app/utils/format'
import { CHROME, BRAND_SERIF } from '@/app/theme/chrome'
import type { WorldPresetName } from '@sim/worldgen/worldPresets'

const PRESET_OPTIONS: { value: WorldPresetName; label: string }[] = [
  { value: 'tiny', label: 'Tiny (4×4)' },
  { value: 'small', label: 'Small (9×9)' },
  { value: 'standard', label: 'Standard (16×16)' },
  { value: 'perfLarge', label: 'Large (20×20)' },
]

/** アイコンのみのツールバーボタン。時間操作ボタンの見た目を統一する。 */
function IconButton({
  children,
  title,
  onClick,
  disabled = false,
  active = false,
}: {
  children: ReactNode
  title: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
        disabled
          ? 'cursor-not-allowed text-gray-600'
          : active
            ? 'text-white'
            : 'text-gray-200 hover:bg-gray-700'
      }`}
      style={active && !disabled ? { backgroundColor: CHROME.accentFill } : undefined}
    >
      {children}
    </button>
  )
}

/** 「1 単位進める」ステップボタン。共通の前進アイコン + 時間単位ラベルで区別する。 */
function StepButton({
  label,
  title,
  onClick,
}: {
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-8 items-center gap-0.5 rounded px-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-700"
    >
      <span className="font-medium">{label}</span>
      <IconChevronRight size={16} stroke={2} />
    </button>
  )
}

/** 機能グループ間の縦棒セパレータ。 */
function Separator() {
  return <div className="h-6 w-px shrink-0 bg-gray-700" aria-hidden />
}

export function ControlBar() {
  const session = useSimulationStore((s) => s.session)
  const isRunning = useSimulationStore((s) => s.isRunning)
  const speed = useSimulationStore((s) => s.speed)
  const generateNewWorld = useSimulationStore((s) => s.generateNewWorld)
  const resetWorld = useSimulationStore((s) => s.resetWorld)
  const tickOnce = useSimulationStore((s) => s.tickOnce)
  const tickMonth = useSimulationStore((s) => s.tickMonth)
  const tickYear = useSimulationStore((s) => s.tickYear)
  const setRunning = useSimulationStore((s) => s.setRunning)
  const setSpeed = useSimulationStore((s) => s.setSpeed)

  const { t } = useTranslation()
  const currentYear = session?.currentState.currentYear ?? null
  const currentWeekOfYear = session?.currentState.currentWeekOfYear ?? null
  const [seedInput, setSeedInput] = useState(session?.initialSeed ?? 'chronicae-default')
  const [presetInput, setPresetInput] = useState<WorldPresetName>('tiny')

  const dateDisplay =
    currentYear != null && currentWeekOfYear != null
      ? formatYearWeek(currentYear, currentWeekOfYear)
      : '---'

  return (
    <div className="flex h-12 w-full items-center gap-2 bg-gray-900 px-4 py-2 text-white">
      {/* マストヘッド: ブランドワードマーク (Spectral) + 現在日付の dateline */}
      <div className="flex items-baseline gap-2.5">
        <span className="text-xl font-semibold tracking-wide" style={{ fontFamily: BRAND_SERIF }}>
          {t('app.title')}
        </span>
        <span className="min-w-44 text-sm text-gray-400 tabular-nums">{dateDisplay}</span>
      </div>

      <Separator />

      {/* 再生トランスポート */}
      <div className="flex items-center gap-0.5">
        <IconButton onClick={resetWorld} title={t('buttons.reset')}>
          <IconPlayerSkipBack size={18} stroke={2} />
        </IconButton>
        <IconButton disabled title={t('controls.cannot_rewind')}>
          <IconPlayerTrackPrev size={18} stroke={2} />
        </IconButton>
        <IconButton
          onClick={() => setRunning(!isRunning)}
          title={isRunning ? t('buttons.pause') : t('buttons.start')}
          active={isRunning}
        >
          {isRunning ? <IconPlayerPauseFilled size={18} /> : <IconPlayerPlayFilled size={18} />}
        </IconButton>
      </div>

      <Separator />

      {/* ステップ送り */}
      <div className="flex items-center gap-0.5">
        <StepButton
          label={t('controls.unit_week')}
          title={t('controls.advance_week')}
          onClick={tickOnce}
        />
        <StepButton
          label={t('controls.unit_month')}
          title={t('controls.advance_month')}
          onClick={tickMonth}
        />
        <StepButton
          label={t('controls.unit_year')}
          title={t('controls.advance_year')}
          onClick={tickYear}
        />
      </div>

      <Separator />

      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="rounded bg-gray-800 px-1 py-0.5"
      >
        <option value={1}>1x</option>
        <option value={2}>2x</option>
        <option value={4}>4x</option>
        <option value={8}>8x</option>
      </select>

      <span>{t('controls.seed')}:</span>
      <input
        type="text"
        value={seedInput}
        onChange={(e) => setSeedInput(e.target.value)}
        placeholder="Enter seed"
        className="w-40 rounded bg-gray-800 px-2 py-0.5 text-white"
      />
      <select
        value={presetInput}
        onChange={(e) => setPresetInput(e.target.value as WorldPresetName)}
        className="rounded bg-gray-800 px-1 py-0.5"
      >
        {PRESET_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        onClick={() => {
          if (seedInput) generateNewWorld(seedInput, presetInput)
        }}
        className="rounded bg-gray-700 px-3 py-1 hover:bg-gray-600"
      >
        Generate
      </button>

      <div className="relative ml-auto">
        <ConfigPanel />
      </div>
    </div>
  )
}
