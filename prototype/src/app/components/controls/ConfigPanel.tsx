import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSimulationStore } from '@/app/stores/simulationStore'
import type { SimulationConfig } from '@/sim/config/defaultConfig'

function ConfigRow({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  displayValue: string
  onChange: (v: number) => void
}) {
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span>{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  )
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="mb-2 flex items-center justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <button
        className={`rounded px-2 py-0.5 text-xs transition-colors ${
          value ? 'bg-blue-600 text-white' : 'bg-gray-600 text-gray-400'
        }`}
        onClick={() => onChange(!value)}
      >
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  )
}

// SimulationConfig のうち number / boolean 値を持つキーだけを許可する型。
type NumericConfigKey = {
  [K in keyof SimulationConfig]: SimulationConfig[K] extends number ? K : never
}[keyof SimulationConfig]
type BooleanConfigKey = {
  [K in keyof SimulationConfig]: SimulationConfig[K] extends boolean ? K : never
}[keyof SimulationConfig]

type ConfigItem =
  | { kind: 'header'; label: string }
  | {
      kind: 'slider'
      key: NumericConfigKey
      label: string
      min: number
      max: number
      step: number
      format?: 'percent' | 'weeks'
    }
  | { kind: 'toggle'; key: BooleanConfigKey; label: string }

// Rebellion Mode の select より上に出る冒頭スライダー群。
const TOP_SLIDERS: ConfigItem[] = [
  {
    kind: 'slider',
    key: 'basePlotSuccess',
    label: 'Plot Success Rate',
    min: 0,
    max: 1,
    step: 0.05,
    format: 'percent',
  },
  {
    kind: 'slider',
    key: 'rebellionThreshold',
    label: 'Rebellion Threshold',
    min: 0,
    max: 150,
    step: 5,
  },
  { kind: 'slider', key: 'plotThreshold', label: 'Plot Threshold', min: 0, max: 150, step: 5 },
  {
    kind: 'slider',
    key: 'replacementThreshold',
    label: 'Replacement Threshold',
    min: 0,
    max: 50,
    step: 1,
  },
]

// Rebellion Mode の select より下のセクション群。
const SECTIONS: ConfigItem[] = [
  { kind: 'header', label: 'War' },
  { kind: 'toggle', key: 'warEnabled', label: 'War Enabled' },
  {
    kind: 'slider',
    key: 'warCooldownWeeks',
    label: 'War Cooldown',
    min: 24,
    max: 260,
    step: 26,
    format: 'weeks',
  },
  { kind: 'slider', key: 'maxWarsPerTick', label: 'Max Wars/Tick', min: 1, max: 5, step: 1 },
  { kind: 'header', label: 'Disaster' },
  { kind: 'toggle', key: 'disasterEnabled', label: 'Disaster Enabled' },
  {
    kind: 'slider',
    key: 'famineBaseChancePerYear',
    label: 'Famine Chance/Year',
    min: 0,
    max: 0.3,
    step: 0.01,
    format: 'percent',
  },
  { kind: 'header', label: 'Public Spending' },
  { kind: 'toggle', key: 'publicSpendingEnabled', label: 'Public Spending' },
  { kind: 'header', label: 'Control System' },
  {
    kind: 'slider',
    key: 'controlMaxDistancePenalty',
    label: 'Distance Penalty',
    min: 5,
    max: 20,
    step: 1,
  },
  { kind: 'slider', key: 'controlMaxMinimum', label: 'Control Minimum', min: 10, max: 60, step: 5 },
  { kind: 'slider', key: 'controlGrowthPerMonth', label: 'Growth/mo', min: 0.5, max: 5, step: 0.5 },
  { kind: 'slider', key: 'controlDecayPerMonth', label: 'Decay/mo', min: 0.5, max: 5, step: 0.5 },
  {
    kind: 'slider',
    key: 'disconnectedControlDecayPerMonth',
    label: 'Disconnected Decay/mo',
    min: 1,
    max: 10,
    step: 1,
  },
  {
    kind: 'slider',
    key: 'landDevelopmentHouseControlGain',
    label: 'Dev House Control Gain',
    min: 1,
    max: 10,
    step: 1,
  },
  { kind: 'header', label: 'Lordship Transition' },
  {
    kind: 'slider',
    key: 'lordshipAbsorptionTargetThreshold',
    label: 'Target Threshold',
    min: 10,
    max: 70,
    step: 5,
  },
  {
    kind: 'slider',
    key: 'lordshipAbsorptionSourceMinimum',
    label: 'Source Minimum',
    min: 40,
    max: 80,
    step: 5,
  },
  {
    kind: 'slider',
    key: 'lordshipAbsorptionMonthlyChance',
    label: 'Monthly Chance',
    min: 0.01,
    max: 0.2,
    step: 0.01,
    format: 'percent',
  },
]

function formatSliderValue(value: number, format?: 'percent' | 'weeks'): string {
  if (format === 'percent') return `${(value * 100).toFixed(0)}%`
  if (format === 'weeks') return `${value} weeks`
  return String(value)
}

export function ConfigPanel() {
  const [open, setOpen] = useState(false)
  const config = useSimulationStore((s) => s.config)
  const setConfig = useSimulationStore((s) => s.setConfig)
  const { i18n } = useTranslation()

  const renderItem = (item: ConfigItem) => {
    if (item.kind === 'header') {
      return (
        <div key={`h:${item.label}`} className="mt-3 mb-1 text-xs font-semibold text-gray-300">
          {item.label}
        </div>
      )
    }
    if (item.kind === 'toggle') {
      return (
        <ToggleRow
          key={item.key}
          label={item.label}
          value={config[item.key]}
          onChange={(v) => setConfig({ [item.key]: v })}
        />
      )
    }
    const value = config[item.key]
    return (
      <ConfigRow
        key={item.key}
        label={item.label}
        value={value}
        min={item.min}
        max={item.max}
        step={item.step}
        displayValue={formatSliderValue(value, item.format)}
        onChange={(v) => setConfig({ [item.key]: v })}
      />
    )
  }

  return (
    <div className="relative">
      <button
        className="rounded bg-gray-700 px-3 py-1 text-xs hover:bg-gray-600"
        onClick={() => setOpen((v) => !v)}
      >
        Config
      </button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 w-72 rounded bg-gray-800 p-3 shadow-lg">
          <div className="mb-3 flex items-center justify-between text-xs">
            <span className="text-gray-400">Language</span>
            <select
              value={i18n.language}
              onChange={(e) => void i18n.changeLanguage(e.target.value)}
              className="rounded bg-gray-700 px-1 py-0.5 text-white"
            >
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </div>
          {TOP_SLIDERS.map(renderItem)}
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-gray-400">Rebellion Mode:</span>
            <select
              value={config.rebellionSuccessMode}
              onChange={(e) =>
                setConfig({
                  rebellionSuccessMode: e.target.value as SimulationConfig['rebellionSuccessMode'],
                })
              }
              className="rounded bg-gray-700 px-1 py-0.5 text-white"
            >
              <option value="independence">Independence</option>
              <option value="ruler_change">Ruler Change</option>
            </select>
          </div>
          {SECTIONS.map(renderItem)}
        </div>
      )}
    </div>
  )
}
