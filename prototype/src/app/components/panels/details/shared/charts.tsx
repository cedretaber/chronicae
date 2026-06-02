import { useTranslation } from 'react-i18next'
import { ABILITY_KEYS } from './constants'

export function AbilityRadarChart({
  abilities,
  aptitudes,
  size = 192,
}: {
  abilities: Record<string, number>
  aptitudes: Record<string, number>
  size?: number
}) {
  const { t } = useTranslation()
  const cx = size / 2
  const cy = size / 2
  const maxVal = 100
  const rings = [25, 50, 75, 100]
  const r = (size - 48) / 2

  const vertex = (i: number, val: number): [number, number] => {
    const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2
    const ratio = val / maxVal
    return [cx + r * ratio * Math.cos(angle), cy + r * ratio * Math.sin(angle)]
  }

  const gridPoints = (val: number) => ABILITY_KEYS.map((_, i) => vertex(i, val).join(',')).join(' ')

  const dataPoints = (vals: Record<string, number>) =>
    ABILITY_KEYS.map((k, i) => vertex(i, vals[k] ?? 0).join(',')).join(' ')

  return (
    <svg width={size} height={size} className="mx-auto">
      {rings.map((ringVal) => (
        <polygon
          key={ringVal}
          points={gridPoints(ringVal)}
          fill="none"
          stroke="#4b5563"
          strokeWidth="0.5"
        />
      ))}
      {ABILITY_KEYS.map((_, i) => {
        const [ex, ey] = vertex(i, maxVal)
        return <line key={i} x1={cx} y1={cy} x2={ex} y2={ey} stroke="#4b5563" strokeWidth="0.5" />
      })}
      <polygon
        points={dataPoints(aptitudes)}
        fill="rgba(156,163,175,0.15)"
        stroke="#9ca3af"
        strokeWidth="1"
      />
      <polygon
        points={dataPoints(abilities)}
        fill="rgba(96,165,250,0.25)"
        stroke="#60a5fa"
        strokeWidth="1.5"
      />
      {ABILITY_KEYS.map((k, i) => {
        const [lx, ly] = vertex(i, maxVal + 18)
        return (
          <text
            key={k}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-gray-400 text-[9px]"
          >
            {t(`detail.person.ability_${k}`)}
          </text>
        )
      })}
    </svg>
  )
}

export function ShareDonutChart({
  slices,
  size = 80,
}: {
  slices: Array<{ percent: number; color: string }>
  size?: number
}) {
  const r = 32
  const circumference = 2 * Math.PI * r
  const arcs = slices.reduce<Array<{ dash: number; offset: number; color: string }>>((acc, s) => {
    const prevOffset = acc.length > 0 ? acc[acc.length - 1]!.offset + acc[acc.length - 1]!.dash : 0
    acc.push({ dash: (s.percent / 100) * circumference, offset: prevOffset, color: s.color })
    return acc
  }, [])
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className="shrink-0">
      {arcs.map((a, i) => (
        <circle
          key={i}
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={a.color}
          strokeWidth="12"
          strokeDasharray={`${a.dash} ${circumference - a.dash}`}
          strokeDashoffset={-a.offset}
          transform="rotate(-90 40 40)"
        />
      ))}
    </svg>
  )
}
