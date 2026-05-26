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
import { weekToYearMonthWeek, WEEKS_PER_YEAR } from '@sim/utils/timeUtils'
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
  getHoldingOccupationCapacity,
  getHoldingPopSizeByClassAndOccupation,
  getHoldingPops,
} from '@sim/selectors/popSelectors'
import {
  getProvinceProduction,
  getProvinceManpowerBase,
  getProvinceCountryManpowerBase,
  getProvinceHouseManpowerBase,
} from '@sim/selectors/popEconomySelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { getHoldingDevelopment } from '@sim/selectors/holdingImprovementSelectors'
import { computeEffectivePriority } from '@sim/selectors/taskSelectors'
import type { Polity } from '@/sim/types/polity'
import type { House } from '@/sim/types/house'
import type { Person } from '@/sim/types/person'
import type { Province } from '@/sim/types/province'
import type { PopGroup } from '@/sim/types/popGroup'
import { getPrimaryOccupationForClass } from '@/sim/types/popGroup'
import type { SimulationSession, WorldState } from '@/sim/types/world'
import type { Holding } from '@/sim/types/landContract'
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
import type { Project } from '@/sim/types/project'
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
  getHoldingTerminalPolityId,
} from '@sim/selectors/landContractSelectors'
import { getHoldingBailiffPerson } from '@sim/selectors/provinceOfficeSelectors'
import {
  getBailiffPolicy,
  getBailiffLocalExtractionRate,
  getBailiffCollectionEfficiency,
  getBailiffFeeRate,
  computeBailiffBurdenComponents,
  getRecentBailiffRevenueTaskStatus,
} from '@sim/selectors/bailiffSelectors'
import { personAttitudeKey } from '@sim/helpers/attitudeHelpers'
import {
  getActiveGoalForOwner,
  getActiveAimsForGoal,
  getActiveAimForOwner,
} from '@sim/selectors/goalSelectors'
import { getPersonGoalFulfillment } from '@sim/selectors/personGoalSelectors'
import { calcAmbitionScores } from '@/sim/tick/ambitionSystem'
import { calcPersonImportanceScore } from '@/sim/selectors/importanceSelectors'
import { calcPolityMilitaryPower } from '@/sim/selectors/militarySelectors'
import { normalizedStat } from '@/sim/selectors/personAbilityEffects'
import { OFFICE_DEFINITIONS } from '@sim/config/officeDefinitions'
import { clamp } from '@/sim/utils/math'
import type { SimEvent } from '@/sim/types/event'
import { hasEntityId } from '@sim/types/event'
import { useRenderEvent } from '@/app/hooks/useRenderEvent'
import { useEntityName } from '@/app/hooks/useEntityName'

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

// v0.17.4 UI: \u8a73\u7d30\u30d1\u30cd\u30eb\u8868\u793a\u4e2d\u30a8\u30f3\u30c6\u30a3\u30c6\u30a3\u306e\u300c\u30ea\u30c3\u30c1 JSON snapshot\u300d\u3092\u7d44\u307f\u7acb\u3066\u308b\u3002
// raw entity + \u89e3\u6c7a\u6e08\u307f\u53c2\u7167 (House/Polity/Person \u540d\u7b49) + \u6642\u523b\u6587\u8108\u3092\u542b\u3080\u3002
// LLM \u3078\u306e\u69cb\u9020\u5316\u5171\u6709\u3092\u60f3\u5b9a \u2014 \u904e\u5ea6\u306a derived \u306f\u5165\u308c\u305a\u3001\u751f\u30c7\u30fc\u30bf\u306b\u8584\u3044 overlay \u3092\u88ab\u305b\u308b\u65b9\u91dd\u3002
function buildEntitySnapshot(
  kind: 'polity' | 'house' | 'person' | 'province' | 'popGroup' | 'faction' | 'holding',
  entity: unknown,
  currentState: WorldState | null,
): unknown {
  const meta = currentState
    ? { currentYear: currentState.currentYear, currentWeekOfYear: currentState.currentWeekOfYear }
    : null
  const ws = currentState

  const houseNameKey = (id: HouseId | undefined): string | null =>
    id ? (ws?.houses[id]?.nameKey ?? null) : null
  const polityNameKey = (id: PolityId | undefined): string | null =>
    id ? (ws?.polities[id]?.nameKey ?? null) : null
  const personNameKey = (id: PersonId | undefined): string | null =>
    id ? (ws?.persons[id]?.nameKey ?? null) : null
  const provinceNameKey = (id: string | undefined): string | null =>
    id ? (ws?.provinces[id as import('@sim/types/ids').ProvinceId]?.nameKey ?? null) : null
  const factionLeaderNameKey = (
    factionId: import('@sim/types/ids').FactionId | undefined,
  ): string | null => {
    if (!factionId || !ws) return null
    const f = ws.factions[factionId]
    if (!f) return null
    const leader = ws.persons[f.leaderPersonId]
    return leader?.nameKey ?? null
  }

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
          holderName: holder.kind === 'house' ? houseNameKey(holder.id) : personNameKey(holder.id),
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
              provinceName: province?.nameKey ?? String(c.provinceId),
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
        ownerHouseName: houseNameKey(p.ownerHouseId),
        capitalProvinceName: provinceNameKey(p.capitalProvinceId),
        rulerPersonId: ws ? getPolityLeader(ws, p.id) : null,
        rulerPersonName: ws ? personNameKey(getPolityLeader(ws, p.id) ?? undefined) : null,
        terminalProvinceIds: terminalIds,
        terminalProvinceNames: terminalIds.map((pid) => provinceNameKey(pid)),
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
          holderName: holder.kind === 'person' ? personNameKey(holder.id) : String(holder.id),
          percent: Math.round(percent * 10) / 10,
        }))
      : []
    return {
      kind,
      meta,
      entity: h,
      derived: {
        headPersonId: ws ? getHouseLeader(ws, h.id) : null,
        headPersonName: ws ? personNameKey(getHouseLeader(ws, h.id) ?? undefined) : null,
        primaryPolityId: ws ? getHousePrimaryPolityId(ws, h.id) : null,
        primaryPolityName: ws
          ? polityNameKey(getHousePrimaryPolityId(ws, h.id) ?? undefined)
          : null,
        ownedPolityIds,
        ownedPolityNames: ownedPolityIds.map((pid) => polityNameKey(pid)),
        controlledProvinceIds,
        controlledProvinceNames: controlledProvinceIds.map((pid) => provinceNameKey(pid)),
        topShareholders: houseTopShareholders,
      },
    }
  }
  if (kind === 'person') {
    const pe = entity as Person
    const factionMembership = ws ? getActiveFactionMembership(ws, pe.id) : null
    const leaderFaction = ws ? getFactionByLeader(ws, pe.id) : null
    const factionInfo = leaderFaction
      ? {
          factionId: leaderFaction.id,
          factionName: factionLeaderNameKey(leaderFaction.id),
          role: 'leader' as const,
        }
      : factionMembership
        ? {
            factionId: factionMembership.factionId,
            factionName: factionLeaderNameKey(factionMembership.factionId),
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
                ? polityNameKey(o.organization.id)
                : houseNameKey(o.organization.id),
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
            appointingPolityName: polityNameKey(a.appointingPolityId),
            startWeek: a.startWeek,
          }))
      : []
    return {
      kind,
      meta,
      entity: pe,
      derived: {
        houseName: houseNameKey(pe.houseId),
        primaryPolityId: ws ? getPersonPrimaryPolityId(ws, pe.id) : null,
        primaryPolityName: ws
          ? polityNameKey(getPersonPrimaryPolityId(ws, pe.id) ?? undefined)
          : null,
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
          ? polityNameKey(getProvinceTerminalPolityId(ws, pv.id) ?? undefined)
          : null,
        effectiveOwnerHouseId: ws ? getProvinceEffectiveOwnerHouseId(ws, pv.id) : null,
        effectiveOwnerHouseName: ws
          ? houseNameKey(getProvinceEffectiveOwnerHouseId(ws, pv.id) ?? undefined)
          : null,
        landContractChain: chain.map((c) => ({
          id: c.id,
          granteePolityId: c.granteePolityId,
          granteePolityName: polityNameKey(c.granteePolityId),
          taxRateToGrantor: c.terms.taxRateToGrantor,
        })),
        bailiffPersonId: bailiff?.id ?? null,
        bailiffPersonName: bailiff?.nameKey ?? null,
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
        provinceName: ws ? provinceNameKey(ws.holdings[pg.holdingId]?.provinceId) : null,
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
        const orgName = ws.polities[o.organization.id as PolityId]?.nameKey ?? o.organization.id
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
        const orgName = ws.houses[o.organization.id as HouseId]?.nameKey ?? o.organization.id
        return {
          label: `${displayName} (${orgName})`,
          extraCount: total - 1,
          isUnemployed: false,
        }
      }
      if (bailiffs.length > 0) {
        const a = bailiffs[0]!
        const h = ws.holdings[a.holdingId]
        const holdingName = h ? (ws.provinces[h.provinceId]?.nameKey ?? a.holdingId) : a.holdingId
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
        personName: p?.nameKey ?? null,
        houseId: hid ?? null,
        houseName: isUnaffiliated ? null : houseNameKey(hid),
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
        leaderPersonName: personNameKey(f.leaderPersonId),
        leaderHouseId: leaderHouseId ?? null,
        leaderHouseName: houseNameKey(leaderHouseId),
        memberCount: memberIds.length,
        employedCount,
        members,
      },
    }
  }
  if (kind === 'holding') {
    const h = entity as Holding
    const bailiff = ws ? getHoldingBailiffPerson(ws, h.id) : null
    const assignmentId = ws?.holdingOfficeIndex.byHolding[h.id]
    const assignment = assignmentId ? ws?.holdingOfficeAssignments[assignmentId] : undefined
    return {
      kind,
      meta,
      entity: h,
      derived: {
        provinceName: provinceNameKey(h.provinceId),
        terminalPolityId: ws ? getHoldingTerminalPolityId(ws, h.id) : null,
        terminalPolityName: ws
          ? polityNameKey(getHoldingTerminalPolityId(ws, h.id) ?? undefined)
          : null,
        bailiffPersonId: bailiff?.id ?? null,
        bailiffPersonName: bailiff?.nameKey ?? null,
        bailiffIsPlaceholder: bailiff?.kind === 'placeholder',
        contractedRemittanceRate: assignment?.contractedRemittanceRate ?? null,
        expectedFeeRate: assignment?.expectedFeeRate ?? null,
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
  const resolveName = useEntityName()
  const person = persons[personId]
  if (!person) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(personId, 'person')}
    >
      {resolveName('person', person.nameKey, person.nameKey)}
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
  const resolveName = useEntityName()
  if (!houseId) return <span className="text-gray-500">\u2014</span>
  const house = houses[houseId]
  if (!house) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(houseId, 'house')}
    >
      {resolveName('house', house.nameKey, house.nameKey)}
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
  const resolveName = useEntityName()
  if (!polityId) return <span className="text-gray-500">\u2014</span>
  const polity = polities[polityId]
  if (!polity) return <span className="text-gray-500">\u2014</span>
  return (
    <button
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      onClick={() => onClick(polityId, 'polity')}
    >
      {resolveName('polity', polity.nameKey, polity.nameKey)}
    </button>
  )
}

function ProjectDetailCard({
  project,
  persons,
  onPersonClick,
  label,
}: {
  project: Project
  persons: Record<string, Person>
  onPersonClick: ClickHandler
  label: string
}) {
  const { t } = useTranslation()
  return (
    <div style={{ marginLeft: 8, marginTop: 4 }}>
      <strong>{label}</strong>
      <div style={{ marginLeft: 8 }}>
        <div>{t(`detail.project_kind.${project.kind}`)}</div>
        <div>
          {t('detail.play.project_stage')}: {t(`detail.play.stage_${project.currentStageKey}`)}
        </div>
        <div>
          {t('detail.polity.project_progress')}: {project.progress} / {project.targetProgress}
        </div>
        <div>
          {t('detail.polity.project_supervisor')}:{' '}
          <PersonLink
            personId={project.supervisorPersonId}
            persons={persons}
            onClick={onPersonClick}
          />
        </div>
        {project.deadlineWeek && (
          <div>
            {t('detail.polity.project_deadline')}: {t('detail.common.year')}{' '}
            {Math.ceil(project.deadlineWeek / 48)}
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectListItem({
  project,
  persons,
  onPersonClick,
  showSupervisor = true,
}: {
  project: Project
  persons: Record<string, Person>
  onPersonClick: ClickHandler
  showSupervisor?: boolean
}) {
  const { t } = useTranslation()
  return (
    <li className="mb-1 text-gray-400">
      <span className="text-gray-200">{t(`detail.project_kind.${project.kind}`)}</span> —{' '}
      {t(`detail.play.stage_${project.currentStageKey}`)} — {project.progress}/
      {project.targetProgress}
      {showSupervisor && (
        <>
          {' — '}
          <PersonLink
            personId={project.supervisorPersonId}
            persons={persons}
            onClick={onPersonClick}
          />
        </>
      )}
    </li>
  )
}

const ABILITY_KEYS = ['valor', 'command', 'numeracy', 'learning', 'charisma', 'insight'] as const

function AbilityRadarChart({
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
  const resolveName = useEntityName()
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
          const displayName = p ? resolveName('polity', p.nameKey, p.nameKey) : id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onPolityClick(id as PolityId, 'polity')}
            >
              {displayName}
            </button>
          )
        } else if (prefix === 'house') {
          const h = worldState.houses[id as HouseId]
          const displayName = h ? resolveName('house', h.nameKey, h.nameKey) : id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onHouseClick(id as HouseId, 'house')}
            >
              {displayName}
            </button>
          )
        } else if (prefix === 'person') {
          const p = worldState.persons[id as PersonId]
          const displayName = p ? resolveName('person', p.nameKey, p.nameKey) : id
          linkNode = (
            <button
              className="cursor-pointer text-blue-400 hover:text-blue-300"
              onClick={() => onPersonClick(id)}
            >
              {displayName}
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
  const resolveName = useEntityName()
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
        provinceName: province
          ? resolveName('province', province.nameKey, province.nameKey)
          : String(c.provinceId),
        holdings: [],
        totalRevenue: 0,
      }
      groupMap.set(key, group)
    }
    const holdingProvince = holding ? worldState.provinces[holding.provinceId] : undefined
    group.holdings.push({
      id: c.id,
      holdingId,
      holdingName: holdingProvince
        ? `${resolveName('province', holdingProvince.nameKey, holdingProvince.nameKey)} ${holding!.kind}`
        : '(unknown)',
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
      <div className="text-sm font-semibold text-gray-300">
        {t('detail.polity.land_contracts')} ({totalContracts}):
      </div>
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
  onDiplomaticPlayClick,
}: {
  polity: Polity
  session: SimulationSession | null
  watchlist: string[]
  toggleWatchlist: (id: string) => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
  onProvinceClick: (id: string) => void
  onDiplomaticPlayClick?: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
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
    administrator: t('polity.administrator', { ns: 'roles' }),
    military: t('polity.military', { ns: 'roles' }),
    treasurer: t('polity.treasurer', { ns: 'roles' }),
    advisor: t('polity.advisor', { ns: 'roles' }),
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
          <span className="text-lg font-bold">
            {resolveName('polity', polity.nameKey, polity.nameKey)}
          </span>
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
            {(() => {
              const p = currentState.provinces?.[polity.capitalProvinceId]
              return p ? resolveName('province', p.nameKey, p.nameKey) : polity.capitalProvinceId
            })()}
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
        {(['leader', 'administrator', 'military', 'treasurer', 'advisor'] as const).map((role) => {
          const polityRef = { kind: 'polity' as const, id: polity.id }
          const holderIds = worldState ? getActiveOfficeHolders(worldState, polityRef, role) : []
          return (
            <div key={role} className="flex justify-between">
              <span className="text-gray-400">{roleLabels[role]}:</span>
              <div className="flex flex-col items-end gap-0.5">
                {holderIds.length === 0 ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  holderIds.map((pid) => (
                    <PersonLink
                      key={pid as string}
                      personId={pid}
                      persons={persons}
                      onClick={onPersonClick}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
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

      {/* v0.22 Goal/Aim */}
      {worldState &&
        (() => {
          const owner = { kind: 'polity' as const, id: polity.id }
          const goal = getActiveGoalForOwner(worldState, owner)
          if (!goal) return null
          const activeAims = getActiveAimsForGoal(worldState, goal.id)
          const activeAim = activeAims[0]
          return (
            <div style={{ marginTop: 8 }}>
              <strong>{t('detail.polity.current_goal')}</strong>
              <div style={{ marginLeft: 8 }}>
                <div>{t(`goals:polity.${goal.kind}`)}</div>
                {goal.reasonIds.length > 0 && (
                  <ul style={{ margin: '2px 0', paddingLeft: 20 }}>
                    {goal.reasonIds.map((rid) => {
                      const reason = worldState.decisionReasons[rid]
                      if (!reason) return null
                      return (
                        <li key={rid} style={{ fontSize: '0.9em', opacity: 0.85 }}>
                          {t(reason.summaryKey, { ns: 'decision_reasons' })}
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div>
                  {t('detail.polity.goal_progress')}: {goal.progress} / {goal.targetProgress}
                </div>
              </div>
              {activeAim && (
                <div style={{ marginLeft: 8, marginTop: 4 }}>
                  <strong>{t('detail.polity.active_aim')}</strong>
                  <div style={{ marginLeft: 8 }}>
                    <div>{t(`aims:polity.${activeAim.kind}`)}</div>
                    <div>
                      {t('detail.polity.aim_progress')}: {activeAim.progress} /{' '}
                      {activeAim.targetProgress}
                    </div>
                    <div>
                      {t('detail.polity.aim_deadline')}: {t('detail.common.year')}{' '}
                      {Math.ceil(activeAim.deadlineWeek / 48)}
                    </div>
                  </div>
                </div>
              )}
              {activeAim &&
                worldState &&
                (() => {
                  const aimKey = `aim:${activeAim.id}`
                  const projectIds = worldState.projectIndex.byAim[aimKey] ?? []
                  const activeProjects = projectIds
                    .map((pid) => worldState.projects[pid])
                    .filter(
                      (p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active',
                    )
                  if (activeProjects.length === 0) return null
                  return activeProjects.map((project) => (
                    <ProjectDetailCard
                      key={project.id}
                      project={project}
                      persons={worldState.persons}
                      onPersonClick={onPersonClick}
                      label={t('detail.polity.active_project')}
                    />
                  ))
                })()}
              {activeAim?.activeDiplomaticPlayId &&
                (() => {
                  const play = worldState.diplomaticPlays[activeAim.activeDiplomaticPlayId]
                  if (!play || (play.status !== 'active' && play.status !== 'escalated'))
                    return null
                  return (
                    <div style={{ marginLeft: 8, marginTop: 4 }}>
                      <strong>{t('detail.polity.active_play')}</strong>
                      <div style={{ marginLeft: 8 }}>
                        {onDiplomaticPlayClick ? (
                          <button
                            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                            onClick={() => onDiplomaticPlayClick(play.id)}
                          >
                            {t(`play_kind.${play.kind}`, { ns: 'diplomacy' })}
                          </button>
                        ) : (
                          <div>{t(`play_kind.${play.kind}`, { ns: 'diplomacy' })}</div>
                        )}
                        <div>
                          {t('sidebar.play_progress')}: {Math.round(play.progress)} |{' '}
                          {t('sidebar.play_tension')}: {Math.round(play.tension)}
                        </div>
                      </div>
                    </div>
                  )
                })()}
            </div>
          )
        })()}

      {/* Projects Section */}
      {worldState &&
        (() => {
          const ownerKey = `polity:${polity.id}`
          const projectIds = worldState.projectIndex.byOwner[ownerKey] ?? []
          const activeProjects = projectIds
            .map((pid) => worldState.projects[pid])
            .filter((p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active')
          if (activeProjects.length === 0) return null
          return (
            <div className="mt-2">
              <div className="text-sm font-semibold text-gray-300">
                {t('detail.polity.projects_section')} ({activeProjects.length})
              </div>
              <ul className="list-inside text-sm">
                {activeProjects.map((project) => (
                  <ProjectListItem
                    key={project.id}
                    project={project}
                    persons={worldState.persons}
                    onPersonClick={onPersonClick}
                  />
                ))}
              </ul>
            </div>
          )
        })()}
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
  onDiplomaticPlayClick,
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
  onDiplomaticPlayClick?: (id: string) => void
  eventHistory: SimEvent[]
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
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
        <span className="text-lg font-bold">
          {resolveName('house', house.nameKey, house.nameKey)}
        </span>
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
                {resolveName('polity', p.nameKey, p.nameKey)}
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
                        {resolveName('polity', p.nameKey, p.nameKey)}
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
                        {resolveName('polity', p.nameKey, p.nameKey)}
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
            {(() => {
              const p = currentState.provinces?.[house.seatProvinceId]
              return p ? resolveName('province', p.nameKey, p.nameKey) : house.seatProvinceId
            })()}
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
            const roleLabel = t(`house.${role}`, { ns: 'roles' })
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
          <span>
            {(() => {
              const p = currentState?.persons?.[house.founderId]
              return p ? resolveName('person', p.nameKey, p.nameKey) : house.founderId
            })()}
          </span>
        </div>
      )}
      {house.parentHouseId !== undefined && (
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.house.parent_house')}:</span>
          <span>
            {(() => {
              const h = currentState?.houses?.[house.parentHouseId]
              return h ? resolveName('house', h.nameKey, h.nameKey) : house.parentHouseId
            })()}
          </span>
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

      {/* v0.22 Goal/Aim */}
      {currentState &&
        (() => {
          const owner = { kind: 'house' as const, id: house.id }
          const goal = getActiveGoalForOwner(currentState, owner)
          if (!goal) return null
          const activeAims = getActiveAimsForGoal(currentState, goal.id)
          const activeAim = activeAims[0]
          return (
            <div style={{ marginTop: 8 }}>
              <strong>{t('detail.house.current_goal')}</strong>
              <div style={{ marginLeft: 8 }}>
                <div>{t(`goals:house.${goal.kind}`)}</div>
                {goal.reasonIds.length > 0 && currentState && (
                  <ul style={{ margin: '2px 0', paddingLeft: 20 }}>
                    {goal.reasonIds.map((rid) => {
                      const reason = currentState.decisionReasons[rid]
                      if (!reason) return null
                      return (
                        <li key={rid} style={{ fontSize: '0.9em', opacity: 0.85 }}>
                          {t(reason.summaryKey, { ns: 'decision_reasons' })}
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div>
                  {t('detail.house.goal_progress')}: {goal.progress} / {goal.targetProgress}
                </div>
              </div>
              {activeAim && (
                <div style={{ marginLeft: 8, marginTop: 4 }}>
                  <strong>{t('detail.house.active_aim')}</strong>
                  <div style={{ marginLeft: 8 }}>
                    <div>{t(`aims:house.${activeAim.kind}`)}</div>
                    <div>
                      {t('detail.house.aim_progress')}: {activeAim.progress} /{' '}
                      {activeAim.targetProgress}
                    </div>
                    <div>
                      {t('detail.house.aim_deadline')}: {t('detail.common.year')}{' '}
                      {Math.ceil(activeAim.deadlineWeek / 48)}
                    </div>
                  </div>
                </div>
              )}
              {activeAim &&
                (() => {
                  const aimKey = `aim:${activeAim.id}`
                  const projectIds = currentState.projectIndex.byAim[aimKey] ?? []
                  const activeProjects = projectIds
                    .map((pid) => currentState.projects[pid])
                    .filter(
                      (p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active',
                    )
                  if (activeProjects.length === 0) return null
                  return activeProjects.map((project) => (
                    <ProjectDetailCard
                      key={project.id}
                      project={project}
                      persons={currentState.persons}
                      onPersonClick={onPersonClick}
                      label={t('detail.house.active_project')}
                    />
                  ))
                })()}
              {activeAim?.activeDiplomaticPlayId &&
                (() => {
                  const play = currentState.diplomaticPlays[activeAim.activeDiplomaticPlayId]
                  if (!play || (play.status !== 'active' && play.status !== 'escalated'))
                    return null
                  return (
                    <div style={{ marginLeft: 8, marginTop: 4 }}>
                      <strong>{t('detail.house.active_play')}</strong>
                      <div style={{ marginLeft: 8 }}>
                        {onDiplomaticPlayClick ? (
                          <button
                            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                            onClick={() => onDiplomaticPlayClick(play.id)}
                          >
                            {t(`play_kind.${play.kind}`, { ns: 'diplomacy' })}
                          </button>
                        ) : (
                          <div>{t(`play_kind.${play.kind}`, { ns: 'diplomacy' })}</div>
                        )}
                        <div>
                          {t('sidebar.play_progress')}: {Math.round(play.progress)} |{' '}
                          {t('sidebar.play_tension')}: {Math.round(play.tension)}
                        </div>
                      </div>
                    </div>
                  )
                })()}
            </div>
          )
        })()}

      {/* Projects Section */}
      {currentState &&
        (() => {
          const ownerKey = `house:${house.id}`
          const projectIds = currentState.projectIndex.byOwner[ownerKey] ?? []
          const activeProjects = projectIds
            .map((pid) => currentState.projects[pid])
            .filter((p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active')
          if (activeProjects.length === 0) return null
          return (
            <div className="mt-2">
              <div className="text-sm font-semibold text-gray-300">
                {t('detail.house.projects_section')} ({activeProjects.length})
              </div>
              <ul className="list-inside text-sm">
                {activeProjects.map((project) => (
                  <ProjectListItem
                    key={project.id}
                    project={project}
                    persons={currentState.persons}
                    onPersonClick={onPersonClick}
                  />
                ))}
              </ul>
            </div>
          )
        })()}
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
  const resolveName = useEntityName()
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
    holdingImprovements: {},
    holdingImprovementIndex: { byHolding: {} },
    nextHoldingImprovementId: 0,
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    nextLandContractId: 0,
    nextHoldingOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    projects: {},
    projectIndex: {
      byOwner: {},
      byAim: {},
      byParentProject: {},
      byCreatorPerson: {},
      bySupervisorPerson: {},
      byRelatedEntity: {},
    },
    diplomaticPlays: {},
    pressures: {},
    pressureIndex: { byTarget: {}, bySource: {}, byDiplomaticPlay: {}, byProject: {} },
    nextProjectId: 0,
    nextDiplomaticPlayId: 0,
    nextPressureId: 1,
    // v0.22 Goal/Aim system
    goals: {},
    aims: {},
    decisionReasons: {},
    goalIndex: { byOwner: {} },
    aimIndex: { byOwner: {}, byGoal: {} },
    nextGoalId: 0,
    nextAimId: 0,
    nextDecisionReasonId: 0,
    tasks: {},
    taskIndex: { byAssignee: {}, byOwner: {}, byTarget: {} },
    personActivityLogs: {},
    personActivityLogIndex: { byPerson: {} },
    personTrainingExperience: {},
    popIndex: { byHolding: {} },
    nextPopGroupId: 0,
    waitingAimIds: [],
    nextTaskId: 0,
    nextPersonActivityLogId: 0,
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
    return t(`${office.organization.kind}.${office.role}`, { ns: 'roles' })
  }

  function officeOrgName(office: (typeof allOffices)[number]): string {
    const org = office.organization
    if (org.kind === 'polity') {
      const p = worldState.polities[org.id]
      return p ? resolveName('polity', p.nameKey, p.nameKey) : org.id
    }
    const h = worldState.houses[org.id]
    return h ? resolveName('house', h.nameKey, h.nameKey) : org.id
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
        <span className="text-lg font-bold">
          {resolveName('person', person.nameKey, person.nameKey)}
        </span>
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
            <span>
              {t(`detail.occupations.${person.occupation}`, { defaultValue: person.occupation })}
            </span>
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
          const factionLeader = worldState.persons[faction.leaderPersonId]
          const factionDisplayName = factionLeader
            ? `${factionLeader.nameKey}'s faction`
            : faction.id
          return (
            <div className="flex justify-between">
              <span className="text-gray-400">{t('detail.person.faction')}:</span>
              <span>
                ◈{' '}
                <button
                  className="cursor-pointer text-blue-400 underline underline-offset-2 hover:text-blue-300"
                  onClick={() => onFactionClick(faction.id)}
                >
                  {factionDisplayName}
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
                {resolveName('polity', p.nameKey, p.nameKey)}
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
                    const policy = getBailiffPolicy(worldState, defaultConfig, a.id)
                    const policyColor: Record<string, string> = {
                      passive: 'text-gray-400',
                      loyal_remittance: 'text-blue-400',
                      profit_seeking: 'text-amber-400',
                      protect_residents: 'text-green-400',
                    }
                    return (
                      <div key={a.id} className="flex items-center justify-between gap-2">
                        <span className="text-gray-300">
                          {t('holding.bailiff', { ns: 'roles' })}
                          <span
                            className={`ml-1 text-xs ${policyColor[policy] ?? 'text-gray-300'}`}
                          >
                            ({t(`detail.province.bailiff_policy_${policy}`)})
                          </span>
                        </span>
                        <button
                          className="text-right text-blue-400 underline underline-offset-2 hover:text-blue-300"
                          onClick={() => onProvinceClick(holding?.provinceId ?? '')}
                        >
                          {holding
                            ? (worldState.provinces[holding.provinceId]?.nameKey ?? a.holdingId)
                            : a.holdingId}
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
          {ABILITY_KEYS.map((key) => {
            const label = t(`detail.person.ability_${key}`)
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
          <span className="text-gray-400">{t('detail.person.intrigue')}:</span>
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

      {/* v0.23 Person Goal/Aim */}
      {person.alive &&
        person.kind !== 'placeholder' &&
        (() => {
          const owner = { kind: 'person' as const, id: person.id }
          const goal = getActiveGoalForOwner(worldState, owner)
          if (!goal) return null
          const fulfillment = getPersonGoalFulfillment(worldState, person.id)
          const activeAim = getActiveAimForOwner(worldState, owner)

          return (
            <>
              <div className="text-sm font-semibold text-gray-300">
                {t('detail.person.current_goal')}:
              </div>
              <div className="text-sm" style={{ marginLeft: 8 }}>
                <div>{t(`goals:person.${goal.kind}`)}</div>
                <div>
                  {t('detail.person.goal_fulfillment')}: {Math.round(fulfillment)}%
                </div>
              </div>

              {activeAim && (
                <>
                  <div className="text-sm font-semibold text-gray-300" style={{ marginTop: 4 }}>
                    {t('detail.person.active_aim')}:
                  </div>
                  <div className="text-sm" style={{ marginLeft: 8 }}>
                    <div>{t(`aims:person.${activeAim.kind}`)}</div>
                    <div>
                      {t('detail.person.aim_progress')}: {activeAim.progress} /{' '}
                      {activeAim.targetProgress}
                    </div>
                    <div>
                      {t('detail.person.aim_deadline')}: {t('detail.common.year')}{' '}
                      {Math.ceil(activeAim.deadlineWeek / 48)}
                    </div>
                    {activeAim.waitingReasonKey && (
                      <div className="text-xs text-yellow-400">
                        {t('detail.person.aim_status_waiting')}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )
        })()}

      {/* Task list + Activity log (independent of Goal) */}
      {person.alive &&
        person.kind !== 'placeholder' &&
        (() => {
          const taskIds = worldState.taskIndex.byAssignee[person.id as string] ?? []
          const activeTasks = taskIds
            .map((tid) => worldState.tasks[tid])
            .filter((t): t is NonNullable<typeof t> => t !== undefined && t.status === 'active')
            .sort(
              (a, b) =>
                computeEffectivePriority(worldState, defaultConfig, b) -
                computeEffectivePriority(worldState, defaultConfig, a),
            )
          const activityLogIds =
            worldState.personActivityLogIndex.byPerson[person.id as string] ?? []
          const recentLogs = activityLogIds
            .map((lid) => worldState.personActivityLogs[lid])
            .filter((l): l is NonNullable<typeof l> => l !== undefined)
            .sort((a, b) => b.week - a.week)
            .slice(0, 5)

          if (activeTasks.length === 0 && recentLogs.length === 0) return null

          return (
            <>
              {activeTasks.length > 0 && (
                <>
                  <div className="text-sm font-semibold text-gray-300" style={{ marginTop: 4 }}>
                    {t('detail.person.assigned_tasks')} ({activeTasks.length}):
                  </div>
                  <div className="text-sm" style={{ marginLeft: 8 }}>
                    {activeTasks.map((task) => {
                      const ep = computeEffectivePriority(worldState, defaultConfig, task)
                      return (
                        <div
                          key={task.id}
                          className="mb-1 rounded bg-gray-700/50 px-2 py-1 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-gray-200">{t(task.kind, { ns: 'tasks' })}</span>
                            <span className="text-gray-500">P:{ep}</span>
                          </div>
                          <div className="text-gray-400">
                            {t('detail.person.task_effort')}: {Math.round(task.effortDone)} /{' '}
                            {task.effortRequired}
                          </div>
                          <div className="text-gray-500">
                            {task.targetRef.kind === 'aim' &&
                              (() => {
                                const aim = worldState.aims[task.targetRef.id]
                                if (!aim) return t('detail.person.task_target_aim')
                                if (
                                  aim.owner.kind === 'person' &&
                                  (aim.owner.id as string) === (person.id as string)
                                ) {
                                  return t('detail.person.task_target_own_aim')
                                }
                                if (aim.owner.kind === 'house') {
                                  const h = worldState.houses[aim.owner.id]
                                  const name = h
                                    ? resolveName('house', h.nameKey, h.nameKey)
                                    : aim.owner.id
                                  return t('detail.person.task_target_house_aim', { name })
                                }
                                if (aim.owner.kind === 'polity') {
                                  const p = worldState.polities[aim.owner.id]
                                  const name = p
                                    ? resolveName('polity', p.nameKey, p.nameKey)
                                    : aim.owner.id
                                  return t('detail.person.task_target_polity_aim', { name })
                                }
                                return t('detail.person.task_target_aim')
                              })()}
                            {task.targetRef.kind === 'project' &&
                              (() => {
                                if (task.owner.kind === 'house') {
                                  const h = worldState.houses[task.owner.id]
                                  const name = h
                                    ? resolveName('house', h.nameKey, h.nameKey)
                                    : task.owner.id
                                  return t('detail.person.task_target_house_project', { name })
                                }
                                if (task.owner.kind === 'polity') {
                                  const p = worldState.polities[task.owner.id]
                                  const name = p
                                    ? resolveName('polity', p.nameKey, p.nameKey)
                                    : task.owner.id
                                  return t('detail.person.task_target_polity_project', { name })
                                }
                                return t('detail.person.task_target_project')
                              })()}
                            {task.targetRef.kind === 'diplomatic_play' &&
                              (() => {
                                if (task.owner.kind === 'house') {
                                  const h = worldState.houses[task.owner.id]
                                  const name = h
                                    ? resolveName('house', h.nameKey, h.nameKey)
                                    : task.owner.id
                                  return t('detail.person.task_target_house_play', { name })
                                }
                                if (task.owner.kind === 'polity') {
                                  const p = worldState.polities[task.owner.id]
                                  const name = p
                                    ? resolveName('polity', p.nameKey, p.nameKey)
                                    : task.owner.id
                                  return t('detail.person.task_target_polity_play', { name })
                                }
                                return t('detail.person.task_target_play')
                              })()}
                            {task.targetRef.kind === 'holding_office_assignment' &&
                              (() => {
                                const hoa = worldState.holdingOfficeAssignments[task.targetRef.id]
                                if (!hoa) return t('detail.person.task_target_bailiff_duty')
                                const holding = worldState.holdings[hoa.holdingId]
                                if (!holding) return t('detail.person.task_target_bailiff_duty')
                                const prov = worldState.provinces[holding.provinceId]
                                const name = prov
                                  ? resolveName('province', prov.nameKey, prov.nameKey)
                                  : (holding.provinceId as string)
                                return t('detail.person.task_target_bailiff_holding', { name })
                              })()}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {recentLogs.length > 0 && (
                <>
                  <div className="text-sm font-semibold text-gray-300" style={{ marginTop: 4 }}>
                    {t('detail.person.recent_activities')}:
                  </div>
                  <div className="text-sm" style={{ marginLeft: 8 }}>
                    {recentLogs.map((log) => (
                      <div
                        key={log.id}
                        className={`text-xs ${'outcome' in log ? (log.outcome === 'success' ? 'text-green-400' : log.outcome === 'failure' ? 'text-red-400' : 'text-gray-400') : log.kind === 'project_completed' ? 'text-blue-400' : 'text-red-400'}`}
                      >
                        [Y{Math.ceil(log.week / 48)}/W{((log.week - 1) % 48) + 1}]{' '}
                        {'taskKind' in log ? (
                          <>
                            {t(log.taskKind, { ns: 'tasks' })}{' '}
                            {log.outcome === 'success' ? '✓' : '✗'}
                          </>
                        ) : (
                          <>
                            {log.params?.improvementKind
                              ? t(
                                  `detail.activity.${log.kind === 'project_completed' ? 'project_completed' : 'project_failed'}`,
                                  {
                                    kind: t(
                                      `detail.province.improvement_${log.params.improvementKind}`,
                                    ),
                                    level: log.params.targetLevel ?? '?',
                                  },
                                )
                              : `${t(`detail.project_kind.${log.projectKind}`)} ${log.kind === 'project_completed' ? '✓' : '✗'}`}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )
        })()}

      {/* Supervised / Created Projects */}
      {(() => {
        const pKey = person.id as string
        const supervisedIds = worldState.projectIndex.bySupervisorPerson[pKey] ?? []
        const supervisedProjects = supervisedIds
          .map((pid) => worldState.projects[pid])
          .filter((p): p is NonNullable<typeof p> => p !== undefined && p.status === 'active')
        const createdIds = worldState.projectIndex.byCreatorPerson[pKey] ?? []
        const createdProjects = createdIds
          .map((pid) => worldState.projects[pid])
          .filter(
            (p): p is NonNullable<typeof p> =>
              p !== undefined && p.status === 'active' && (p.supervisorPersonId as string) !== pKey,
          )
        if (supervisedProjects.length === 0 && createdProjects.length === 0) return null
        return (
          <div className="mt-2">
            {supervisedProjects.length > 0 && (
              <>
                <div className="text-sm font-semibold text-gray-300">
                  {t('detail.person.supervised_projects')} ({supervisedProjects.length})
                </div>
                <ul className="list-inside text-sm">
                  {supervisedProjects.map((project) => (
                    <ProjectListItem
                      key={project.id}
                      project={project}
                      persons={worldState.persons}
                      onPersonClick={onPersonClick}
                      showSupervisor={false}
                    />
                  ))}
                </ul>
              </>
            )}
            {createdProjects.length > 0 && (
              <>
                <div className="text-sm font-semibold text-gray-300" style={{ marginTop: 4 }}>
                  {t('detail.person.created_projects')} ({createdProjects.length})
                </div>
                <ul className="list-inside text-sm">
                  {createdProjects.map((project) => (
                    <ProjectListItem
                      key={project.id}
                      project={project}
                      persons={worldState.persons}
                      onPersonClick={onPersonClick}
                    />
                  ))}
                </ul>
              </>
            )}
          </div>
        )
      })()}
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
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const currentState = session?.currentState
  const holding = currentState?.holdings[popGroup.holdingId]
  const province = holding ? currentState?.provinces[holding.provinceId] : undefined

  const worldState: WorldState | null = currentState ?? null

  const classLabel =
    popGroup.class === 'peasants'
      ? t('detail.province.peasants')
      : popGroup.class === 'townsmen'
        ? t('detail.province.townsmen')
        : popGroup.class === 'nobles'
          ? t('detail.province.nobles')
          : popGroup.class

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">{classLabel}</span>
        <span className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300">
          {t(`popOccupation.${popGroup.occupation}`)}
        </span>
        <CopyJsonButton payload={buildEntitySnapshot('popGroup', popGroup, worldState)} />
      </div>
      <div className="text-sm text-gray-400">
        of{' '}
        <button
          className="cursor-pointer text-blue-400 hover:text-blue-300"
          onClick={() => {
            const holdingId = popGroup.holdingId
            const holding = worldState?.holdings[holdingId]
            if (holding) onProvinceClick(holding.provinceId)
          }}
        >
          {province
            ? `${resolveName('province', province.nameKey, province.nameKey)} ${holding?.kind ?? ''}`
            : '—'}
        </button>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">ID:</span>
          <span className="text-xs text-gray-500">{popGroup.id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.size')}:</span>
          <span>{popGroup.size.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.wealth')}:</span>
          <span>{popGroup.wealth.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.unrest')}:</span>
          <span className={popGroup.unrest > 60 ? 'text-red-400' : 'text-gray-200'}>
            {popGroup.unrest.toFixed(1)}
          </span>
        </div>
      </div>

      {popGroup.occupation !== 'none' && currentState && (
        <div className="text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.province.capacity')}:</span>
            <span>
              {popGroup.size.toFixed(1)} /{' '}
              {getHoldingOccupationCapacity(
                currentState,
                defaultConfig,
                popGroup.holdingId,
                popGroup.class,
                popGroup.occupation,
              ).toFixed(1)}
            </span>
          </div>
        </div>
      )}

      <div className="text-sm font-semibold text-gray-300">{t('detail.person.attitudes')}:</div>
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

export function HoldingDetail({
  holding,
  session,
  onPolityClick,
  onPersonClick,
  onProvinceClick,
  onPopGroupClick,
}: {
  holding: Holding
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onPersonClick: (id: string) => void
  onProvinceClick: (id: string) => void
  onPopGroupClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const currentState = session?.currentState
  const province = currentState?.provinces[holding.provinceId]

  const holdingDisplay = province
    ? `${resolveName('province', province.nameKey, province.nameKey)} ${holding.kind}`
    : holding.id

  return (
    <div className="flex flex-col gap-1 p-3">
      {/* Header: Holding name + kind badge + copy */}
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">{holdingDisplay}</span>
        <div className="flex items-center gap-1.5">
          <CopyJsonButton payload={buildEntitySnapshot('holding', holding, currentState ?? null)} />
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${holding.kind === 'city' ? 'bg-amber-800 text-amber-200' : 'bg-green-900 text-green-300'}`}
          >
            {holding.kind}
          </span>
        </div>
      </div>

      {/* Header image */}
      <img
        src={getHoldingImage(holding.id, holding.kind)}
        alt={holdingDisplay}
        className="h-24 w-full rounded object-cover"
        draggable={false}
      />

      {/* Province link */}
      {province && (
        <div className="text-sm text-gray-400">
          <button
            className="cursor-pointer text-blue-400 hover:text-blue-300"
            onClick={() => onProvinceClick(province.id)}
          >
            {resolveName('province', province.nameKey, province.nameKey)}
          </button>
        </div>
      )}

      {/* Basic stats */}
      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.dev')}:</span>
          <span>
            {(currentState
              ? getHoldingDevelopment(currentState, defaultConfig, holding.id)
              : 0
            ).toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.control')}:</span>
          <span>{holding.polityControl.toFixed(0)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.quality')}:</span>
          <span>{holding.landQuality.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.province.weight')}:</span>
          <span>{holding.weight.toFixed(1)}</span>
        </div>
      </div>

      {/* Improvements */}
      {currentState &&
        (() => {
          const impIds = currentState.holdingImprovementIndex.byHolding[holding.id as string] ?? []
          const improvements = impIds
            .map((id) => currentState.holdingImprovements[id])
            .filter((imp): imp is NonNullable<typeof imp> => imp !== undefined)
          if (improvements.length === 0) return null
          return (
            <div className="text-sm">
              <div className="font-semibold text-gray-300">{t('detail.province.improvements')}</div>
              {improvements.map((imp) => {
                const nameKey = `detail.province.improvement_name_${imp.kind}_${holding.kind}_${imp.level}`
                const flavorName = t(nameKey)
                const categoryName = t(`detail.province.improvement_${imp.kind}`)
                return (
                  <div key={imp.id} className="ml-2 flex items-baseline justify-between">
                    <span className="text-gray-200">{flavorName}</span>
                    <span className="text-xs text-gray-500">
                      （{categoryName}{' '}
                      {t('detail.province.improvement_level', { level: imp.level })}）
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })()}

      {/* Active develop_holding Project */}
      {currentState &&
        (() => {
          const relKey = `holding:${holding.id}`
          const projectIds = currentState.projectIndex.byRelatedEntity[relKey] ?? []
          const activeProject = projectIds
            .map((pid) => currentState.projects[pid])
            .find(
              (p): p is NonNullable<typeof p> =>
                p !== undefined && p.status === 'active' && p.kind === 'develop_holding',
            )
          if (!activeProject || activeProject.kind !== 'develop_holding') return null
          const supervisor = currentState.persons[activeProject.supervisorPersonId]
          return (
            <div className="text-sm">
              <div className="font-semibold text-gray-300">
                {t('detail.province.active_develop_project')}
              </div>
              <div className="ml-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">{t('detail.province.project_stage')}:</span>
                  <span>{t(`detail.province.project_stage_${activeProject.currentStageKey}`)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">
                    {t(`detail.province.improvement_${activeProject.improvementKind}`)}
                  </span>
                  <span>&rarr; Lv.{activeProject.targetImprovementLevel}</span>
                </div>
                {activeProject.currentStageKey === 'execute_project' && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('detail.house.project_progress')}:</span>
                    <span>
                      {activeProject.progress}/{activeProject.targetProgress}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-400">
                    {t('detail.province.project_budget_total')}:
                  </span>
                  <span>{activeProject.budget.required.toFixed(0)}</span>
                </div>
                {activeProject.currentStageKey === 'execute_project' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-400">
                        {t('detail.province.project_budget_remaining')}:
                      </span>
                      <span>{activeProject.budget.remaining.toFixed(0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">
                        {t('detail.province.project_budget_spent')}:
                      </span>
                      <span>{activeProject.budget.spent.toFixed(0)}</span>
                    </div>
                  </>
                )}
                {supervisor && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('detail.house.project_supervisor')}:</span>
                    <PersonLink
                      personId={supervisor.id}
                      persons={currentState.persons}
                      onClick={onPersonClick}
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })()}

      {/* Bailiff */}
      {currentState &&
        (() => {
          const bailiff = getHoldingBailiffPerson(currentState, holding.id)
          const assignmentId = currentState.holdingOfficeIndex.byHolding[holding.id]

          const policyColorMap: Record<string, string> = {
            passive: 'text-gray-400',
            loyal_remittance: 'text-blue-400',
            profit_seeking: 'text-amber-400',
            protect_residents: 'text-green-400',
          }

          return (
            <div className="text-sm">
              <span className="text-gray-400">{t('detail.province.bailiff')}: </span>
              {bailiff ? (
                bailiff.kind === 'placeholder' ? (
                  <span className="text-gray-500 italic">{t('detail.province.placeholder')}</span>
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
              {bailiff &&
                assignmentId &&
                (() => {
                  const isPlaceholder = bailiff.kind === 'placeholder'
                  const policy = getBailiffPolicy(currentState, defaultConfig, assignmentId)
                  const localExtractionRate = getBailiffLocalExtractionRate(
                    currentState,
                    defaultConfig,
                    assignmentId,
                  )
                  const recentTaskStatus = getRecentBailiffRevenueTaskStatus(
                    currentState,
                    assignmentId,
                  )
                  const collectionEfficiency = getBailiffCollectionEfficiency(
                    currentState,
                    defaultConfig,
                    assignmentId,
                    recentTaskStatus,
                  )
                  const bailiffFeeRate = getBailiffFeeRate(
                    currentState,
                    defaultConfig,
                    assignmentId,
                  )
                  const burden = computeBailiffBurdenComponents(
                    localExtractionRate,
                    collectionEfficiency,
                    defaultConfig.collectionFrictionFactor,
                  )

                  return (
                    <div className="mt-1 ml-2 space-y-0.5 text-xs text-gray-400">
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_policy')}:</span>
                        <span className={policyColorMap[policy] ?? 'text-gray-300'}>
                          {t(`detail.province.bailiff_policy_${policy}`)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_local_extraction')}:</span>
                        <span>{(localExtractionRate * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_collection_efficiency')}:</span>
                        <span>{(collectionEfficiency * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_fee_rate')}:</span>
                        <span>{(bailiffFeeRate * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_total_burden')}:</span>
                        <span>{(burden.totalBurdenRate * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('detail.province.bailiff_friction')}:</span>
                        <span>{(burden.collectionFrictionBurdenRate * 100).toFixed(1)}%</span>
                      </div>
                      {!isPlaceholder && (
                        <>
                          <div className="flex justify-between">
                            <span>{t('detail.province.bailiff_recent_task')}:</span>
                            <span>
                              {recentTaskStatus === 'completed'
                                ? t('detail.province.bailiff_task_completed')
                                : t('detail.province.bailiff_task_none')}
                            </span>
                          </div>
                          {(() => {
                            const popIds = currentState.popIndex.byHolding[holding.id] ?? []
                            let totalAffection = 0
                            let totalRespect = 0
                            let totalSize = 0
                            const attKey = personAttitudeKey(bailiff.id)
                            for (const popId of popIds) {
                              const pop = currentState.popGroups[popId]
                              if (!pop) continue
                              const att = pop.attitudes[attKey]
                              if (att) {
                                totalAffection += (att.affection ?? 0) * pop.size
                                totalRespect += (att.respect ?? 0) * pop.size
                              }
                              totalSize += pop.size
                            }
                            const avgAffection = totalSize > 0 ? totalAffection / totalSize : 0
                            const avgRespect = totalSize > 0 ? totalRespect / totalSize : 0
                            return (
                              <div className="flex justify-between">
                                <span>{t('detail.province.bailiff_pop_attitude')}:</span>
                                <span>
                                  {t('detail.province.bailiff_affection')}{' '}
                                  <span
                                    className={
                                      avgAffection >= 0 ? 'text-green-400' : 'text-red-400'
                                    }
                                  >
                                    {avgAffection >= 0 ? '+' : ''}
                                    {avgAffection.toFixed(2)}
                                  </span>
                                  {' / '}
                                  {t('detail.province.bailiff_respect')}{' '}
                                  <span
                                    className={avgRespect >= 0 ? 'text-blue-400' : 'text-red-400'}
                                  >
                                    {avgRespect >= 0 ? '+' : ''}
                                    {avgRespect.toFixed(2)}
                                  </span>
                                </span>
                              </div>
                            )
                          })()}
                        </>
                      )}
                    </div>
                  )
                })()}
            </div>
          )
        })()}

      {/* Contract chain */}
      {currentState &&
        (() => {
          const chain = getHoldingLandContractChain(currentState, holding.id)
          if (chain.length === 0) return null
          return (
            <div className="text-sm">
              <div className="text-gray-400">{t('detail.province.contract_chain')}:</div>
              {chain.map((contract, idx) => {
                const grantee = currentState.polities[contract.granteePolityId]
                const nextContract = idx + 1 < chain.length ? chain[idx + 1] : undefined
                const protectedRemaining =
                  nextContract?.termsProtectedUntilWeek &&
                  currentState.absoluteWeek < nextContract.termsProtectedUntilWeek
                    ? Math.ceil(
                        (nextContract.termsProtectedUntilWeek - currentState.absoluteWeek) /
                          WEEKS_PER_YEAR,
                      )
                    : null
                return (
                  <div key={contract.id}>
                    <div className="border-l border-gray-700 pl-2 text-sm">
                      {grantee ? (
                        <button
                          className="text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline"
                          onClick={() => onPolityClick(grantee.id, 'polity')}
                        >
                          {resolveName('polity', grantee.nameKey, grantee.nameKey)}
                        </button>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </div>
                    {nextContract && (
                      <div className="border-l border-gray-700 pl-3 text-xs text-gray-500">
                        ↓ {(nextContract.terms.taxRateToGrantor * 100).toFixed(0)}%
                        {protectedRemaining != null && (
                          <span className="ml-1 text-yellow-500">
                            🛡{' '}
                            {t('detail.province.terms_protected_until', {
                              years: protectedRemaining,
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}

      {/* POP breakdown by class */}
      {currentState && (
        <>
          <div className="text-sm font-semibold text-gray-300">POP</div>
          {(['peasants', 'townsmen', 'nobles'] as const).map((popClass) => {
            const primaryOcc = getPrimaryOccupationForClass(popClass)
            const employed = getHoldingPopSizeByClassAndOccupation(
              currentState,
              holding.id,
              popClass,
              primaryOcc,
            )
            const cap = getHoldingOccupationCapacity(
              currentState,
              defaultConfig,
              holding.id,
              popClass,
              primaryOcc,
            )
            const unemployed = getHoldingPopSizeByClassAndOccupation(
              currentState,
              holding.id,
              popClass,
              'none',
            )
            if (employed === 0 && unemployed === 0) return null
            return (
              <div key={popClass} className="text-sm">
                <div className="font-medium text-gray-300">{t(`detail.province.${popClass}`)}</div>
                <div className="ml-2 text-gray-400">
                  <div className="flex justify-between">
                    <span>{t(`popOccupation.${primaryOcc}`)}:</span>
                    <span>
                      {employed.toFixed(1)} / {cap.toFixed(1)}
                    </span>
                  </div>
                  {unemployed > 0 && (
                    <div className="flex justify-between">
                      <span className="text-yellow-400">{t('popOccupation.none')}:</span>
                      <span className="text-yellow-400">{unemployed.toFixed(1)}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* Individual POP group list (clickable) */}
      {currentState &&
        (() => {
          const pops = getHoldingPops(currentState, holding.id)
          if (pops.length === 0) return null
          return (
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
                    {t(`detail.province.${pop.class}`, { defaultValue: pop.class })}{' '}
                    <span className="text-xs font-normal text-gray-400">
                      ({t(`popOccupation.${pop.occupation}`)})
                    </span>{' '}
                    →
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
          )
        })()}
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
  onHoldingClick,
}: {
  province: Province
  session: SimulationSession | null
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
  onPersonClick: ClickHandler
  onProvinceClick: (id: string) => void
  onPopGroupClick: (id: string) => void
  onHoldingClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
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

    const pop = (() => {
      for (const holdingId of province.holdingIds) {
        const popIds = ws.popIndex?.byHolding[holdingId]
        if (!popIds) continue
        for (const popId of popIds) {
          const p = ws.popGroups[popId]
          if (p && p.class === popClass) return p
        }
      }
      return undefined
    })()
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
      const noblesPop = (() => {
        for (const holdingId of province.holdingIds) {
          const popIds = ws.popIndex?.byHolding[holdingId]
          if (!popIds) continue
          for (const popId of popIds) {
            const p = ws.popGroups[popId]
            if (p && p.class === 'nobles') return p
          }
        }
        return undefined
      })()
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
        <span className="text-lg font-bold">
          {resolveName('province', province.nameKey, province.nameKey)}
        </span>
        <CopyJsonButton payload={buildEntitySnapshot('province', province, currentState ?? null)} />
      </div>

      <img
        src={getProvinceImage(province.id)}
        alt={resolveName('province', province.nameKey, province.nameKey)}
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
          const holdingProv = currentState.provinces[holding.provinceId]
          const holdingDisplay = holdingProv
            ? `${resolveName('province', holdingProv.nameKey, holdingProv.nameKey)} ${holding.kind}`
            : holding.id
          return (
            <div
              key={holding.id}
              className="mb-1 flex gap-2 rounded border border-gray-700 bg-gray-800 p-1.5 text-sm"
            >
              <img
                src={getHoldingImage(holding.id, holding.kind)}
                alt={holdingDisplay}
                className="h-16 w-16 flex-shrink-0 rounded object-cover"
                draggable={false}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <button
                    className="cursor-pointer font-medium text-blue-400 hover:text-blue-300"
                    onClick={() => onHoldingClick(holding.id)}
                  >
                    {holdingDisplay}
                  </button>
                  <span
                    className={`rounded px-1 text-xs ${holding.kind === 'city' ? 'bg-amber-800 text-amber-200' : 'bg-green-900 text-green-300'}`}
                  >
                    {holding.kind}
                  </span>
                </div>
                <div className="mt-0.5 grid grid-cols-2 gap-x-2 text-xs text-gray-400">
                  <span>
                    {t('detail.province.dev')}:{' '}
                    {(currentState
                      ? getHoldingDevelopment(currentState, defaultConfig, holding.id)
                      : 0
                    ).toFixed(1)}
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
                        const nextContract = idx + 1 < chain.length ? chain[idx + 1] : undefined
                        return (
                          <div key={contract.id}>
                            <div className="border-l border-gray-700 pl-2">
                              {grantee ? (
                                <button
                                  className="text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline"
                                  onClick={() => onPolityClick(grantee.id, 'polity')}
                                >
                                  {resolveName('polity', grantee.nameKey, grantee.nameKey)}
                                </button>
                              ) : (
                                <span className="text-gray-500">—</span>
                              )}
                            </div>
                            {nextContract && (
                              <div className="border-l border-gray-700 pl-3 text-gray-500">
                                ↓ {(nextContract.terms.taxRateToGrantor * 100).toFixed(0)}%
                              </div>
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
                <div className="mt-1 border-t border-gray-700 pt-1">
                  {(['peasants', 'townsmen', 'nobles'] as const).map((popClass) => {
                    const primaryOcc = getPrimaryOccupationForClass(popClass)
                    const employed = getHoldingPopSizeByClassAndOccupation(
                      currentState,
                      holding.id,
                      popClass,
                      primaryOcc,
                    )
                    const cap = getHoldingOccupationCapacity(
                      currentState,
                      defaultConfig,
                      holding.id,
                      popClass,
                      primaryOcc,
                    )
                    const unemployed = getHoldingPopSizeByClassAndOccupation(
                      currentState,
                      holding.id,
                      popClass,
                      'none',
                    )
                    if (employed === 0 && unemployed === 0) return null
                    return (
                      <div key={popClass} className="text-xs text-gray-400">
                        <span className="text-gray-300">{t(`detail.province.${popClass}`)}</span>
                        <div className="ml-2">
                          <span>
                            {t(`popOccupation.${primaryOcc}`)}: {employed.toFixed(1)} /{' '}
                            {cap.toFixed(1)}
                          </span>
                          {unemployed > 0 && (
                            <span className="ml-2 text-yellow-400">
                              {t('popOccupation.none')}: {unemployed.toFixed(1)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
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
                {t(`detail.province.${pop.class}`, { defaultValue: pop.class })}{' '}
                <span className="text-xs font-normal text-gray-400">
                  ({t(`popOccupation.${pop.occupation}`)})
                </span>{' '}
                →
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
          <div className="text-sm font-semibold text-gray-300">
            {t('detail.province.neighbors')}
          </div>
          <div className="flex flex-col gap-0.5 text-sm">
            {province.neighbors.map((nid) => (
              <button
                key={nid}
                className="text-left text-blue-400 underline underline-offset-2 hover:text-blue-300"
                onClick={() => onProvinceClick(nid)}
              >
                {(() => {
                  const np = currentState?.provinces?.[nid]
                  return np ? resolveName('province', np.nameKey, np.nameKey) : nid
                })()}
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
  const resolveName = useEntityName()
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
      const roleName = resolveName('role', `${o.organization.kind}_${o.role}`, o.role)
      const orgNameKey = ws.polities[o.organization.id as PolityId]?.nameKey ?? o.organization.id
      const orgName = resolveName('polity', orgNameKey, orgNameKey)
      return {
        label: `${roleName} (${orgName})`,
        extraCount: total - 1,
        isUnemployed: false,
      }
    }
    if (houseOfficesLocal.length > 0) {
      const o = houseOfficesLocal[0]!
      const roleName = resolveName('role', `${o.organization.kind}_${o.role}`, o.role)
      const orgNameKey = ws.houses[o.organization.id as HouseId]?.nameKey ?? o.organization.id
      const orgName = resolveName('house', orgNameKey, orgNameKey)
      return {
        label: `${roleName} (${orgName})`,
        extraCount: total - 1,
        isUnemployed: false,
      }
    }
    if (bailiffs.length > 0) {
      const a = bailiffs[0]!
      const hld = ws.holdings[a.holdingId]
      const provNameKey = hld ? (ws.provinces[hld.provinceId]?.nameKey ?? a.holdingId) : a.holdingId
      const provName = resolveName('province', provNameKey, provNameKey)
      return {
        label: `${t('detail.faction.bailiff_label')} (${provName})`,
        extraCount: total - 1,
        isUnemployed: false,
      }
    }
    return { label: t('detail.faction.unemployed_label'), extraCount: 0, isUnemployed: true }
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">
            {leader ? `${leader.nameKey}'s faction` : faction.id}
          </span>
          {!faction.active && (
            <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-gray-400">
              {t('detail.faction.dissolved')}
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
              const f = weekToYearMonthWeek(faction.foundingWeek)
              return `${f.year}/${f.month}/${f.weekOfMonth}`
            })()}{' '}
            <span className="text-xs text-gray-500">
              {t('detail.faction.years_ago', { years: ageYears })}
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
                {t('detail.faction.employed_count', {
                  employed: employedCount,
                  total: totalRoster,
                })}
              </span>
            )}
          </div>
        )
      })()}
      {memberRows.length === 0 ? (
        <div className="text-xs text-gray-500">{t('detail.faction.leader_only')}</div>
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
                      <span className="text-gray-500">
                        {t('detail.faction.unaffiliated_member')}
                      </span>
                    ) : (
                      <HouseLink houseId={p.houseId} houses={houses} onClick={onHouseClick} />
                    )}{' '}
                    · {t('detail.faction.age_label', { age: p.age })}
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
                  {t('detail.faction.prestige_label')} {formatScore(p.legacyPrestige)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function DiplomaticPlayDetail({
  play,
  session,
  onPersonClick,
  onPolityClick,
  onProvinceClick,
  onHoldingClick,
}: {
  play: import('@sim/types/diplomaticPlay').DiplomaticPlay
  session: SimulationSession | null
  onPersonClick: ClickHandler
  onPolityClick: ClickHandler
  onProvinceClick: (id: string) => void
  onHoldingClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const worldState = session?.currentState ?? null
  if (!worldState) return null

  const polities = worldState.polities
  const persons = worldState.persons

  const started = weekToYearMonthWeek(play.startedWeek)
  const deadline = weekToYearMonthWeek(play.deadlineWeek)

  const statusBadge: Record<string, { label: string; bg: string }> = {
    active: { label: t('sidebar.play_status.active'), bg: 'bg-blue-700' },
    escalated: { label: t('sidebar.play_status.escalated'), bg: 'bg-red-700' },
    settled: { label: t('detail.play.status_settled'), bg: 'bg-green-700' },
    failed: { label: t('detail.play.status_failed'), bg: 'bg-gray-600' },
    resolved_by_conflict: {
      label: t('detail.play.status_resolved_by_conflict'),
      bg: 'bg-orange-700',
    },
    cancelled: { label: t('detail.play.status_cancelled'), bg: 'bg-gray-600' },
  }
  const badge = statusBadge[play.status] ?? { label: play.status, bg: 'bg-gray-600' }

  let provinceId: ProvinceId | undefined
  let holdingId: HoldingId | undefined
  if (play.primaryDemand.kind === 'transfer_land_contract') {
    holdingId = play.primaryDemand.holdingId
    provinceId = worldState.holdings[holdingId]?.provinceId
  } else if (play.primaryDemand.kind === 'change_contract_tax_rate') {
    holdingId = play.primaryDemand.holdingId
    provinceId = worldState.holdings[holdingId]?.provinceId
  } else if (play.primaryDemand.kind === 'revolt_concession') {
    provinceId = play.primaryDemand.provinceId
  }
  const holding = holdingId ? worldState.holdings[holdingId] : undefined

  const initiatorPolity = polities[play.initiator.id as PolityId]
  const targetPolity = polities[play.target.id as PolityId]

  const initiatorTasks = play.initiatorActiveTaskIds
    .map((tid) => worldState.tasks[tid])
    .filter((tk): tk is NonNullable<typeof tk> => !!tk)
  const targetTasks = play.targetActiveTaskIds
    .map((tid) => worldState.tasks[tid])
    .filter((tk): tk is NonNullable<typeof tk> => !!tk)

  // Related projects
  const initiatorProject = play.originProjectId
    ? worldState.projects[play.originProjectId]
    : undefined
  const pressureIds = worldState.pressureIndex.byDiplomaticPlay[play.id]
  const targetPressure = pressureIds
    ?.map((pid) => worldState.pressures[pid])
    .find((p) => p && p.responseProjectId)
  const targetProject = targetPressure?.responseProjectId
    ? worldState.projects[targetPressure.responseProjectId]
    : undefined

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-gray-600 px-1.5 py-0.5 text-xs text-white">
          {t(`play_kind.${play.kind}`, { ns: 'diplomacy' })}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-xs text-white ${badge.bg}`}>
          {badge.label}
        </span>
      </div>

      <div className="text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.play.initiator')}:</span>
          {initiatorPolity ? (
            <PolityLink polityId={initiatorPolity.id} polities={polities} onClick={onPolityClick} />
          ) : (
            <span>{play.initiator.id}</span>
          )}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.play.target')}:</span>
          {targetPolity ? (
            <PolityLink polityId={targetPolity.id} polities={polities} onClick={onPolityClick} />
          ) : (
            <span>{play.target.id}</span>
          )}
        </div>
        {provinceId && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.play.province')}:</span>
            <button
              className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
              onClick={() => onProvinceClick(provinceId)}
            >
              {resolveName(
                'province',
                worldState.provinces[provinceId]?.nameKey ?? provinceId,
                provinceId,
              )}
            </button>
          </div>
        )}
        {holding && provinceId && (
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.play.holding')}:</span>
            <button
              className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
              onClick={() => onHoldingClick(holding.id)}
            >
              {resolveName(
                'province',
                worldState.provinces[provinceId]?.nameKey ?? provinceId,
                provinceId,
              )}{' '}
              {holding.kind}
            </button>
          </div>
        )}

        <div className="my-1 border-t border-gray-700" />

        <div className="flex justify-between">
          <span className="text-gray-400">{t('sidebar.play_progress')}:</span>
          <span>{Math.round(play.progress)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('sidebar.play_tension')}:</span>
          <span>{Math.round(play.tension)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('detail.play.started')}:</span>
          <span>
            {started.year}/{started.month}/{started.weekOfMonth}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{t('sidebar.play_deadline')}:</span>
          <span>
            {deadline.year}/{deadline.month}/{deadline.weekOfMonth}
          </span>
        </div>

        <div className="my-1 border-t border-gray-700" />

        <div className="text-sm font-semibold text-gray-300">{t('detail.play.initiator_side')}</div>
        <div style={{ marginLeft: 8 }}>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.play.delegate')}:</span>
            {play.initiatorDelegatePersonId ? (
              <PersonLink
                personId={play.initiatorDelegatePersonId}
                persons={persons}
                onClick={onPersonClick}
              />
            ) : (
              <span className="text-gray-500">—</span>
            )}
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('diplomacy:params.preparation')}:</span>
            <span>{Math.round(play.initiatorPreparation)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('diplomacy:params.leverage')}:</span>
            <span>{Math.round(play.initiatorLeverage)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('diplomacy:params.commitment')}:</span>
            <span>{Math.round(play.initiatorCommitment)}</span>
          </div>
          {initiatorTasks.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div className="text-xs font-semibold text-gray-400">
                {t('detail.play.active_tasks')}:
              </div>
              {initiatorTasks.map((task) => (
                <div key={task.id} className="text-xs text-gray-300" style={{ marginLeft: 8 }}>
                  {t(task.kind, { ns: 'tasks' })} — {Math.round(task.effortDone)}/
                  {task.effortRequired}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-sm font-semibold text-gray-300" style={{ marginTop: 4 }}>
          {t('detail.play.target_side')}
        </div>
        <div style={{ marginLeft: 8 }}>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('detail.play.delegate')}:</span>
            {play.targetDelegatePersonId ? (
              <PersonLink
                personId={play.targetDelegatePersonId}
                persons={persons}
                onClick={onPersonClick}
              />
            ) : (
              <span className="text-gray-500">—</span>
            )}
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('diplomacy:params.preparation')}:</span>
            <span>{Math.round(play.targetPreparation)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('diplomacy:params.leverage')}:</span>
            <span>{Math.round(play.targetLeverage)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">{t('diplomacy:params.commitment')}:</span>
            <span>{Math.round(play.targetCommitment)}</span>
          </div>
          {targetTasks.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div className="text-xs font-semibold text-gray-400">
                {t('detail.play.active_tasks')}:
              </div>
              {targetTasks.map((task) => (
                <div key={task.id} className="text-xs text-gray-300" style={{ marginLeft: 8 }}>
                  {t(task.kind, { ns: 'tasks' })} — {Math.round(task.effortDone)}/
                  {task.effortRequired}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="my-1 border-t border-gray-700" />

        <div className="text-sm font-semibold text-gray-300">{t('detail.play.demand')}</div>
        <div className="text-xs text-gray-400" style={{ marginLeft: 8 }}>
          {play.primaryDemand.kind === 'transfer_land_contract' &&
            `${t('detail.play.demand_transfer_land')}`}
          {play.primaryDemand.kind === 'change_contract_tax_rate' &&
            (() => {
              const currentRate =
                worldState.landContracts[play.primaryDemand.landContractId]?.terms.taxRateToGrantor
              return `${t('detail.play.demand_tax_change')} ${currentRate != null ? Math.round(currentRate * 100) : '?'}% → ${Math.round(play.primaryDemand.newTaxRateToGrantor * 100)}%`
            })()}
          {play.primaryDemand.kind === 'revolt_concession' &&
            `${t('detail.play.demand_revolt_concession')} (${play.primaryDemand.concessionLevel})`}
          {play.primaryDemand.kind === 'status_quo' && t('detail.play.demand_status_quo')}
          {play.primaryDemand.kind === 'pay_wealth' &&
            `${t('detail.play.demand_pay_wealth')} ${formatAmount(play.primaryDemand.amount)}`}
        </div>
        {play.counterDemand && play.counterDemand.kind !== 'status_quo' && (
          <>
            <div className="text-sm font-semibold text-gray-300" style={{ marginTop: 2 }}>
              {t('detail.play.counter_demand')}
            </div>
            <div className="text-xs text-gray-400" style={{ marginLeft: 8 }}>
              {play.counterDemand.kind === 'pay_wealth' &&
                `${t('detail.play.demand_pay_wealth')} ${formatAmount(play.counterDemand.amount)}`}
              {play.counterDemand.kind === 'transfer_land_contract' &&
                t('detail.play.demand_transfer_land')}
              {play.counterDemand.kind === 'change_contract_tax_rate' &&
                (() => {
                  const currentRate =
                    worldState.landContracts[play.counterDemand.landContractId]?.terms
                      .taxRateToGrantor
                  return `${t('detail.play.demand_tax_change')} ${currentRate != null ? Math.round(currentRate * 100) : '?'}% → ${Math.round(play.counterDemand.newTaxRateToGrantor * 100)}%`
                })()}
            </div>
          </>
        )}

        {(initiatorProject || targetProject) && (
          <>
            <div className="my-1 border-t border-gray-700" />
            <div className="text-sm font-semibold text-gray-300">
              {t('detail.play.related_projects')}
            </div>
            {initiatorProject && (
              <div style={{ marginLeft: 8 }}>
                <div className="text-xs font-semibold text-gray-400">
                  {t('detail.play.initiator_project')}
                </div>
                <div className="text-xs text-gray-300" style={{ marginLeft: 8 }}>
                  <div>
                    {t(`detail.project_kind.${initiatorProject.kind}`)} —{' '}
                    <span className="text-gray-400">
                      {t(`detail.play.stage_${initiatorProject.currentStageKey}`)}
                    </span>
                  </div>
                  <div>
                    {t('detail.play.project_progress')}: {Math.round(initiatorProject.progress)}/
                    {initiatorProject.targetProgress}
                  </div>
                </div>
              </div>
            )}
            {targetProject && (
              <div style={{ marginLeft: 8, marginTop: 4 }}>
                <div className="text-xs font-semibold text-gray-400">
                  {t('detail.play.target_project')}
                </div>
                <div className="text-xs text-gray-300" style={{ marginLeft: 8 }}>
                  <div>
                    {t(`detail.project_kind.${targetProject.kind}`)} —{' '}
                    <span className="text-gray-400">
                      {t(`detail.play.stage_${targetProject.currentStageKey}`)}
                    </span>
                  </div>
                  <div>
                    {t('detail.play.project_progress')}: {Math.round(targetProject.progress)}/
                    {targetProject.targetProgress}
                  </div>
                  {targetProject.kind === 'respond_to_pressure' && targetProject.stance && (
                    <div>
                      {t('detail.play.stance')}: {t(`detail.play.stance_${targetProject.stance}`)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
