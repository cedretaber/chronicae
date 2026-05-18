import { useState } from 'react'
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

export function ConfigPanel() {
  const [open, setOpen] = useState(false)
  const config = useSimulationStore((s) => s.config)
  const setConfig = useSimulationStore((s) => s.setConfig)

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
          <ConfigRow
            label="Plot Success Rate"
            value={config.basePlotSuccess}
            min={0}
            max={1}
            step={0.05}
            displayValue={`${(config.basePlotSuccess * 100).toFixed(0)}%`}
            onChange={(v) => setConfig({ basePlotSuccess: v })}
          />
          <ConfigRow
            label="Rebellion Threshold"
            value={config.rebellionThreshold}
            min={0}
            max={150}
            step={5}
            displayValue={String(config.rebellionThreshold)}
            onChange={(v) => setConfig({ rebellionThreshold: v })}
          />
          <ConfigRow
            label="Plot Threshold"
            value={config.plotThreshold}
            min={0}
            max={150}
            step={5}
            displayValue={String(config.plotThreshold)}
            onChange={(v) => setConfig({ plotThreshold: v })}
          />
          <ConfigRow
            label="Replacement Threshold"
            value={config.replacementThreshold}
            min={0}
            max={50}
            step={1}
            displayValue={String(config.replacementThreshold)}
            onChange={(v) => setConfig({ replacementThreshold: v })}
          />
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
          <div className="mt-3 mb-1 text-xs font-semibold text-gray-300">War</div>
          <ToggleRow
            label="War Enabled"
            value={config.warEnabled}
            onChange={(v) => setConfig({ warEnabled: v })}
          />
          <ConfigRow
            label="War Cooldown"
            value={config.warCooldownMonths}
            min={6}
            max={60}
            step={6}
            displayValue={`${config.warCooldownMonths} months`}
            onChange={(v) => setConfig({ warCooldownMonths: v })}
          />
          <ConfigRow
            label="Max Wars/Tick"
            value={config.maxWarsPerTick}
            min={1}
            max={5}
            step={1}
            displayValue={String(config.maxWarsPerTick)}
            onChange={(v) => setConfig({ maxWarsPerTick: v })}
          />
          <div className="mt-3 mb-1 text-xs font-semibold text-gray-300">Disaster</div>
          <ToggleRow
            label="Disaster Enabled"
            value={config.disasterEnabled}
            onChange={(v) => setConfig({ disasterEnabled: v })}
          />
          <ConfigRow
            label="Famine Chance/Year"
            value={config.famineBaseChancePerYear}
            min={0}
            max={0.3}
            step={0.01}
            displayValue={`${(config.famineBaseChancePerYear * 100).toFixed(0)}%`}
            onChange={(v) => setConfig({ famineBaseChancePerYear: v })}
          />
          <div className="mt-3 mb-1 text-xs font-semibold text-gray-300">Public Spending</div>
          <ToggleRow
            label="Public Spending"
            value={config.publicSpendingEnabled}
            onChange={(v) => setConfig({ publicSpendingEnabled: v })}
          />
          <div className="mt-3 mb-1 text-xs font-semibold text-gray-300">Development</div>
          <ToggleRow
            label="House Development"
            value={config.houseDevelopmentEnabled}
            onChange={(v) => setConfig({ houseDevelopmentEnabled: v })}
          />
          <ConfigRow
            label="Positive Decay/mo"
            value={config.developmentPositiveMonthlyDecay}
            min={0}
            max={0.5}
            step={0.05}
            displayValue={String(config.developmentPositiveMonthlyDecay)}
            onChange={(v) => setConfig({ developmentPositiveMonthlyDecay: v })}
          />
          <ConfigRow
            label="Negative Recovery/mo"
            value={config.developmentNegativeMonthlyRecovery}
            min={0}
            max={0.5}
            step={0.05}
            displayValue={String(config.developmentNegativeMonthlyRecovery)}
            onChange={(v) => setConfig({ developmentNegativeMonthlyRecovery: v })}
          />
          <ConfigRow
            label="Polity Dev Cost"
            value={config.polityLandDevelopmentBaseCost}
            min={30}
            max={200}
            step={10}
            displayValue={String(config.polityLandDevelopmentBaseCost)}
            onChange={(v) => setConfig({ polityLandDevelopmentBaseCost: v })}
          />
          <ConfigRow
            label="House Dev Cost"
            value={config.houseLandDevelopmentBaseCost}
            min={20}
            max={150}
            step={5}
            displayValue={String(config.houseLandDevelopmentBaseCost)}
            onChange={(v) => setConfig({ houseLandDevelopmentBaseCost: v })}
          />
          <div className="mt-3 mb-1 text-xs font-semibold text-gray-300">Control System</div>
          <ConfigRow
            label="Distance Penalty"
            value={config.controlMaxDistancePenalty}
            min={5}
            max={20}
            step={1}
            displayValue={String(config.controlMaxDistancePenalty)}
            onChange={(v) => setConfig({ controlMaxDistancePenalty: v })}
          />
          <ConfigRow
            label="Control Minimum"
            value={config.controlMaxMinimum}
            min={10}
            max={60}
            step={5}
            displayValue={String(config.controlMaxMinimum)}
            onChange={(v) => setConfig({ controlMaxMinimum: v })}
          />
          <ConfigRow
            label="Growth/mo"
            value={config.controlGrowthPerMonth}
            min={0.5}
            max={5}
            step={0.5}
            displayValue={String(config.controlGrowthPerMonth)}
            onChange={(v) => setConfig({ controlGrowthPerMonth: v })}
          />
          <ConfigRow
            label="Decay/mo"
            value={config.controlDecayPerMonth}
            min={0.5}
            max={5}
            step={0.5}
            displayValue={String(config.controlDecayPerMonth)}
            onChange={(v) => setConfig({ controlDecayPerMonth: v })}
          />
          <ConfigRow
            label="Disconnected Decay/mo"
            value={config.disconnectedControlDecayPerMonth}
            min={1}
            max={10}
            step={1}
            displayValue={String(config.disconnectedControlDecayPerMonth)}
            onChange={(v) => setConfig({ disconnectedControlDecayPerMonth: v })}
          />
          <ConfigRow
            label="Dev House Control Gain"
            value={config.landDevelopmentHouseControlGain}
            min={1}
            max={10}
            step={1}
            displayValue={String(config.landDevelopmentHouseControlGain)}
            onChange={(v) => setConfig({ landDevelopmentHouseControlGain: v })}
          />
          <div className="mt-3 mb-1 text-xs font-semibold text-gray-300">Lordship Transition</div>
          <ConfigRow
            label="Target Threshold"
            value={config.lordshipAbsorptionTargetThreshold}
            min={10}
            max={70}
            step={5}
            displayValue={String(config.lordshipAbsorptionTargetThreshold)}
            onChange={(v) => setConfig({ lordshipAbsorptionTargetThreshold: v })}
          />
          <ConfigRow
            label="Source Minimum"
            value={config.lordshipAbsorptionSourceMinimum}
            min={40}
            max={80}
            step={5}
            displayValue={String(config.lordshipAbsorptionSourceMinimum)}
            onChange={(v) => setConfig({ lordshipAbsorptionSourceMinimum: v })}
          />
          <ConfigRow
            label="Monthly Chance"
            value={config.lordshipAbsorptionMonthlyChance}
            min={0.01}
            max={0.2}
            step={0.01}
            displayValue={`${(config.lordshipAbsorptionMonthlyChance * 100).toFixed(0)}%`}
            onChange={(v) => setConfig({ lordshipAbsorptionMonthlyChance: v })}
          />
        </div>
      )}
    </div>
  )
}
