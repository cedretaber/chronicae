import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getProvinceImage, getHoldingImage } from '@/app/utils/assetHash'
import { formatScore, formatAmount, formatPower, formatPolityRank } from '@/app/utils/format'
import {
  getPolityLegitimacy,
  getPolityStability,
  getHouseCohesion,
  getHouseLoyaltyToPolity,
} from '@sim/selectors/statusSelectors'
import { getAttitudeOrDefault, attitudeValueToScore } from '@sim/helpers/attitudeHelpers'
import { weekToYearWeek } from '@sim/utils/timeUtils'
import {
  getPolityLeaderHouse,
  getPolityLeader,
  getHouseLeader,
  getActiveOfficeHolders,
  getAdministrativeCapacity,
  getAdministrativeLoad,
  getAdministrativeEfficiency,
} from '@sim/selectors/officeSelectors'
import { getDominantPolityHouse, getTopShareholders } from '@sim/selectors/shareSelectors'
import { getRoleScore } from '@sim/selectors/abilitySelectors'
import { isUnaffiliatedPerson, isLandlessHouseMember } from '@sim/selectors/availabilitySelectors'
import {
  getActiveFactionMembership,
  getFactionByLeader,
  getFactionActiveMemberIds,
  getFactionViabilityScore,
  getFactionOpportunityScore,
} from '@sim/selectors/factionSelectors'
import { ANONYMOUS_HOUSE_ID } from '@sim/types/house'
import { ABILITY_AGE_CURVES } from '@sim/constants/abilityConstants'
import { getProvinceDevelopmentMultiplier } from '@/sim/selectors/developmentSelectors'
import {
  getProvincePolityControlFromHoldings,
  getProvinceDevelopmentFromHoldings,
} from '@/sim/selectors/landContractSelectors'
import {
  getProvincePops,
  getProvinceCarryingCapacity,
  getProvincePopulation,
  getProvincePopulationPressure,
  getProvinceAveragePopWealth,
  getProvinceUnrest,
  getPopWealthByClass,
} from '@sim/selectors/popSelectors'
import {
  getProvinceProduction,
  getProvinceManpowerBase,
  getProvinceCountryManpowerBase,
  getProvinceHouseManpowerBase,
} from '@sim/selectors/popEconomySelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import type { Polity } from '@/sim/types/polity'
import type { House } from '@/sim/types/house'
import type { Person } from '@/sim/types/person'
import type { Province } from '@/sim/types/province'
import type { PopGroup } from '@/sim/types/popGroup'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import type { AttitudeMap } from '@/sim/types/attitude'
import type {
  PolityId,
  HouseId,
  PersonId,
  FactionId,
  HoldingId,
  LandContractId,
  ProvinceId,
} from '@/sim/types/ids'
import type { Faction } from '@/sim/types/faction'
import type { ShareHolderRef } from '@/sim/types/office'
import { getPersonPrimaryPolityId } from '@sim/selectors/polityRelations'
import {
  getHousePrimaryPolityId,
  getHouseProvinceIdsByPolity,
  getPolityHouseIds,
} from '@sim/selectors/polityRelations'
import {
  getProvinceTerminalPolityId,
  getProvinceEffectiveOwnerHouseId,
  getHouseControlledProvinceIds,
  getProvinceLandContractChain,
  getHouseOwnedPolityIds,
  getProvinceHoldings,
  getHoldingLandContractChain,
} from '@sim/selectors/landContractSelectors'
import { getHoldingBailiffPerson } from '@sim/selectors/provinceOfficeSelectors'
import { calcAmbitionScores } from '@/sim/tick/ambitionSystem'
import { calcPersonImportanceScore } from '@/sim/selectors/importanceSelectors'
import { calcPolityMilitaryPower } from '@/sim/selectors/militarySelectors'
import { normalizedStat } from '@/sim/selectors/personAbilityEffects'
import { OFFICE_DEFINITIONS } from '@sim/config/officeDefinitions'
import { clamp } from '@/sim/utils/math'
import type { SimEvent } from '@/sim/types/event'
import { hasEntityId } from '@sim/types/event'
import { useRenderEvent } from '@/app/hooks/useRenderEvent'

function getImportanceColor(importance: SimEvent['importance']): string {
  switch (importance) {
    case 'critical':
      return 'text-red-400'
    case 'major':
      return 'text-yellow-400'
    case 'normal':
      return 'text-gray-200'
    case 'minor':
      return 'text-gray-500'
  }
}

type ClickHandler = (id: PolityId | HouseId | PersonId, type: 'person' | 'house' | 'polity') => void

function WatchButton({ isWatching, onToggle }: { isWatching: boolean; onToggle: () => void }) {
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
function CopyJsonButton({ payload }: { payload: unknown }) {
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
      {copied ? '\u2713 Copied' : '\u29c9 Copy JSON'}
    </button>
  )
}

// v0.17.4 UI: \u8a73\u7d30\u30d1\u30cd\u30eb\u8868\u793a\u4e2d\u30a8\u30f3\u30c6\u30a3\u30c6\u30a3\u306e\u300c\u30ea\u30c3\u30c1 JSON snapshot\u300d\u3092\u7d44\u307f\u7acb\u3066\u308b\u3002
// raw entity + \u89e3\u6c7a\u6e08\u307f\u53c2\u7167 (House/Polity/Person \u540d\u7b49) + \u6642\u523b\u6587\u8108\u3092\u542b\u3080\u3002
// LLM \u3078\u306e\u69cb\u9020\u5316\u5171\u6709\u3092\u60f3\u5b9a \u2014 \u904e\u5ea6\u306a derived \u306f\u5165\u308c\u305a\u3001\u751f\u30c7\u30fc\u30bf\u306b\u8584\u3044 overlay \u3092\u88ab\u305b\u308b\u65b9\u91dd\u3002
function buildEntitySnapshot(
  kind: 'polity' | 'house' | 'person' | 'province' | 'popGroup' | 'faction',
  entity: unknown,
  currentState: WorldState | null,
): unknown {
  const meta = currentState
    ? { currentYear: currentState.currentYear, currentWeekOfYear: currentState.currentWeekOfYear }
    : null
  const ws = currentState

  const houseName = (id: HouseId | undefined): string | null =>
    id ? (ws?.houses[id]?.name ?? null) : null
  const polityName = (id: PolityId | undefined): string | null =>
    id ? (ws?.polities[id]?.name ?? null) : null
  const personName = (id: PersonId | undefined): string | null =>
    id ? (ws?.persons[id]?.name ?? null) : null
  const provinceName = (id: string | undefined): string | null =>
    id ? (ws?.provinces[id as import('@sim/types/ids').ProvinceId]?.name ?? null) : null

  if (kind === 'polity') {
    const p = entity as Polity
    const terminalIds = ws
      ? Object.keys(ws.provinces).filter(
          (pid) =>
            getProvinceTerminalPolityId(ws, pid as import('@sim/types/ids').ProvinceId) === p.id,
        )
      : []
    const topShareholders = ws
      ? getTopShareholders(ws, { kind: 'polity', id: p.id }, 5).map(({ holder, percent }) => ({
          holderKind: holder.kind,
          holderId: holder.id,
          holderName: holder.kind === 'house' ? houseName(holder.id) : personName(holder.id),
          percent: Math.round(percent * 10) / 10,
        }))
      : []
    const landContracts = ws
      ? (ws.landContractIndex.byGranteePolity[p.id] ?? [])
          .map((cid) => {
            const c = ws.landContracts[cid]
            if (!c) return undefined
            const province = ws.provinces[c.provinceId]
            const isRoot = c.parentContractId === undefined
            const isTerminal = ws.landContractIndex.byParent[c.id] === undefined
            const chain = getProvinceLandContractChain(ws, c.provinceId)
            const idx = chain.findIndex((cc) => cc.id === c.id)
            let estimatedRevenue = 0
            if (province && idx >= 0) {
              const polityControl = ws ? getProvincePolityControlFromHoldings(ws, c.provinceId) : 0
              const grossTax =
                getProvinceProduction(ws, defaultConfig, c.provinceId) * (polityControl / 100)
              let remaining = grossTax
              for (let i = chain.length - 1; i >= 0; i--) {
                const seg = chain[i]
                if (!seg) continue
                const rate = seg.terms.taxRateToGrantor
                const retained = remaining * (1 - rate)
                if (i === idx) {
                  estimatedRevenue = Math.round(retained * 10) / 10
                  break
                }
                remaining = remaining * rate
              }
            }
            return {
              contractId: c.id,
              provinceId: c.provinceId,
              provinceName: province?.name ?? String(c.provinceId),
              taxRateToGrantor: Math.round(c.terms.taxRateToGrantor * 100),
              isRoot,
              isTerminal,
              estimatedRevenue,
            }
          })
          .filter((x): x is NonNullable<typeof x> => x !== undefined)
      : []
    return {
      kind,
      meta,
      entity: p,
      derived: {
        ownerHouseName: houseName(p.ownerHouseId),
        capitalProvinceName: provinceName(p.capitalProvinceId),
        rulerPersonId: ws ? getPolityLeader(ws, p.id) : null,
        rulerPersonName: ws ? personName(getPolityLeader(ws, p.id) ?? undefined) : null,
        terminalProvinceIds: terminalIds,
        terminalProvinceNames: terminalIds.map((pid) => provinceName(pid)),
        topShareholders,
        landContracts,
      },
    }
  }
  if (kind === 'house') {
    const h = entity as House
    const ownedPolityIds = ws ? getHouseOwnedPolityIds(ws, h.id) : []
    const controlledProvinceIds = ws ? getHouseControlledProvinceIds(ws, h.id) : []
    const houseTopShareholders = ws
      ? getTopShareholders(ws, { kind: 'house', id: h.id }, 5).map(({ holder, percent }) => ({
          holderKind: holder.kind,
          holderId: holder.id,
          holderName: holder.kind === 'person' ? personName(holder.id) : String(holder.id),
          percent: Math.round(percent * 10) / 10,
        }))
      : []
    return {
      kind,
      meta,
      entity: h,
      derived: {
        headPersonId: ws ? getHouseLeader(ws, h.id) : null,
        headPersonName: ws ? personName(getHouseLeader(ws, h.id) ?? undefined) : null,
        primaryPolityId: ws ? getHousePrimaryPolityId(ws, h.id) : null,
        primaryPolityName: ws ? polityName(getHousePrimaryPolityId(ws, h.id) ?? undefined) : null,
        ownedPolityIds,
        ownedPolityNames: ownedPolityIds.map((pid) => polityName(pid)),
        controlledProvinceIds,
        controlledProvinceNames: controlledProvinceIds.map((pid) => provinceName(pid)),
        topShareholders: houseTopShareholders,
      },
    }
  }
  if (kind === 'person') {
    const pe = entity as Person
    const factionMembership = ws ? getActiveFactionMembership(ws, pe.id) : null
    const leaderFaction = ws ? getFactionByLeader(ws, pe.id) : null
    const factionInfo = leaderFaction
      ? { factionId: leaderFaction.id, factionName: leaderFaction.name, role: 'leader' as const }
      : factionMembership
        ? {
            factionId: factionMembership.factionId,
            factionName: ws?.factions[factionMembership.factionId]?.name ?? null,
            role: 'member' as const,
          }
        : null
    const officeIds = ws ? (ws.officeIndex.byHolderPerson[pe.id] ?? []) : []
    const activeOffices = ws
      ? officeIds
          .map((oid) => ws.officeAssignments[oid])
          .filter((o): o is NonNullable<typeof o> => Boolean(o && o.active))
          .map((o) => ({
            orgKind: o.organization.kind,
            orgId: o.organization.id,
            orgName:
              o.organization.kind === 'polity'
                ? polityName(o.organization.id)
                : houseName(o.organization.id),
            role: o.role,
            displayName:
              OFFICE_DEFINITIONS[`${o.organization.kind}:${o.role}`]?.displayName ?? null,
            startYear: o.startYear,
          }))
      : []
    const holdingOfficeIds = ws ? (ws.holdingOfficeIndex.byHolderPerson[pe.id] ?? []) : []
    const bailiffOf = ws
      ? holdingOfficeIds
          .map((aid) => ws.holdingOfficeAssignments[aid])
          .filter((a): a is NonNullable<typeof a> => Boolean(a && a.active))
          .map((a) => ({
            holdingId: a.holdingId,
            appointingPolityId: a.appointingPolityId,
            appointingPolityName: polityName(a.appointingPolityId),
            startWeek: a.startWeek,
          }))
      : []
    return {
      kind,
      meta,
      entity: pe,
      derived: {
        houseName: houseName(pe.houseId),
        primaryPolityId: ws ? getPersonPrimaryPolityId(ws, pe.id) : null,
        primaryPolityName: ws ? polityName(getPersonPrimaryPolityId(ws, pe.id) ?? undefined) : null,
        faction: factionInfo,
        activeOffices,
        bailiffOf,
        isUnaffiliated: ws ? isUnaffiliatedPerson(ws, pe.id) : false,
        isLandlessHouseMember: ws ? isLandlessHouseMember(ws, pe.id) : false,
      },
    }
  }
  if (kind === 'province') {
    const pv = entity as Province
    const chain = ws ? getProvinceLandContractChain(ws, pv.id) : []
    const bailiff = ws ? getHoldingBailiffPerson(ws, pv.holdingIds[0] ?? ('' as HoldingId)) : null
    return {
      kind,
      meta,
      entity: pv,
      derived: {
        terminalPolityId: ws ? getProvinceTerminalPolityId(ws, pv.id) : null,
        terminalPolityName: ws
          ? polityName(getProvinceTerminalPolityId(ws, pv.id) ?? undefined)
          : null,
        effectiveOwnerHouseId: ws ? getProvinceEffectiveOwnerHouseId(ws, pv.id) : null,
        effectiveOwnerHouseName: ws
          ? houseName(getProvinceEffectiveOwnerHouseId(ws, pv.id) ?? undefined)
          : null,
        landContractChain: chain.map((c) => ({
          id: c.id,
          granteePolityId: c.granteePolityId,
          granteePolityName: polityName(c.granteePolityId),
          taxRateToGrantor: c.terms.taxRateToGrantor,
        })),
        bailiffPersonId: bailiff?.id ?? null,
        bailiffPersonName: bailiff?.name ?? null,
        bailiffIsPlaceholder: bailiff?.kind === 'placeholder',
      },
    }
  }
  if (kind === 'popGroup') {
    const pg = entity as PopGroup
    return {
      kind,
      meta,
      entity: pg,
      derived: {
        provinceName: provinceName(pg.provinceId),
      },
    }
  }
  if (kind === 'faction') {
    const f = entity as Faction
    const memberIds = ws ? getFactionActiveMemberIds(ws, f.id) : []
    // v0.17.4 UI: Faction Roster と同じ「代表官職 / 無職」「Unaffiliated」情報を JSON にも反映する。
    const ROSTER_ROLE_ORDER = ['leader', 'administrator', 'treasurer', 'military', 'advisor']
    const representativeOfficeFor = (
      personId: PersonId,
    ): { label: string; extraCount: number; isUnemployed: boolean } => {
      if (!ws) return { label: '無職', extraCount: 0, isUnemployed: true }
      const officeIds = ws.officeIndex.byHolderPerson[personId] ?? []
      const offices = officeIds.flatMap((oid) => {
        const o = ws.officeAssignments[oid]
        return o && o.active ? [o] : []
      })
      const bailiffIds = ws.holdingOfficeIndex.byHolderPerson[personId] ?? []
      const bailiffs = bailiffIds.flatMap((aid) => {
        const a = ws.holdingOfficeAssignments[aid]
        return a && a.active ? [a] : []
      })
      const polityOfficesLocal = offices
        .filter((o) => o.organization.kind === 'polity')
        .sort((a, b) => ROSTER_ROLE_ORDER.indexOf(a.role) - ROSTER_ROLE_ORDER.indexOf(b.role))
      const houseOfficesLocal = offices
        .filter((o) => o.organization.kind === 'house')
        .sort((a, b) => ROSTER_ROLE_ORDER.indexOf(a.role) - ROSTER_ROLE_ORDER.indexOf(b.role))
      const total = offices.length + bailiffs.length
      if (polityOfficesLocal.length > 0) {
        const o = polityOfficesLocal[0]!
        const displayName =
          OFFICE_DEFINITIONS[`${o.organization.kind}:${o.role}`]?.displayName ?? o.role
        const orgName = ws.polities[o.organization.id as PolityId]?.name ?? o.organization.id
        return {
          label: `${displayName} (${orgName})`,
          extraCount: total - 1,
          isUnemployed: false,
        }
      }
      if (houseOfficesLocal.length > 0) {
        const o = houseOfficesLocal[0]!
        const displayName =
          OFFICE_DEFINITIONS[`${o.organization.kind}:${o.role}`]?.displayName ?? o.role
        const orgName = ws.houses[o.organization.id as HouseId]?.name ?? o.organization.id
        return {
          label: `${displayName} (${orgName})`,
          extraCount: total - 1,
          isUnemployed: false,
        }
      }
      if (bailiffs.length > 0) {
        const a = bailiffs[0]!
        const holdingName = ws.holdings[a.holdingId]?.name ?? a.holdingId
        return {
          label: `代官 (${holdingName})`,
          extraCount: total - 1,
          isUnemployed: false,
        }
      }
      return { label: '無職', extraCount: 0, isUnemployed: true }
    }
    const members = memberIds.map((pid) => {
      const p = ws?.persons[pid]
      const hid = p?.houseId
      const isUnaffiliated = hid === ANONYMOUS_HOUSE_ID
      return {
        personId: pid,
        personName: p?.name ?? null,
        houseId: hid ?? null,
        houseName: isUnaffiliated ? null : houseName(hid),
        isUnaffiliated,
        representativeOffice: representativeOfficeFor(pid),
      }
    })
    const employedCount = members.filter((m) => !m.representativeOffice.isUnemployed).length
    const leader = ws?.persons[f.leaderPersonId]
    const leaderHouseId = leader?.houseId
    return {
      kind,
      meta,
      entity: f,
      derived: {
        leaderPersonName: personName(f.leaderPersonId),
        leaderHouseId: leaderHouseId ?? null,
        leaderHouseName: houseName(leaderHouseId),
        memberCount: memberIds.length,
        employedCount,
        members,
      },
    }
  }
  return { kind, meta, entity }
}

function PersonLink({
  personId,
  persons,
  onClick,
}: {
  personId: PersonId
  persons: Record<string, Person>
  onClick: ClickHandler
}) {
  const person = persons[personId]
  if (!person) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(personId, 'person')}
    >
      {person.name}
    </button>
  )
}

function HouseLink({
  houseId,
  houses,
  onClick,
}: {
  houseId: HouseId | undefined
  houses: Record<string, House>
  onClick: ClickHandler
}) {
  if (!houseId) return <span className="text-gray-500">\u2014</span>
  const house = houses[houseId]
  if (!house) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(houseId, 'house')}
    >
      {house.name}
    </button>
  )
}

function PolityLink({
  polityId,
  polities,
  onClick,
}: {
  polityId: PolityId | undefined
  polities: Record<string, Polity>
  onClick: ClickHandler
}) {
  if (!polityId) return <span className="text-gray-500">\u2014</span>
  const polity = polities[polityId]
  if (!polity) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(polityId, 'polity')}
    >
      {polity.name}
    </button>
  )
}

function RoleDisplay({
  role,
  polityId,
  persons,
  onClick,
  currentState,
}: {
  role: string
  polityId: PolityId
  persons: Record<string, Person>
  onClick: ClickHandler
  currentState: import('@sim/types/world').WorldState | null
}) {
  const polityRef = {
    kind: 'polity' as const,
    id: polityId,
  }
  if (!currentState) return <span className="text-gray-500">\u2014</span>
  const holderIds = getActiveOfficeHolders(
    currentState,
    polityRef,
    role as import('@sim/types/office').OfficeRole,
  )
  if (holderIds.length === 0) return <span className="text-gray-500">\u2014</span>
  const personId = holderIds[0]
  const person = persons[personId as PersonId]
  if (!person) return <span className="text-gray-500">\u2014</span>
  return <PersonLink personId={personId as PersonId} persons={persons} onClick={onClick} />
}

const ABILITY_KEYS = ['valor', 'command', 'numeracy', 'learning', 'charisma', 'insight'] as const
const ABILITY_LABELS: Record<(typeof ABILITY_KEYS)[number], string> = {
  valor: '武勇',
  command: '統率',
  numeracy: '数理',
  learning: '学識',
  charisma: '魅力',
  insight: '洞察',
}

function AbilityRadarChart({
  abilities,
  aptitudes,
  size = 192,
}: {
  abilities: Record<string, number>
  aptitudes: Record<string, number>
  size?: number
}) {
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
            {ABILITY_LABELS[k]}
          </text>
        )
      })}
    </svg>
  )
}

const SHARE_COLORS = ['#60a5fa', '#f59e0b', '#34d399', '#f87171', '#a78bfa', '#9ca3af']

function ShareDonutChart({
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

function ShareholderSection({
  shareholders,
  persons,
  houses,
  onPersonClick,
  onHouseClick,
}: {
  shareholders: Array<{ holder: ShareHolderRef; percent: number }>
  persons: Record<string, Person>
  houses: Record<string, House>
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const { t } = useTranslation()
  if (shareholders.length === 0) return <span className="text-gray-500">—</span>
  const othersPercent = Math.max(0, 100 - shareholders.reduce((s, h) => s + h.percent, 0))
  const slices = shareholders.map((h, i) => ({
    percent: h.percent,
    color: SHARE_COLORS[i % SHARE_COLORS.length]!,
  }))
  if (othersPercent > 0.5) {
    slices.push({ percent: othersPercent, color: SHARE_COLORS[SHARE_COLORS.length - 1]! })
  }
  return (
    <div className="flex items-start gap-3">
      <ShareDonutChart slices={slices} />
      <div className="min-w-0 flex-1 text-sm">
        {shareholders.map((h, i) => (
          <div key={`${h.holder.kind}:${h.holder.id}`} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: SHARE_COLORS[i % SHARE_COLORS.length] }}
            />
            <span className="min-w-0 truncate">
              {h.holder.kind === 'house' ? (
                <HouseLink houseId={h.holder.id} houses={houses} onClick={onHouseClick} />
              ) : (
                <PersonLink personId={h.holder.id} persons={persons} onClick={onPersonClick} />
              )}
            </span>
            <span className="ml-auto shrink-0 text-gray-200">{h.percent.toFixed(1)}%</span>
          </div>
        ))}
        {othersPercent > 0.5 && (
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: SHARE_COLORS[SHARE_COLORS.length - 1] }}
            />
            <span className="text-gray-400">{t('detail.polity.others')}</span>
            <span className="ml-auto shrink-0 text-gray-200">{othersPercent.toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  )
}

function AttitudeList({
  attitudes,
  worldState,
  onPolityClick,
  onHouseClick,
  onPersonClick,
}: {
  attitudes: AttitudeMap
  worldState: WorldState | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
}) {
  const { t } = useTranslation()
  if (!worldState) return null
  const entries = Object.entries(attitudes)
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(([key, attitude]) => {
        const colonIdx = key.indexOf(':')
        const prefix = key.slice(0, colonIdx)
        const id = key.slice(colonIdx + 1)

        let linkNode: React.ReactNode
        if (prefix === 'polity') {
          const p = worldState.polities[id as PolityId]
          const name = p?.name ?? id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onPolityClick(id as PolityId, 'polity')}
            >
              {name}
            </button>
          )
        } else if (prefix === 'house') {
          const h = worldState.houses[id as HouseId]
          const name = h?.name ?? id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onHouseClick(id as HouseId, 'house')}
            >
              {name}
            </button>
          )
        } else if (prefix === 'person') {
          const p = worldState.persons[id as PersonId]
          const name = p?.name ?? id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onPersonClick(id)}
            >
              {name}
            </button>
          )
        } else {
          linkNode = <span className="text-gray-400">{id}</span>
        }

        const affColor =
          attitude.affection > 0
            ? 'text-green-400'
            : attitude.affection < 0
              ? 'text-red-400'
              : 'text-gray-400'
        const resColor =
          attitude.respect > 0
            ? 'text-green-400'
            : attitude.respect < 0
              ? 'text-red-400'
              : 'text-gray-400'

        return (
          <div key={key} className="rounded bg-gray-700 p-1 text-xs">
            <div className="font-medium text-gray-300">{linkNode}</div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t('detail.person.affection')}:</span>
              <span className={affColor}>{attitude.affection.toFixed(0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t('detail.person.respect')}:</span>
              <span className={resColor}>{attitude.respect.toFixed(0)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PolityLandContracts({
  polity,
  worldState,
  onProvinceClick,
}: {
  polity: Polity
  worldState: WorldState | null
  onProvinceClick: (id: string) => void
}) {
  const { t } = useTranslation()
  if (!worldState) return null
  const contractIds = worldState.landContractIndex.byGranteePolity[polity.id] ?? []
  if (contractIds.length === 0) return null

  type ContractInfo = {
    id: LandContractId
    holdingId: HoldingId | undefined
    holdingName: string
    taxRate: number
    isRoot: boolean
    isTerminal: boolean
    estimatedRevenue: number
  }
  type ProvinceGroup = {
    provinceId: ProvinceId
    provinceName: string
    holdings: ContractInfo[]
    totalRevenue: number
  }

  const groupMap = new Map<string, ProvinceGroup>()

  for (const cid of contractIds) {
    const c = worldState.landContracts[cid]
    if (!c) continue
    const province = worldState.provinces[c.provinceId]
    const isRoot = c.parentContractId === undefined
    const isTerminal = worldState.landContractIndex.byParent[c.id] === undefined
    const holdingId = c.holdingId
    const holding = holdingId ? worldState.holdings[holdingId] : undefined

    let estimatedRevenue = 0
    if (province && holdingId) {
      const chain = getHoldingLandContractChain(worldState, holdingId)
      const idx = chain.findIndex((cc) => cc.id === c.id)
      if (idx >= 0) {
        const polityControl = getProvincePolityControlFromHoldings(worldState, c.provinceId)
        const grossTax =
          getProvinceProduction(worldState, defaultConfig, c.provinceId) * (polityControl / 100)
        let remaining = grossTax
        for (let i = chain.length - 1; i >= 0; i--) {
          const seg = chain[i]
          if (!seg) continue
          const rate = seg.terms.taxRateToGrantor
          const retained = remaining * (1 - rate)
          if (i === idx) {
            estimatedRevenue = Math.round(retained * 10) / 10
            break
          }
          remaining = remaining * rate
        }
      }
    }

    const key = c.provinceId as string
    let group = groupMap.get(key)
    if (!group) {
      group = {
        provinceId: c.provinceId,
        provinceName: province?.name ?? String(c.provinceId),
        holdings: [],
        totalRevenue: 0,
      }
      groupMap.set(key, group)
    }
    group.holdings.push({
      id: c.id,
      holdingId,
      holdingName: holding?.name ?? '(unknown)',
      taxRate: c.terms.taxRateToGrantor,
      isRoot,
      isTerminal,
      estimatedRevenue,
    })
    group.totalRevenue += estimatedRevenue
  }

  const groups = [...groupMap.values()].sort((a, b) => b.totalRevenue - a.totalRevenue)
  const totalContracts = groups.reduce((sum, g) => sum + g.holdings.length, 0)

  return (
    <div className="mt-1">
      <div className="text-sm font-semibold text-gray-300">Land Contracts ({totalContracts}):</div>
      <div className="max-h-48 overflow-y-auto text-sm">
        {groups.map((g) => (
          <div key={g.provinceId} className="mb-1">
            <div className="flex items-baseline gap-1">
              <button
                className="text-xs font-semibold text-blue-300 hover:underline"
                onClick={() => onProvinceClick(g.provinceId)}
              >
                {g.provinceName}
              </button>
              <span className="text-xs text-gray-500">({g.holdings.length})</span>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {g.holdings.map((c) => (
                  <tr key={c.id} className="border-t border-gray-700/20">
                    <td className="pl-2 text-gray-400">{c.holdingName}</td>
                    <td className="text-right text-gray-300">{Math.round(c.taxRate * 100)}%</td>
                    <td className="text-right text-amber-300">
                      {c.estimatedRevenue > 0 ? c.estimatedRevenue.toFixed(1) : '—'}
                    </td>
                    <td className="text-right text-gray-400">
                      {c.isRoot && c.isTerminal
                        ? `${t('detail.province.root')}+${t('detail.province.term')}`
                        : c.isRoot
                          ? t('detail.province.root')
                          : c.isTerminal
                            ? t('detail.province.term')
                            : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CountryDetail({
  polity,
  session,
  watchlist,
  toggleWatchlist,
  onPersonClick,
  onHouseClick,
  onProvinceClick,
}: {
  polity: Polity
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
  onProvinceClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const isWatching = watchlist.includes(polity.id)
  const currentState = session?.currentState
  if (!currentState) return null
  const houses = currentState.houses
  const persons = currentState.persons

  const worldState: WorldState | null = currentState ?? null

  const totalMilitaryPower = worldState
    ? calcPolityMilitaryPower(worldState, defaultConfig, polity.id)
    : 0

  const legitimacy = worldState ? getPolityLegitimacy(worldState, polity.id) : 50
  const stability = worldState ? getPolityStability(worldState, defaultConfig, polity.id) : 50

  const roleLabels: Record<string, string> = {
    leader: t('detail.polity.ruler'),
    administrator: t('roles.polity.administrator', { ns: 'roles' }),
    military: t('roles.polity.military', { ns: 'roles' }),
    treasurer: t('roles.polity.treasurer', { ns: 'roles' }),
  }

  // v0.15: この Polity に Province を持つ active House を、所領 Province 数とともに表示する。
  // 多 Polity 所領家も他 Polity の Detail に出る (primary 限定はしない)。
  // Province 数 desc → HouseId 昇順でソートし、primary がここでない家には「外様」表示を付ける。
  const houseEntries = currentState
    ? getPolityHouseIds(currentState, polity.id)
        .map((hid) => {
          const house = houses[hid]
          if (!house || !house.active) return null
          const count = getHouseProvinceIdsByPolity(currentState, hid, polity.id).length
          const primary = getHousePrimaryPolityId(currentState, hid)
          return { house, count, isPrimaryHere: primary === polity.id }
        })
        .filter((e): e is { house: House; count: number; isPrimaryHere: boolean } => e !== null)
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count
          return a.house.id.localeCompare(b.house.id)
        })
    : []
  const inHouseNames = houseEntries.map(({ house, count, isPrimaryHere }) => (
    <li key={house.id} className="mb-0.5">
      <HouseLink houseId={house.id} houses={houses} onClick={onHouseClick} />
      <span className="ml-1 text-xs text-gray-400">
        ({count} province{count === 1 ? '' : 's'}
        {isPrimaryHere ? '' : ', non-primary'})
      </span>
    </li>
  ))

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{polity.name}</span>
          {!polity.active && (
            <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-400">
              {t('detail.annexed')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <CopyJsonButton payload={buildEntitySnapshot('polity', polity, currentState ?? null)} />
          <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(polity.id)} />
        </div>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.rank')}:</span>
          <span>
            {formatPolityRank(polity.rank)}{' '}
            <span className="text-gray-500">(rank {polity.rank})</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.capital')}:</span>
          <button
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onProvinceClick(polity.capitalProvinceId)}
          >
            {currentState.provinces?.[polity.capitalProvinceId]?.name ?? polity.capitalProvinceId}
          </button>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.ruler')}:</span>
          {(() => {
            if (!currentState) return <span className="text-gray-500">\u2014</span>
            const rulerId = getPolityLeader(currentState, polity.id)
            if (!rulerId) return <span className="text-gray-500">\u2014</span>
            return <PersonLink personId={rulerId} persons={persons ?? {}} onClick={onPersonClick} />
          })()}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.royal_house')}:</span>
          {(() => {
            if (!currentState) return <span className="text-gray-500">\u2014</span>
            const rulerHouseId = getPolityLeaderHouse(currentState, polity.id)
            if (!rulerHouseId) return <span className="text-gray-500">\u2014</span>
            return <HouseLink houseId={rulerHouseId} houses={houses ?? {}} onClick={onHouseClick} />
          })()}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.dominant_house')}:</span>
          {(() => {
            if (!currentState) return <span className="text-gray-500">\u2014</span>
            const dominantHouseId = getDominantPolityHouse(currentState, polity.id)
            if (!dominantHouseId) return <span className="text-gray-500">\u2014</span>
            return (
              <HouseLink houseId={dominantHouseId} houses={houses ?? {}} onClick={onHouseClick} />
            )
          })()}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.treasury')}:</span>
          <span>{formatAmount(polity.treasury)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.legitimacy')}:</span>
          <span>{formatScore(legitimacy)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.admin_power')}:</span>
          <span>{formatScore(polity.adminPower)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.stability')}:</span>
          <span>{formatScore(stability)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.military_power')}:</span>
          <span>{formatPower(totalMilitaryPower)}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">
        {t('detail.polity.administration')}:
      </div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.capacity')}:</span>
          <span>
            {worldState
              ? getAdministrativeCapacity(worldState, defaultConfig, polity.id).toFixed(1)
              : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.load')}:</span>
          <span>
            {worldState
              ? getAdministrativeLoad(worldState, defaultConfig, polity.id).toFixed(1)
              : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.polity.efficiency')}:</span>
          <span>
            {worldState
              ? `x${getAdministrativeEfficiency(worldState, defaultConfig, polity.id).toFixed(2)}`
              : '—'}
          </span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">{t('detail.polity.roles')}:</div>
      <div className="text-sm">
        {(['leader', 'administrator', 'military', 'treasurer'] as const).map((role) => (
          <div key={role} className="flex justify-between">
            <span className="text-gray-400">{roleLabels[role]}:</span>
            <RoleDisplay
              role={role}
              polityId={polity.id}
              persons={persons}
              onClick={onPersonClick}
              currentState={session?.currentState ?? null}
            />
          </div>
        ))}
      </div>

      <div className="text-sm font-semibold text-gray-300">
        {t('detail.polity.top_shareholders')}:
      </div>
      {worldState ? (
        <ShareholderSection
          shareholders={getTopShareholders(worldState, { kind: 'polity', id: polity.id }, 5)}
          persons={currentState.persons ?? {}}
          houses={houses ?? {}}
          onPersonClick={onPersonClick}
          onHouseClick={onHouseClick}
        />
      ) : (
        <span className="text-sm text-gray-500">—</span>
      )}

      <div className="text-sm font-semibold text-gray-300">
        {t('detail.polity.houses_with_land')}:
      </div>
      <ul className="list-inside list-disc text-sm">
        {inHouseNames.length > 0 ? inHouseNames : <li className="text-gray-500">\u2014</li>}
      </ul>

      <PolityLandContracts
        polity={polity}
        worldState={worldState}
        onProvinceClick={onProvinceClick}
      />
    </div>
  )
}

export function HouseDetail({
  house,
  session,
  watchlist,
  toggleWatchlist,
  onPersonClick,
  onHouseClick,
  onPolityClick,
  onProvinceClick,
  eventHistory,
}: {
  house: House
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
  onPolityClick: ClickHandler
  onProvinceClick: (id: string) => void
  eventHistory: SimEvent[]
}) {
  const { t } = useTranslation()
  const renderEvent = useRenderEvent()
  const isWatching = watchlist.includes(house.id)
  const currentState = session?.currentState
  const houses = currentState?.houses ?? {}
  if (!currentState) return null
  const leaderId = currentState ? getHouseLeader(currentState, house.id) : undefined
  const head = leaderId ? currentState.persons?.[leaderId] : undefined
  const aliveMembers = house.memberIds.filter(
    (pid) => currentState.persons?.[pid]?.alive === true,
  ).length

  const worldState: WorldState | null = currentState ?? null

  const { rebellionTendency, plotTendency } = worldState
    ? calcAmbitionScores(worldState, house.id)
    : { rebellionTendency: 0, plotTendency: 0 }

  const cohesion = worldState ? getHouseCohesion(worldState, house.id) : 50
  const loyaltyToPolity = worldState ? getHouseLoyaltyToPolity(worldState, house.id) : 50

  const levyPower = worldState
    ? getHouseControlledProvinceIds(worldState, house.id).reduce(
        (sum: number, pid) => sum + getProvinceHouseManpowerBase(worldState, defaultConfig, pid),
        0,
      ) * defaultConfig.houseManpowerPowerFactor
    : 0

  const availableWarWealth = Math.max(0, house.wealth - defaultConfig.houseMilitaryWealthReserve)
  const rawMercenaryPower = Math.log1p(availableWarWealth) * defaultConfig.houseWealthMilitaryFactor
  const mercenaryPower = Math.min(
    rawMercenaryPower,
    levyPower * defaultConfig.maxMercenaryPowerRatio,
  )

  const bestWarCommand = worldState
    ? Math.max(0, ...house.memberIds.map((pid) => getRoleScore(worldState, pid, 'warCommand') / 10))
    : 0

  const commanderModifier = clamp(
    1 + normalizedStat(bestWarCommand) * defaultConfig.houseCommanderMartialEffect,
    defaultConfig.minCommanderModifier,
    defaultConfig.maxCommanderModifier,
  )

  const totalMilitaryPower = (levyPower + mercenaryPower) * commanderModifier

  const recentEvents = eventHistory
    .filter((e) => hasEntityId(e, house.id) || house.memberIds.some((mid) => hasEntityId(e, mid)))
    .slice(-3)
    .reverse()

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">{house.name}</span>
        <div className="flex items-center gap-1.5">
          <CopyJsonButton payload={buildEntitySnapshot('house', house, currentState ?? null)} />
          <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(house.id)} />
        </div>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.primary_polity')}:</span>
          {(() => {
            const primaryPolityId = getHousePrimaryPolityId(currentState, house.id)
            if (!primaryPolityId) return <span className="text-gray-500">\u2014</span>
            const p = currentState.polities[primaryPolityId]
            if (!p) return <span className="text-gray-500">\u2014</span>
            return (
              <button
                className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                onClick={() => onPolityClick(primaryPolityId, 'polity')}
              >
                {p.name}
              </button>
            )
          })()}
        </div>
        {(() => {
          const ownedIds = getHouseOwnedPolityIds(currentState, house.id)
          if (ownedIds.length <= 1) {
            return (
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.house.owned_polity')}:</span>
                {ownedIds.length === 0 ? (
                  <span className="text-gray-500">\u2014</span>
                ) : (
                  (() => {
                    const pid = ownedIds[0]!
                    const p = currentState.polities[pid]
                    if (!p) return <span className="text-gray-500">\u2014</span>
                    return (
                      <button
                        className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onPolityClick(pid, 'polity')}
                      >
                        {p.name}
                      </button>
                    )
                  })()
                )}
              </div>
            )
          }
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-gray-400">
                {t('detail.house.owned_polities')} ({ownedIds.length}):
              </span>
              <ul className="flex flex-col gap-0.5 pl-3">
                {ownedIds.map((pid) => {
                  const p = currentState.polities[pid]
                  if (!p) return null
                  return (
                    <li key={pid}>
                      <button
                        className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                        onClick={() => onPolityClick(pid, 'polity')}
                      >
                        {p.name}
                      </button>
                      <span className="ml-1 text-xs text-gray-500">
                        ({formatPolityRank(p.rank)})
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })()}
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.seat')}:</span>
          <button
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
            onClick={() => onProvinceClick(house.seatProvinceId)}
          >
            {currentState.provinces?.[house.seatProvinceId]?.name ?? house.seatProvinceId}
          </button>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.prestige')}:</span>
          <span>{formatScore(house.legacyPrestige)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.cohesion')}:</span>
          <span>{formatScore(cohesion)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.loyalty')}:</span>
          <span>{formatScore(loyaltyToPolity)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.wealth')}:</span>
          <span>{formatAmount(house.wealth)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.provinces')}:</span>
          <span>{worldState ? getHouseControlledProvinceIds(worldState, house.id).length : 0}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.rebellion_tendency')}:</span>
          <span className={rebellionTendency >= 70 ? 'text-red-400' : 'text-gray-200'}>
            {rebellionTendency.toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.plot_tendency')}:</span>
          <span className={plotTendency >= 65 ? 'text-yellow-400' : 'text-gray-200'}>
            {plotTendency.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="mt-1 text-sm font-semibold text-gray-300">{t('detail.house.military')}</div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.levy_power')}:</span>
          <span>{formatPower(levyPower)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.mercenary_power')}:</span>
          <span>{formatPower(mercenaryPower)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.commander_mod')}:</span>
          <span>{commanderModifier.toFixed(2)}x</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.total_military')}:</span>
          <span className="font-medium">{formatPower(totalMilitaryPower)}</span>
        </div>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.leader')}:</span>
          {head ? (
            <PersonLink
              personId={leaderId as PersonId}
              persons={currentState.persons ?? {}}
              onClick={onPersonClick}
            />
          ) : (
            <span className="text-gray-500">\u2014</span>
          )}
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-300">{t('detail.house.offices')}</div>
        <div className="text-sm">
          {(['administrator', 'treasurer', 'military', 'advisor'] as const).map((role) => {
            const houseRef = { kind: 'house' as const, id: house.id }
            const holderIds = worldState ? getActiveOfficeHolders(worldState, houseRef, role) : []
            const roleLabel = t(`roles.house.${role}`, { ns: 'roles' })
            return (
              <div key={role} className="flex justify-between">
                <span className="text-gray-400">{roleLabel}:</span>
                <div className="flex flex-col items-end gap-0.5">
                  {holderIds.length === 0 ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    holderIds.map((pid) => (
                      <PersonLink
                        key={pid as string}
                        personId={pid}
                        persons={currentState.persons ?? {}}
                        onClick={onPersonClick}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-300">
          {t('detail.house.top_shareholders')}
        </div>
        {worldState ? (
          <ShareholderSection
            shareholders={getTopShareholders(worldState, { kind: 'house', id: house.id }, 5)}
            persons={currentState.persons ?? {}}
            houses={houses ?? {}}
            onPersonClick={onPersonClick}
            onHouseClick={onHouseClick}
          />
        ) : (
          <span className="text-sm text-gray-500">—</span>
        )}
        <div>
          <div className="text-sm font-semibold text-gray-300">
            {t('detail.house.members')} ({aliveMembers} {t('detail.house.alive')}):
          </div>
          <div className="flex flex-col gap-0.5 text-sm">
            {house.memberIds
              .filter((pid) => currentState?.persons?.[pid]?.alive === true)
              .slice(0, 8)
              .map((pid) => (
                <PersonLink
                  key={pid}
                  personId={pid}
                  persons={currentState?.persons ?? {}}
                  onClick={onPersonClick}
                />
              ))}
            {aliveMembers > 8 && (
              <span className="text-xs text-gray-500">+{aliveMembers - 8} more</span>
            )}
          </div>
        </div>
      </div>

      {house.founderId !== undefined && (
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.founder')}:</span>
          <span>{currentState?.persons?.[house.founderId]?.name ?? house.founderId}</span>
        </div>
      )}
      {house.parentHouseId !== undefined && (
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.parent_house')}:</span>
          <span>{currentState?.houses?.[house.parentHouseId]?.name ?? house.parentHouseId}</span>
        </div>
      )}
      {house.cadetHouseIds.length > 0 && (
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.cadet_houses')}:</span>
          <span>{house.cadetHouseIds.length}</span>
        </div>
      )}

      {recentEvents.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-gray-300">
            {t('detail.house.recent_events')}:
          </div>
          {recentEvents.map((e) => (
            <div key={e.id} className={`text-xs ${getImportanceColor(e.importance)}`}>
              [{e.year}/W{e.weekOfYear}] {renderEvent(e)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PersonDetail({
  person,
  session,
  watchlist,
  toggleWatchlist,
  onHouseClick,
  onPolityClick,
  onPersonClick,
  onFactionClick,
  onProvinceClick,
  eventHistory,
}: {
  person: Person
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onHouseClick: ClickHandler
  onPolityClick: ClickHandler
  onPersonClick: (id: string) => void
  onFactionClick: (id: FactionId) => void
  onProvinceClick: (id: string) => void
  eventHistory: SimEvent[]
}) {
  const { t } = useTranslation()
  const [abilityView, setAbilityView] = useState<'table' | 'radar'>('table')
  const isWatching = watchlist.includes(person.id)
  const currentState = session?.currentState
  const worldState: WorldState = currentState ?? {
    currentYear: 0,
    currentWeekOfYear: 0,
    absoluteWeek: 0,
    provinces: {},
    holdings: {},
    states: {},
    polities: {},
    houses: {},
    persons: {},
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    landContracts: {},
    holdingOfficeAssignments: {},
    holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    landContractIndex: { byProvince: {}, byHolding: {}, byGranteePolity: {}, byParent: {} },
    holdingTerminalPolityCache: {},
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    nextLandContractId: 0,
    nextHoldingOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    actorIntents: {},
    diplomaticPlays: {},
    nextActorIntentId: 0,
    nextDiplomaticPlayId: 0,
  }
  const allOfficeIds = worldState.officeIndex.byHolderPerson[person.id] ?? []
  const allOffices = allOfficeIds.flatMap((id) => {
    const o = worldState.officeAssignments[id]
    return o && o.active ? [o] : []
  })
  const importanceScore = calcPersonImportanceScore(worldState, person.id, eventHistory)

  const primaryPolityId = getPersonPrimaryPolityId(worldState, person.id)

  const ROLE_ORDER = ['leader', 'administrator', 'treasurer', 'military', 'advisor']

  function officeDisplayName(office: (typeof allOffices)[number]): string {
    const key = `${office.organization.kind}:${office.role}` as const
    return OFFICE_DEFINITIONS[key]?.displayName ?? office.role
  }

  function officeOrgName(office: (typeof allOffices)[number]): string {
    const org = office.organization
    if (org.kind === 'polity') {
      return worldState.polities[org.id]?.name ?? org.id
    }
    return worldState.houses[org.id]?.name ?? org.id
  }

  const sortByRole = (a: (typeof allOffices)[number], b: (typeof allOffices)[number]) =>
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)

  const polityOffices = allOffices.filter((o) => o.organization.kind === 'polity').sort(sortByRole)
  const houseOffices = allOffices.filter((o) => o.organization.kind === 'house').sort(sortByRole)

  const bailiffAssignmentIds = worldState.holdingOfficeIndex.byHolderPerson[person.id] ?? []
  const bailiffAssignments = bailiffAssignmentIds.flatMap((aid) => {
    const a = worldState.holdingOfficeAssignments[aid]
    return a && a.active ? [a] : []
  })

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">{person.name}</span>
        <div className="flex items-center gap-1.5">
          <CopyJsonButton payload={buildEntitySnapshot('person', person, currentState ?? null)} />
          <WatchButton isWatching={isWatching} onToggle={() => toggleWatchlist(person.id)} />
        </div>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.age')}:</span>
          <span>{person.age}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.alive')}:</span>
          <span>
            {person.alive
              ? t('detail.person.alive_yes')
              : person.deathCircumstance === 'faded_from_history'
                ? `${t('detail.person.faded')} (${worldState.currentYear})`
                : t('detail.person.alive_no')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.house')}:</span>
          {person.houseId === ANONYMOUS_HOUSE_ID ? (
            <span className="text-gray-400">({t('detail.person.unaffiliated')})</span>
          ) : (
            <span className="flex items-center gap-1">
              <HouseLink
                houseId={person.houseId}
                houses={currentState?.houses ?? {}}
                onClick={onHouseClick}
              />
              {isLandlessHouseMember(worldState, person.id) && (
                <span className="text-xs text-amber-400">(landless)</span>
              )}
            </span>
          )}
        </div>
        {person.occupation && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.person.occupation')}:</span>
            <span>{person.occupation}</span>
          </div>
        )}
        {(() => {
          const factionAsLeader = getFactionByLeader(worldState, person.id)
          const membership = getActiveFactionMembership(worldState, person.id)
          if (!factionAsLeader && !membership) return null
          const targetFactionId = factionAsLeader?.id ?? membership?.factionId
          const faction = targetFactionId ? worldState.factions[targetFactionId] : undefined
          if (!faction) return null
          const roleLabel = factionAsLeader ? 'leader' : 'member'
          return (
            <div className="flex justify-between">
              <span className="text-gray-400">{t('detail.person.faction')}:</span>
              <span>
                ◈{' '}
                <button
                  className="cursor-pointer text-blue-400 underline underline-offset-2 hover:text-blue-300"
                  onClick={() => onFactionClick(faction.id)}
                >
                  {faction.name}
                </button>{' '}
                <span className="text-xs text-gray-500">({roleLabel})</span>
              </span>
            </div>
          )
        })()}
        {isUnaffiliatedPerson(worldState, person.id) && person.houseId !== ANONYMOUS_HOUSE_ID && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.person.status')}:</span>
            <span className="text-amber-400">{t('detail.person.unaffiliated')}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.primary_polity')}:</span>
          {(() => {
            if (!primaryPolityId) return <span className="text-gray-500">\u2014</span>
            if (!currentState) return <span className="text-gray-500">\u2014</span>
            const p = currentState.polities?.[primaryPolityId]
            if (!p) return <span className="text-gray-500">\u2014</span>
            return (
              <button
                className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                onClick={() => onPolityClick(primaryPolityId, 'polity')}
              >
                {p.name}
              </button>
            )
          })()}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.sex')}:</span>
          <span>
            {person.sex === 'male'
              ? t('sex.male', { ns: 'statuses' })
              : person.sex === 'female'
                ? t('sex.female', { ns: 'statuses' })
                : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.birth_status')}:</span>
          <span>
            {person.birthStatus === 'legitimate'
              ? t('birth_status.legitimate', { ns: 'statuses' })
              : person.birthStatus === 'illegitimate'
                ? t('birth_status.illegitimate', { ns: 'statuses' })
                : t('birth_status.unknown', { ns: 'statuses' })}
          </span>
        </div>
        <div className="mt-1">
          <span className="text-sm text-gray-400">{t('detail.person.offices')}</span>
          {allOffices.length === 0 && bailiffAssignments.length === 0 ? (
            <div className="ml-1 text-sm text-gray-500">—</div>
          ) : (
            <div className="ml-1 text-sm">
              {polityOffices.length > 0 && (
                <div>
                  <span className="text-xs text-gray-500">
                    {t('detail.person.country_offices')}
                  </span>
                  {polityOffices.map((o) => (
                    <div key={o.id} className="flex justify-between gap-2">
                      <span className="text-gray-300">{officeDisplayName(o)}</span>
                      <span className="text-right text-gray-200">{officeOrgName(o)}</span>
                    </div>
                  ))}
                </div>
              )}
              {houseOffices.length > 0 && (
                <div className={polityOffices.length > 0 ? 'mt-0.5' : ''}>
                  <span className="text-xs text-gray-500">{t('detail.person.house_offices')}</span>
                  {houseOffices.map((o) => (
                    <div key={o.id} className="flex justify-between gap-2">
                      <span className="text-gray-300">{officeDisplayName(o)}</span>
                      <span className="text-right text-gray-200">{officeOrgName(o)}</span>
                    </div>
                  ))}
                </div>
              )}
              {bailiffAssignments.length > 0 && (
                <div
                  className={polityOffices.length > 0 || houseOffices.length > 0 ? 'mt-0.5' : ''}
                >
                  <span className="text-xs text-gray-500">
                    {t('detail.person.bailiff_offices')}
                  </span>
                  {bailiffAssignments.map((a) => {
                    const holding = worldState.holdings[a.holdingId]
                    return (
                      <div key={a.id} className="flex justify-between gap-2">
                        <span className="text-gray-300">
                          {t('holding.bailiff', { ns: 'roles' })}
                        </span>
                        <button
                          className="text-right text-blue-400 underline underline-offset-2 hover:text-blue-300"
                          onClick={() => onProvinceClick(holding?.provinceId ?? '')}
                        >
                          {holding?.name ?? a.holdingId}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-300">{t('detail.person.abilities')}</span>
        <div className="flex gap-0.5 rounded bg-gray-700 p-0.5 text-[10px]">
          <button
            className={`rounded px-1.5 py-0.5 ${abilityView === 'table' ? 'bg-gray-500 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
            onClick={() => setAbilityView('table')}
          >
            Table
          </button>
          <button
            className={`rounded px-1.5 py-0.5 ${abilityView === 'radar' ? 'bg-gray-500 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
            onClick={() => setAbilityView('radar')}
          >
            Radar
          </button>
        </div>
      </div>
      {abilityView === 'table' ? (
        <div className="text-sm">
          {(
            [
              ['武勇 Valor', 'valor'],
              ['統率 Command', 'command'],
              ['数理 Numeracy', 'numeracy'],
              ['学識 Learning', 'learning'],
              ['魅力 Charisma', 'charisma'],
              ['洞察 Insight', 'insight'],
            ] as const
          ).map(([label, key]) => {
            const curve = ABILITY_AGE_CURVES[key]
            const curveIcon = curve === 'youthPeak' ? '▲' : curve === 'midLifePeak' ? '●' : '↗'
            const curveColor =
              curve === 'youthPeak'
                ? 'text-yellow-400'
                : curve === 'midLifePeak'
                  ? 'text-orange-400'
                  : 'text-green-400'
            const abilityPct = (person.abilities[key] / 120) * 100
            const aptitudePct = (person.aptitudes[key] / 120) * 100
            return (
              <div key={key} className="mb-0.5">
                <div className="flex justify-between">
                  <span className="text-gray-400">
                    <span className={`mr-1 text-xs ${curveColor}`}>{curveIcon}</span>
                    {label}:
                  </span>
                  <span>
                    <span className="text-gray-100">{person.abilities[key]}</span>
                    <span className="text-gray-500"> / </span>
                    <span className="text-gray-400">{person.aptitudes[key]}</span>
                  </span>
                </div>
                <div className="relative h-1 w-full rounded bg-gray-600">
                  <div
                    className="absolute h-1 rounded bg-gray-400"
                    style={{ width: `${aptitudePct}%` }}
                  />
                  <div
                    className="absolute h-1 rounded bg-blue-400"
                    style={{ width: `${abilityPct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div>
          <AbilityRadarChart abilities={person.abilities} aptitudes={person.aptitudes} />
          <div className="mt-1 flex justify-center gap-3 text-[10px]">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded bg-blue-400/40" />
              <span className="text-gray-400">{t('detail.person.ability')}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded bg-gray-400/30" />
              <span className="text-gray-400">{t('detail.person.aptitude')}</span>
            </span>
          </div>
        </div>
      )}

      <div className="text-sm font-semibold text-gray-300">
        {t('detail.person.derived_scores')}:
      </div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.governance')}:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'governance') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.stewardship')}:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'stewardship') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.diplomacy')}:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'diplomacy') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Intrigue:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'intrigue') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.war_command')}:</span>
          <span>{Math.round((getRoleScore(worldState, person.id, 'warCommand') / 10) * 10)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.prestige')}:</span>
          <span>{formatScore(person.legacyPrestige)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.wealth')}:</span>
          <span>{formatAmount(person.wealth)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.importance')}:</span>
          <span className="text-yellow-400">{Math.round(importanceScore)}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">{t('detail.person.traits')}:</div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.ambition')}:</span>
          <span>{formatScore(person.traits.ambition)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.person.caution')}:</span>
          <span>{formatScore(person.traits.caution)}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">{t('detail.person.family')}:</div>
      <div className="text-sm">
        {person.fatherId !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.person.father')}:</span>
            <PersonLink
              personId={person.fatherId}
              persons={currentState?.persons ?? {}}
              onClick={onPersonClick}
            />
          </div>
        )}
        {person.motherId !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.person.mother')}:</span>
            <PersonLink
              personId={person.motherId}
              persons={currentState?.persons ?? {}}
              onClick={onPersonClick}
            />
          </div>
        )}
        {person.spouseId !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.person.spouse')}:</span>
            <PersonLink
              personId={person.spouseId}
              persons={currentState?.persons ?? {}}
              onClick={onPersonClick}
            />
          </div>
        )}
        {person.childIds.length > 0 && (
          <div>
            <div className="text-gray-400">{t('detail.person.children')}:</div>
            <div className="flex flex-col gap-0.5">
              {person.childIds.slice(0, 8).map((cid) => (
                <PersonLink
                  key={cid}
                  personId={cid}
                  persons={currentState?.persons ?? {}}
                  onClick={onPersonClick}
                />
              ))}
              {person.childIds.length > 8 && (
                <span className="text-xs text-gray-500">+{person.childIds.length - 8} more</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="text-sm font-semibold text-gray-300">{t('detail.person.attitudes')}:</div>
      <AttitudeList
        attitudes={person.attitudes}
        worldState={worldState}
        onPolityClick={onPolityClick}
        onHouseClick={onHouseClick}
        onPersonClick={onPersonClick}
      />
    </div>
  )
}

function getDevelopmentLabel(d: number): string {
  if (d <= -50) return '荒廃'
  if (d <= -10) return '衰退'
  if (d < 10) return '通常'
  if (d < 50) return '発展'
  return '繁栄'
}

export function PopGroupDetail({
  popGroup,
  session,
  onPolityClick,
  onHouseClick,
  onPersonClick,
  onProvinceClick,
}: {
  popGroup: PopGroup
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: (id: string) => void
  onProvinceClick: (id: string) => void
}) {
  const currentState = session?.currentState
  const province = currentState?.provinces[popGroup.provinceId]

  const worldState: WorldState | null = currentState ?? null

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold capitalize">{popGroup.class}</span>
        <CopyJsonButton payload={buildEntitySnapshot('popGroup', popGroup, worldState)} />
      </div>
      <div className="text-sm text-gray-400">
        of{' '}
        <button
          className="cursor-pointer text-blue-400 hover:text-blue-300"
          onClick={() => onProvinceClick(popGroup.provinceId)}
        >
          {province?.name ?? '—'}
        </button>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">ID:</span>
          <span className="text-xs text-gray-500">{popGroup.id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Size:</span>
          <span>{popGroup.size.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Wealth:</span>
          <span>{popGroup.wealth.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Unrest:</span>
          <span className={popGroup.unrest > 60 ? 'text-red-400' : 'text-gray-200'}>
            {popGroup.unrest.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">Attitudes:</div>
      <AttitudeList
        attitudes={popGroup.attitudes}
        worldState={worldState}
        onPolityClick={onPolityClick}
        onHouseClick={onHouseClick}
        onPersonClick={onPersonClick}
      />
    </div>
  )
}

export function ProvinceDetail({
  province,
  session,
  onPolityClick,
  onHouseClick,
  onPersonClick,
  onProvinceClick,
  onPopGroupClick,
}: {
  province: Province
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: ClickHandler
  onProvinceClick: (id: string) => void
  onPopGroupClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const currentState = session?.currentState
  const holdingDev = currentState
    ? getProvinceDevelopmentFromHoldings(currentState, province.id)
    : 0
  const holdingCtrl = currentState
    ? getProvincePolityControlFromHoldings(currentState, province.id)
    : 0
  const developmentMultiplier = getProvinceDevelopmentMultiplier(holdingDev)

  const pops = currentState ? getProvincePops(currentState, province.id) : []
  const carryingCapacity = currentState
    ? getProvinceCarryingCapacity(currentState, defaultConfig, province.id)
    : 0
  const totalPopulation = currentState ? getProvincePopulation(currentState, province.id) : 0
  const populationPressure = currentState
    ? getProvincePopulationPressure(currentState, defaultConfig, province.id)
    : 0
  const avgWealth = currentState ? getProvinceAveragePopWealth(currentState, province.id) : 0
  const derivedUnrest = currentState ? getProvinceUnrest(currentState, province.id) : 0
  const derivedProduction = currentState
    ? getProvinceProduction(currentState, defaultConfig, province.id)
    : 0
  const derivedManpower = currentState
    ? getProvinceManpowerBase(currentState, defaultConfig, province.id)
    : 0

  const countryManpower = currentState
    ? getProvinceCountryManpowerBase(currentState, defaultConfig, province.id)
    : 0
  const houseManpower = currentState
    ? getProvinceHouseManpowerBase(currentState, defaultConfig, province.id)
    : 0

  // Calculate revolt tendency per class
  const calcRevoltTendencyForClass = (
    ws: WorldState,
    popClass: 'peasants' | 'townsmen' | 'nobles',
  ): number => {
    const polityId = getProvinceTerminalPolityId(ws, province.id)
    if (!polityId) return 0
    const polity = ws.polities[polityId]
    if (!polity) return 0
    const ownerHouseId = getProvinceEffectiveOwnerHouseId(ws, province.id)
    if (!ownerHouseId) return 0
    const ownerHouse = ws.houses[ownerHouseId]
    if (!ownerHouse) return 0

    const pop = Object.values(ws.popGroups).find(
      (p) => p?.provinceId === province.id && p?.class === popClass,
    )
    if (!pop) return 0

    // v0.16: houseControl 廃止により、polityControl のみ参照する
    const polityControl = ws ? getProvincePolityControlFromHoldings(ws, province.id) : 0
    let tendency =
      pop.unrest * defaultConfig.provinceRevoltUnrestFactor +
      (100 - polityControl) * defaultConfig.provinceRevoltLowCountryControlFactor -
      getPolityStability(ws, defaultConfig, polityId) *
        defaultConfig.provinceRevoltStabilitySuppressionFactor

    if (popClass === 'peasants') {
      if (pop.wealth < defaultConfig.povertyWealthThreshold) {
        tendency +=
          (defaultConfig.povertyWealthThreshold - pop.wealth) *
          defaultConfig.peasantRevoltPovertyFactor
      }
      const pressure = getProvincePopulationPressure(ws, defaultConfig, province.id)
      tendency += pressure * defaultConfig.peasantRevoltPressureFactor
    } else if (popClass === 'townsmen') {
      const townsmenWealth = getPopWealthByClass(ws, province.id, 'townsmen')
      if (townsmenWealth < defaultConfig.overExtractionWealthSafeThreshold) {
        tendency += defaultConfig.townsmenRevoltExtractionFactor
        tendency +=
          Math.log1p(getProvinceProduction(ws, defaultConfig, province.id)) *
          defaultConfig.townsmenRevoltProductionFactor
      }
    } else if (popClass === 'nobles') {
      const noblesPop = Object.values(ws.popGroups).find(
        (p) => p?.provinceId === province.id && p?.class === 'nobles',
      )
      if (noblesPop) {
        const a_house = getAttitudeOrDefault(ws, noblesPop, {
          kind: 'house',
          id: ownerHouseId,
        })
        const a_country = getAttitudeOrDefault(ws, noblesPop, {
          kind: 'polity',
          id: polityId,
        })
        const houseScore =
          attitudeValueToScore(a_house.affection) * 0.6 +
          attitudeValueToScore(a_house.respect) * 0.4
        const countryScore =
          attitudeValueToScore(a_country.affection) * 0.6 +
          attitudeValueToScore(a_country.respect) * 0.4
        const nobleDisloyalty = 100 - (0.5 * houseScore + 0.5 * countryScore)
        tendency += nobleDisloyalty * defaultConfig.nobleRevoltHouseDisloyaltyFactor
        tendency += nobleDisloyalty * defaultConfig.nobleRevoltLowLegitimacyFactor * 0.5
      }
    }

    return tendency
  }

  const peasantRevoltTendency = currentState
    ? calcRevoltTendencyForClass(currentState, 'peasants')
    : 0
  const townsmenRevoltTendency = currentState
    ? calcRevoltTendencyForClass(currentState, 'townsmen')
    : 0
  const noblesRevoltTendency = currentState ? calcRevoltTendencyForClass(currentState, 'nobles') : 0

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">{province.name}</span>
        <CopyJsonButton payload={buildEntitySnapshot('province', province, currentState ?? null)} />
      </div>

      <img
        src={getProvinceImage(province.id)}
        alt={province.name}
        className="h-24 w-full rounded object-cover"
        draggable={false}
      />

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.terminal_polity')}:</span>
          <PolityLink
            polityId={
              currentState ? getProvinceTerminalPolityId(currentState, province.id) : undefined
            }
            polities={currentState?.polities ?? {}}
            onClick={onPolityClick}
          />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.effective_owner')}:</span>
          <HouseLink
            houseId={
              currentState ? getProvinceEffectiveOwnerHouseId(currentState, province.id) : undefined
            }
            houses={currentState?.houses ?? {}}
            onClick={onHouseClick}
          />
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.habitability')}:</span>
          <span>{formatScore(province.habitability)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.development')}:</span>
          <span>
            {formatScore(holdingDev)} {getDevelopmentLabel(holdingDev)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.dev_multiplier')}:</span>
          <span>{formatScore(developmentMultiplier)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.polity_control')}:</span>
          <span>{formatPower(holdingCtrl)}</span>
        </div>
      </div>

      <div className="text-sm font-semibold text-gray-300">
        {t('detail.province.holdings')} ({province.holdingIds.length})
      </div>
      {currentState &&
        getProvinceHoldings(currentState, province.id).map((holding) => {
          const bailiff = getHoldingBailiffPerson(currentState, holding.id)
          return (
            <div
              key={holding.id}
              className="mb-1 flex gap-2 rounded border border-gray-700 bg-gray-800 p-1.5 text-sm"
            >
              <img
                src={getHoldingImage(holding.id, holding.kind)}
                alt={holding.name}
                className="h-16 w-16 flex-shrink-0 rounded object-cover"
                draggable={false}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-200">{holding.name}</span>
                  <span
                    className={`rounded px-1 text-xs ${holding.kind === 'city' ? 'bg-amber-800 text-amber-200' : 'bg-green-900 text-green-300'}`}
                  >
                    {holding.kind}
                  </span>
                </div>
                <div className="mt-0.5 grid grid-cols-2 gap-x-2 text-xs text-gray-400">
                  <span>
                    {t('detail.province.dev')}: {holding.development.toFixed(1)}
                  </span>
                  <span>
                    {t('detail.province.control')}: {holding.polityControl.toFixed(0)}%
                  </span>
                  <span>
                    {t('detail.province.quality')}: {holding.landQuality.toFixed(2)}
                  </span>
                  <span>
                    {t('detail.province.weight')}: {holding.weight.toFixed(1)}
                  </span>
                </div>
                {(() => {
                  const chain = getHoldingLandContractChain(currentState, holding.id)
                  if (chain.length === 0) return null
                  return (
                    <div className="mt-0.5 text-xs">
                      <span className="text-gray-500">{t('detail.province.contract_chain')}:</span>
                      {chain.map((contract, idx) => {
                        const grantee = currentState.polities[contract.granteePolityId]
                        const isTerminal = idx === chain.length - 1
                        return (
                          <div key={contract.id} className="border-l border-gray-700 pl-2">
                            {grantee ? (
                              <button
                                className="text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline"
                                onClick={() => onPolityClick(grantee.id, 'polity')}
                              >
                                {grantee.name}
                                {isTerminal
                                  ? ''
                                  : ` (${(contract.terms.taxRateToGrantor * 100).toFixed(0)}%)`}
                              </button>
                            ) : (
                              <span className="text-gray-500">—</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
                <div className="mt-0.5 text-xs text-gray-400">
                  {t('detail.province.bailiff')}:{' '}
                  {bailiff ? (
                    bailiff.kind === 'placeholder' ? (
                      <span className="text-gray-500 italic">
                        {t('detail.province.placeholder')}
                      </span>
                    ) : (
                      <PersonLink
                        personId={bailiff.id}
                        persons={currentState.persons ?? {}}
                        onClick={onPersonClick}
                      />
                    )
                  ) : (
                    <span className="text-gray-500">{t('detail.province.vacant')}</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}

      <div className="text-sm font-semibold text-gray-300">
        {t('detail.province.population_section')}
      </div>
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.carrying_capacity')}:</span>
          <span>{carryingCapacity.toFixed(0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.population')}:</span>
          <span>{totalPopulation.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.pop_pressure')}:</span>
          <span className={populationPressure > 0.9 ? 'text-red-400' : 'text-gray-200'}>
            {(populationPressure * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.avg_wealth')}:</span>
          <span>{avgWealth.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.unrest')}:</span>
          <span className={derivedUnrest > 60 ? 'text-red-400' : 'text-gray-200'}>
            {derivedUnrest.toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.production')}:</span>
          <span>{derivedProduction.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.manpower')}:</span>
          <span>{derivedManpower.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.country_manpower')}:</span>
          <span>{countryManpower.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.house_manpower')}:</span>
          <span>{houseManpower.toFixed(2)}</span>
        </div>
      </div>

      {pops.length > 0 && (
        <>
          <div className="text-sm font-semibold text-gray-300">
            {t('detail.province.pop_groups')}
          </div>
          {pops.map((pop) => (
            <div key={pop.id} className="rounded bg-gray-700 p-1.5 text-xs">
              <button
                className="w-full cursor-pointer text-left font-medium text-blue-400 capitalize hover:text-blue-300"
                onClick={() => onPopGroupClick(pop.id)}
              >
                {pop.class} →
              </button>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.province.size')}:</span>
                <span>{pop.size.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.province.wealth')}:</span>
                <span>{pop.wealth.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t('detail.province.unrest')}:</span>
                <span className={pop.unrest > 60 ? 'text-red-400' : 'text-gray-200'}>
                  {pop.unrest.toFixed(1)}
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="text-sm font-semibold text-gray-300">{t('detail.province.revolt_risk')}</div>
      <div className="text-sm">
        {(
          [
            [t('detail.province.peasants'), peasantRevoltTendency],
            [t('detail.province.townsmen'), townsmenRevoltTendency],
            [t('detail.province.nobles'), noblesRevoltTendency],
          ] as const
        ).map(([label, tendency]) => (
          <div key={label} className="flex justify-between">
            <span className="text-gray-400">{label}:</span>
            <span
              className={
                tendency >= defaultConfig.provinceRevoltThreshold ? 'text-red-400' : 'text-gray-200'
              }
            >
              {tendency.toFixed(1)}
            </span>
          </div>
        ))}
      </div>

      {province.neighbors.length > 0 && (
        <>
          <div className="text-sm font-semibold text-gray-300">Neighbors</div>
          <div className="flex flex-col gap-0.5 text-sm">
            {province.neighbors.map((nid) => (
              <button
                key={nid}
                className="text-left text-blue-400 underline underline-offset-2 hover:text-blue-300"
                onClick={() => onProvinceClick(nid)}
              >
                {currentState?.provinces?.[nid]?.name ?? nid}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function FactionDetail({
  faction,
  session,
  onPersonClick,
  onHouseClick,
}: {
  faction: Faction
  session: SimulationSession | null
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const { t } = useTranslation()
  const currentState = session?.currentState
  const worldState: WorldState | null = currentState ?? null
  if (!worldState) return null

  const persons = worldState.persons
  const houses = worldState.houses
  const leader = persons[faction.leaderPersonId]
  const memberIds = getFactionActiveMemberIds(worldState, faction.id)
  const viability = getFactionViabilityScore(worldState, defaultConfig, faction.id)
  const leaderOpportunity = getFactionOpportunityScore(
    worldState,
    defaultConfig,
    faction.leaderPersonId,
  )
  const ageYears = Math.floor((worldState.absoluteWeek - faction.foundingWeek) / 48)

  const memberRows = memberIds
    .filter((pid) => pid !== faction.leaderPersonId)
    .map((pid) => {
      const p = persons[pid]
      return p
    })
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .sort((a, b) => b.legacyPrestige - a.legacyPrestige)

  // v0.17.4 UI: 各 member の代表官職を抽出する。
  // 優先順位: Polity Office > House Office > Bailiff > 無職。
  // ROLE_ORDER で leader, administrator, treasurer, military, advisor の順に並べる。
  const ROSTER_ROLE_ORDER = ['leader', 'administrator', 'treasurer', 'military', 'advisor']
  const ws: WorldState = worldState
  function getMemberRepresentativeOffice(personId: PersonId): {
    label: string
    extraCount: number
    isUnemployed: boolean
  } {
    const officeIds = ws.officeIndex.byHolderPerson[personId] ?? []
    const offices = officeIds.flatMap((oid) => {
      const o = ws.officeAssignments[oid]
      return o && o.active ? [o] : []
    })
    const bailiffIds = ws.holdingOfficeIndex.byHolderPerson[personId] ?? []
    const bailiffs = bailiffIds.flatMap(
      (aid: import('@sim/types/ids').HoldingOfficeAssignmentId) => {
        const a = ws.holdingOfficeAssignments[aid]
        return a && a.active ? [a] : []
      },
    )
    const polityOfficesLocal = offices
      .filter((o) => o.organization.kind === 'polity')
      .sort((a, b) => ROSTER_ROLE_ORDER.indexOf(a.role) - ROSTER_ROLE_ORDER.indexOf(b.role))
    const houseOfficesLocal = offices
      .filter((o) => o.organization.kind === 'house')
      .sort((a, b) => ROSTER_ROLE_ORDER.indexOf(a.role) - ROSTER_ROLE_ORDER.indexOf(b.role))
    const total = offices.length + bailiffs.length
    if (polityOfficesLocal.length > 0) {
      const o = polityOfficesLocal[0]!
      const displayName =
        OFFICE_DEFINITIONS[`${o.organization.kind}:${o.role}`]?.displayName ?? o.role
      const orgName = ws.polities[o.organization.id as PolityId]?.name ?? o.organization.id
      return {
        label: `${displayName} (${orgName})`,
        extraCount: total - 1,
        isUnemployed: false,
      }
    }
    if (houseOfficesLocal.length > 0) {
      const o = houseOfficesLocal[0]!
      const displayName =
        OFFICE_DEFINITIONS[`${o.organization.kind}:${o.role}`]?.displayName ?? o.role
      const orgName = ws.houses[o.organization.id as HouseId]?.name ?? o.organization.id
      return {
        label: `${displayName} (${orgName})`,
        extraCount: total - 1,
        isUnemployed: false,
      }
    }
    if (bailiffs.length > 0) {
      const a = bailiffs[0]!
      const holdingName = ws.holdings[a.holdingId]?.name ?? a.holdingId
      return {
        label: `代官 (${holdingName})`,
        extraCount: total - 1,
        isUnemployed: false,
      }
    }
    return { label: '無職', extraCount: 0, isUnemployed: true }
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{faction.name}</span>
          {!faction.active && (
            <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-400">
              Dissolved
            </span>
          )}
        </div>
        <CopyJsonButton payload={buildEntitySnapshot('faction', faction, worldState)} />
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">ID:</span>
          <span className="text-xs text-gray-500">{faction.id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.faction.founded')}:</span>
          <span>
            {(() => {
              const f = weekToYearWeek(faction.foundingWeek)
              return `${f.year}/W${String(f.weekOfYear).padStart(2, '0')}`
            })()}{' '}
            <span className="text-xs text-gray-500">
              ({ageYears} year{ageYears === 1 ? '' : 's'} ago)
            </span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.faction.leader')}:</span>
          {leader ? (
            <PersonLink personId={leader.id} persons={persons} onClick={onPersonClick} />
          ) : (
            <span className="text-gray-500">—</span>
          )}
        </div>
        {leader && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.faction.leader_house')}:</span>
            <HouseLink houseId={leader.houseId} houses={houses} onClick={onHouseClick} />
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.faction.members')}:</span>
          <span>{memberIds.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.faction.viability')}:</span>
          <span>{formatScore(viability)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.faction.opportunity')}:</span>
          <span>{formatScore(leaderOpportunity)}</span>
        </div>
      </div>

      {/* v0.17.4 UI: 派閥の "ジョブ被害状況" を一目で見られるよう集計を表示 */}
      {(() => {
        const memberOfficeInfo = memberRows.map((p) => getMemberRepresentativeOffice(p.id))
        const employedCount = memberOfficeInfo.filter((info) => !info.isUnemployed).length
        const totalRoster = memberRows.length
        return (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-300">
              {t('detail.faction.roster')}
            </span>
            {totalRoster > 0 && (
              <span className="text-xs text-gray-400">
                有職: {employedCount}/{totalRoster}
              </span>
            )}
          </div>
        )
      })()}
      {memberRows.length === 0 ? (
        <div className="text-xs text-gray-500">(leader only)</div>
      ) : (
        <div className="flex flex-col gap-0.5 text-sm">
          {memberRows.map((p) => {
            const officeInfo = getMemberRepresentativeOffice(p.id)
            return (
              <div key={p.id} className="flex items-center justify-between rounded bg-gray-700 p-1">
                <div className="flex flex-col">
                  <PersonLink personId={p.id} persons={persons} onClick={onPersonClick} />
                  <span className="text-xs text-gray-400">
                    {p.houseId === ANONYMOUS_HOUSE_ID ? (
                      <span className="text-gray-500">(Unaffiliated)</span>
                    ) : (
                      <HouseLink houseId={p.houseId} houses={houses} onClick={onHouseClick} />
                    )}{' '}
                    · age {p.age}
                  </span>
                  <span
                    className={`text-xs ${
                      officeInfo.isUnemployed ? 'text-gray-500' : 'text-amber-300'
                    }`}
                  >
                    {officeInfo.label}
                    {officeInfo.extraCount > 0 && (
                      <span className="text-gray-500"> +{officeInfo.extraCount}</span>
                    )}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  Prestige {formatScore(p.legacyPrestige)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
