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

// ある 1 リング分の弧 (percent → dasharray) を組み立てる。12 時位置から時計回り。
function buildRingArcs(
  segments: Array<{ percent: number; color: string }>,
  r: number,
): Array<{ dash: number; gap: number; offset: number; color: string }> {
  const circumference = 2 * Math.PI * r
  let cursor = 0
  return segments.map((s) => {
    const dash = (s.percent / 100) * circumference
    const arc = { dash, gap: circumference - dash, offset: cursor, color: s.color }
    cursor += dash
    return arc
  })
}

// 影響力の二重ドーナツ。外周 = 家の支配率 (グループ単位)、内周 = 家本体 + メンバーの内訳。
// 外周のグループ角度と内周セグメント角度は同じ並びで連続するので、視覚的に「家のかたまり」が揃う。
export function NestedDonutChart({
  groups,
  centerLabel,
  size = 120,
}: {
  groups: Array<{
    color: string
    aggregatePercent: number
    segments: Array<{ percent: number; color: string }>
  }>
  centerLabel?: { title: string; value: string } | undefined
  size?: number
}) {
  const c = size / 2
  const outerR = c - 6
  const innerR = c - 20
  const outerArcs = buildRingArcs(
    groups.map((g) => ({ percent: g.aggregatePercent, color: g.color })),
    outerR,
  )
  // 内周は全グループの全セグメントを並びどおりに連結する。
  const innerSegments = groups.flatMap((g) => g.segments)
  const innerArcs = buildRingArcs(innerSegments, innerR)
  const renderRing = (arcs: ReturnType<typeof buildRingArcs>, r: number, strokeWidth: number) =>
    arcs.map((a, i) => (
      <circle
        key={i}
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={a.color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${a.dash} ${a.gap}`}
        strokeDashoffset={-a.offset}
        transform={`rotate(-90 ${c} ${c})`}
      />
    ))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {renderRing(outerArcs, outerR, 9)}
      {renderRing(innerArcs, innerR, 9)}
      {centerLabel && (
        <>
          <text
            x={c}
            y={c - 4}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-gray-300 text-[9px]"
          >
            {centerLabel.title}
          </text>
          <text
            x={c}
            y={c + 9}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-gray-100 text-[13px] font-semibold"
          >
            {centerLabel.value}
          </text>
        </>
      )}
    </svg>
  )
}
