import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { defaultConfig, type SimulationConfig } from '@/sim/config/defaultConfig'

type ConfigKey = keyof SimulationConfig

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
    <div className="mb-3">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span className="text-gray-200">{displayValue}</span>
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

function NumberRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
      <span className="text-gray-400">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) onChange(n)
        }}
        className="w-24 rounded bg-gray-700 px-1 py-0.5 text-right text-white"
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

function TextRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
      <span className="text-gray-400">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-32 rounded bg-gray-700 px-1 py-0.5 text-white"
      />
    </div>
  )
}

// よく触る主要ノブだけ「良い UX」(スライダー + 整形ラベル + 単位表示) を与える override 層。
// ここに無い number/boolean は auto-derive で汎用入力として出る (range 発明・drift を避けるため)。
type CuratedEntry = {
  label: string
  min: number
  max: number
  step: number
  format?: 'percent' | 'weeks'
}
const CURATED: Partial<Record<ConfigKey, CuratedEntry>> = {
  replacementThreshold: { label: 'Replacement Threshold', min: 0, max: 50, step: 1 },
  warCooldownWeeks: { label: 'War Cooldown', min: 24, max: 260, step: 26, format: 'weeks' },
  maxWarsPerTick: { label: 'Max Wars/Tick', min: 1, max: 5, step: 1 },
  famineBaseChancePerYear: {
    label: 'Famine Chance/Year',
    min: 0,
    max: 0.3,
    step: 0.01,
    format: 'percent',
  },
  plagueBaseChancePerYear: {
    label: 'Plague Chance/Year',
    min: 0,
    max: 0.3,
    step: 0.01,
    format: 'percent',
  },
  controlMaxDistancePenalty: { label: 'Distance Penalty', min: 5, max: 20, step: 1 },
  controlMaxMinimum: { label: 'Control Minimum', min: 10, max: 60, step: 5 },
  controlGrowthPerMonth: { label: 'Growth/mo', min: 0.5, max: 5, step: 0.5 },
  controlDecayPerMonth: { label: 'Decay/mo', min: 0.5, max: 5, step: 0.5 },
  disconnectedControlDecayPerMonth: { label: 'Disconnected Decay/mo', min: 1, max: 10, step: 1 },
  landDevelopmentHouseControlGain: { label: 'Dev House Control Gain', min: 1, max: 10, step: 1 },
  lordshipAbsorptionTargetThreshold: {
    label: 'Lordship Target Threshold',
    min: 10,
    max: 70,
    step: 5,
  },
  lordshipAbsorptionSourceMinimum: { label: 'Lordship Source Minimum', min: 40, max: 80, step: 5 },
  lordshipAbsorptionMonthlyChance: {
    label: 'Lordship Monthly Chance',
    min: 0.01,
    max: 0.2,
    step: 0.01,
    format: 'percent',
  },
  marriageYearlyChance: {
    label: 'Marriage Chance/Year',
    min: 0,
    max: 1,
    step: 0.05,
    format: 'percent',
  },
  baseBirthChancePerMalePerYear: {
    label: 'Birth Chance/Year',
    min: 0,
    max: 2,
    step: 0.05,
  },
  baseHouseSplitChance: {
    label: 'House Split Chance',
    min: 0,
    max: 1,
    step: 0.05,
    format: 'percent',
  },
}

// タブ定義。区分は defaultConfig.ts のコメントセクションに対応し、key prefix で振り分ける
// (上から順に最初にマッチしたタブへ。どこにも当たらない長い末尾は Advanced に集約)。
type TabDef = {
  id: string
  label: string
  prefixes: string[]
  exact?: string[]
}
const TAB_DEFS: TabDef[] = [
  {
    id: 'general',
    label: 'General',
    prefixes: [],
    exact: [
      'uiLocale',
      'maxRawEvents',
      'maxChronicleEvents',
      'debug',
      'integrityPerSystem',
      'nameCultureId',
    ],
  },
  {
    id: 'politics',
    label: 'Politics',
    prefixes: ['plot', 'rebellion', 'replacement', 'baseplot'],
    exact: ['minLivingMembersPerHouse', 'maxNewPersonsPerHousePerYear'],
  },
  {
    id: 'succession',
    label: 'Succession',
    prefixes: ['succession', 'minorhead'],
    exact: [
      'adultAge',
      'allowFemaleHouseHeadWhenNoMaleHeir',
      'allowFemaleRolesWhenNoMaleCandidate',
      'femaleRoleEligibilityChance',
      'prestigeSuccessionWeight',
      'adminSuccessionWeight',
      'martialSuccessionWeight',
      'ambitionSuccessionWeight',
      'randomSuccessionNoiseMax',
      'illegitimateSuccessionPenalty',
      'unknownBirthStatusSuccessionPenalty',
    ],
  },
  {
    id: 'population',
    label: 'Population',
    prefixes: [
      'marriage',
      'birth',
      'mortality',
      'father',
      'mother',
      'spouse',
      'male',
      'adult',
      'genius',
      'population',
      'targetliving',
      'criticalliving',
      'highliving',
      'lowpopulation',
      'criticalpopulation',
      'highpopulation',
    ],
    exact: ['baseBirthChancePerMalePerYear', 'samePrimaryPolityMarriageBonus'],
  },
  {
    id: 'houses',
    label: 'Houses',
    prefixes: [
      'housesplit',
      'houseextinction',
      'houseless',
      'housefounding',
      'extinction',
      'inheritedprovince',
      'pruning',
      'protection',
      'rulerhouse',
      'annexbyruler',
      'founder',
      'clanformation',
      'influentialhouse',
      'cadetbranch',
    ],
    exact: ['minProvincesForHouseSplit', 'baseHouseSplitChance'],
  },
  {
    id: 'factions',
    label: 'Factions',
    prefixes: ['faction', 'recruit', 'support', 'officeopportunity'],
  },
  {
    id: 'war',
    label: 'War',
    prefixes: [
      'war',
      'battle',
      'regiment',
      'levy',
      'captaingeneral',
      'commander',
      'flank',
      'retreat',
      'route',
      'rout',
      'mercenary',
      'housemanpower',
      'housemilitary',
      'housewealthmilitary',
      'housecommander',
      'polityadminmilitary',
      'minhousemilitary',
      'mincommander',
      'maxcommander',
      'minfighting',
      'morale',
      'maxwar',
      'minwar',
      'maxprovincesperwar',
      'maxwarspertick',
      'minattacker',
      'winchance',
      'failedwar',
      'locallevy',
      'terminalwar',
      'defaulttransfer',
      'defaultchange',
      'defaultpopular',
      'destroyedregiment',
      'winnerstrength',
      'loserstrength',
      'maxflank',
      'generalmartial',
      'generalambition',
      'generalcaution',
    ],
  },
  {
    id: 'disaster',
    label: 'Disaster',
    prefixes: ['disaster', 'famine', 'plague', 'bountiful'],
  },
  {
    id: 'realm',
    label: 'Realm',
    prefixes: [
      'control',
      'disconnected',
      'land',
      'lordship',
      'annex',
      'newrulerhouse',
      'republic',
      'rankpromotion',
      'housedomainconsolidation',
    ],
  },
  {
    id: 'economy',
    label: 'Economy',
    prefixes: [
      'pop',
      'tax',
      'bailiff',
      'estate',
      'office',
      'admin',
      'share',
      'influence',
      'poverty',
      'prosperity',
      'unrest',
      'productiv',
      'manpower',
      'retained',
      'overextraction',
      'occupation',
      'localextraction',
      'duplicateoffice',
      'concurrentoffice',
      'minappointment',
      'movement',
      'basecountry',
      'ruleradmin',
      'administrator',
      'treasurer',
      'minadmin',
      'maxadmin',
      'houseshare',
      'housesurplus',
      'housewealthreserve',
      'publicspending',
      'collectionfriction',
      'comfortable',
      'placeholder',
      'polity',
      'purchase',
      'rightinheritance',
      'ownerhouse',
    ],
  },
  {
    id: 'diplomacy',
    label: 'Diplomacy',
    prefixes: [
      'diplomatic',
      'conflict',
      'claim',
      'acquire',
      'revolt',
      'provincerevolt',
      'peasantrevolt',
      'townsmen',
      'noble',
      'negotiat',
      'offer',
      'tension',
      'contracttax',
      'invalidoffer',
      'rejectedoffer',
      'validoffer',
      'counteroffer',
    ],
  },
  {
    id: 'agency',
    label: 'People',
    prefixes: [
      'goal',
      'aim',
      'task',
      'project',
      'ability',
      'agecurve',
      'improvement',
      'holding',
      'develop',
      'prepare',
      'effectivepriority',
      'weeklyaction',
      'promote',
      'patronize',
      'commission',
      'policy',
      'wealthaccumulation',
      'appointment',
      'supervised',
      'pressureresponse',
      'person',
      'experience',
      'lifestage',
      'oldage',
      'parentalability',
    ],
  },
  { id: 'advanced', label: 'Advanced', prefixes: [] },
]

function categorize(key: string): string {
  const lower = key.toLowerCase()
  for (const tab of TAB_DEFS) {
    if (tab.exact?.includes(key)) return tab.id
    if (tab.prefixes.some((p) => lower.startsWith(p))) return tab.id
  }
  return 'advanced'
}

function formatSliderValue(value: number, format?: 'percent' | 'weeks'): string {
  if (format === 'percent') return `${(value * 100).toFixed(0)}%`
  if (format === 'weeks') return `${value} weeks`
  return String(value)
}

// camelCase の key を読みやすいラベルへ ("warCooldownWeeks" -> "War Cooldown Weeks")。
function prettyLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

export function ConfigPanel() {
  const [open, setOpen] = useState(false)
  const [activeTabId, setActiveTabId] = useState('general')
  const config = useSimulationStore((s) => s.config)
  const setConfig = useSimulationStore((s) => s.setConfig)
  const { i18n } = useTranslation()

  // defaultConfig の全キーを走査し、number / boolean / 一部 string だけを各タブに振り分ける。
  // object 値 (Record<...> 系) は UI 非対応なので除外。表示値は live な config から取る。
  const groups = useMemo(() => {
    const map = new Map<string, ConfigKey[]>()
    for (const tab of TAB_DEFS) map.set(tab.id, [])
    for (const key of Object.keys(defaultConfig) as ConfigKey[]) {
      const value = defaultConfig[key]
      const t = typeof value
      // number / boolean / string(enum/locale 含む) のみ UI 対応。Record<...> 等の object は除外。
      const renderable = t === 'number' || t === 'boolean' || t === 'string'
      if (!renderable) continue
      map.get(categorize(key))?.push(key)
    }
    return map
  }, [])

  const visibleTabs = useMemo(
    () => TAB_DEFS.filter((tab) => (groups.get(tab.id)?.length ?? 0) > 0),
    [groups],
  )

  const activeTab = visibleTabs.find((tab) => tab.id === activeTabId) ?? visibleTabs[0]

  const renderItem = (key: ConfigKey) => {
    // 特殊扱い: enum/locale は select で。
    if (key === 'uiLocale') {
      return (
        <div key={key} className="mb-2 flex items-center justify-between text-xs">
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
      )
    }
    if (key === 'rebellionSuccessMode') {
      return (
        <div key={key} className="mb-2 flex items-center justify-between text-xs">
          <span className="text-gray-400">Rebellion Mode</span>
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
      )
    }

    const value = config[key]

    if (typeof value === 'boolean') {
      return (
        <ToggleRow
          key={key}
          label={prettyLabel(key)}
          value={value}
          onChange={(v) => setConfig({ [key]: v })}
        />
      )
    }

    if (typeof value === 'number') {
      const curated = CURATED[key]
      if (curated) {
        return (
          <ConfigRow
            key={key}
            label={curated.label}
            value={value}
            min={curated.min}
            max={curated.max}
            step={curated.step}
            displayValue={formatSliderValue(value, curated.format)}
            onChange={(v) => setConfig({ [key]: v })}
          />
        )
      }
      return (
        <NumberRow
          key={key}
          label={prettyLabel(key)}
          value={value}
          onChange={(v) => setConfig({ [key]: v })}
        />
      )
    }

    if (typeof value === 'string') {
      return (
        <TextRow
          key={key}
          label={prettyLabel(key)}
          value={value}
          onChange={(v) => setConfig({ [key]: v })}
        />
      )
    }

    return null
  }

  return (
    <>
      <button
        className="rounded bg-gray-700 px-3 py-1 text-xs hover:bg-gray-600"
        onClick={() => setOpen(true)}
      >
        Config
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
            onMouseDown={() => setOpen(false)}
          >
            <div
              className="flex h-[80vh] w-[820px] max-w-[95vw] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 text-white shadow-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* ヘッダー */}
              <div className="flex shrink-0 items-center justify-between border-b border-gray-700 bg-gray-950 px-4 py-2">
                <span className="text-sm font-semibold text-gray-100">Config</span>
                <button
                  className="rounded px-2 py-0.5 text-gray-400 hover:bg-gray-700 hover:text-red-400"
                  onClick={() => setOpen(false)}
                  title="Close"
                >
                  ×
                </button>
              </div>
              {/* 本体: 左サイドバータブ + 右コンテンツ */}
              <div className="flex min-h-0 flex-1">
                <div className="flex w-40 shrink-0 flex-col overflow-y-auto border-r border-gray-700 bg-gray-950 py-2">
                  {visibleTabs.map((tab) => (
                    <button
                      key={tab.id}
                      className={`px-4 py-1.5 text-left text-xs transition-colors ${
                        tab.id === activeTab?.id
                          ? 'border-l-2 border-blue-400 bg-gray-800 text-white'
                          : 'border-l-2 border-transparent text-gray-400 hover:bg-gray-800'
                      }`}
                      onClick={() => setActiveTabId(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="min-w-0 flex-1 overflow-y-auto p-4">
                  {activeTab && groups.get(activeTab.id)?.map(renderItem)}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
