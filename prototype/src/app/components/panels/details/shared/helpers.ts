import type { TFunction } from 'i18next'
import { getPolityShortName } from '@/app/hooks/entityNameHelpers'
import type { WorldState } from '@/sim/types/world'
import type { HoldingId, PolityId, HouseId, PersonId } from '@/sim/types/ids'
import type { SimEvent } from '@/sim/types/event'
import type { Polity } from '@/sim/types/polity'
import {
  getProvinceTerminalPolityId,
  getProvinceLandContractChain,
  getHouseOwnedPolityIds,
  getHouseControlledProvinceIds,
  getProvinceEffectiveOwnerHouseId,
  getHoldingTerminalPolityId,
} from '@sim/selectors/landContractSelectors'
import { getTopShareholders } from '@sim/selectors/shareSelectors'
import { getTopInfluenceHoldersInPolity } from '@sim/selectors/influenceSelectors'
import { getProvincePolityControlFromHoldings } from '@/sim/selectors/landContractSelectors'
import { getProvinceProduction } from '@sim/selectors/popEconomySelectors'
import { getPolityEmitNameKey } from '@sim/selectors/nameRefSelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { getPolityLeader, getHouseLeader } from '@sim/selectors/officeSelectors'
import type { House } from '@/sim/types/house'
import { getHousePrimaryPolityId, getPersonPrimaryPolityId } from '@sim/selectors/polityRelations'
import type { Person } from '@/sim/types/person'
import {
  getActiveFactionMembership,
  getFactionByLeader,
  getFactionActiveMemberIds,
} from '@sim/selectors/factionSelectors'
import { OFFICE_DEFINITIONS } from '@sim/config/officeDefinitions'
import { isHouselessPerson, isLandlessHouseMember } from '@sim/selectors/availabilitySelectors'
import type { Province } from '@/sim/types/province'
import { getHoldingBailiffPerson } from '@sim/selectors/provinceOfficeSelectors'
import type { PopGroup } from '@/sim/types/popGroup'
import type { Faction } from '@/sim/types/faction'
import type { Holding } from '@/sim/types/landContract'
import type { Clan } from '@/sim/types/clan'
import {
  getClanActiveHouseIds,
  getClanExtinctHouseIds,
  getClanLivingMemberCount,
  getClanTotalWealth,
  getClanTotalLegacyPrestige,
} from '@sim/selectors/clanSelectors'

/** Holding の improvement を解決する（ヘッダー画像選択用。kind/level のみ参照）。 */
export function resolveHoldingImprovements(state: WorldState, holdingId: HoldingId) {
  const ids = state.holdingImprovementIndex.byHolding[holdingId as string] ?? []
  return ids
    .map((id) => state.holdingImprovements[id])
    .filter((imp): imp is NonNullable<typeof imp> => imp !== undefined)
}

export function getImportanceColor(importance: SimEvent['importance']): string {
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

export type ClickHandler = (
  id: PolityId | HouseId | PersonId,
  type: 'person' | 'house' | 'polity',
) => void

// v0.17.4 UI: \u8a73\u7d30\u30d1\u30cd\u30eb\u8868\u793a\u4e2d\u30a8\u30f3\u30c6\u30a3\u30c6\u30a3\u306e\u300c\u30ea\u30c3\u30c1 JSON snapshot\u300d\u3092\u7d44\u307f\u7acb\u3066\u308b\u3002
// raw entity + \u89e3\u6c7a\u6e08\u307f\u53c2\u7167 (House/Polity/Person \u540d\u7b49) + \u6642\u523b\u6587\u8108\u3092\u542b\u3080\u3002
// LLM \u3078\u306e\u69cb\u9020\u5316\u5171\u6709\u3092\u60f3\u5b9a \u2014 \u904e\u5ea6\u306a derived \u306f\u5165\u308c\u305a\u3001\u751f\u30c7\u30fc\u30bf\u306b\u8584\u3044 overlay \u3092\u88ab\u305b\u308b\u65b9\u91dd\u3002
export function buildEntitySnapshot(
  kind: 'polity' | 'house' | 'person' | 'province' | 'popGroup' | 'faction' | 'holding' | 'clan',
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
    id && ws?.polities[id] ? getPolityEmitNameKey(ws, id) : null
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
    // v0.42 §16.1: polity snapshot は influence breakdown を使う
    const topShareholders = ws
      ? getTopInfluenceHoldersInPolity(ws, defaultConfig, p.id, 5).map(
          ({ holder, percent, byDomain }) => ({
            holderKind: holder.kind,
            holderId: holder.id,
            holderName:
              holder.kind === 'house' ? houseNameKey(holder.id) : personNameKey(holder.id),
            percent: Math.round(percent * 10) / 10,
            byDomain,
          }),
        )
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
      ? getTopShareholders(ws, h.id, 5).map(({ holderPersonId, percent }) => ({
          holderKind: 'person' as const,
          holderId: holderPersonId,
          holderName: personNameKey(holderPersonId),
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
        isHouseless: ws ? isHouselessPerson(ws, pe.id) : false,
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
        const orgName = ws.polities[o.organization.id as PolityId]
          ? getPolityEmitNameKey(ws, o.organization.id as PolityId)
          : o.organization.id
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
      const isHouseless = !hid
      return {
        personId: pid,
        personName: p?.nameKey ?? null,
        houseId: hid ?? null,
        houseName: isHouseless ? null : houseNameKey(hid),
        isHouseless,
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
  if (kind === 'clan') {
    const c = entity as Clan
    const nameHouse = ws?.houses[c.nameSourceHouseId]
    const rootHouse = ws?.houses[c.rootHouseId]
    const activeHouseIds = ws ? getClanActiveHouseIds(ws, c.id) : []
    const extinctHouseIds = ws ? getClanExtinctHouseIds(ws, c.id) : []
    return {
      kind,
      meta,
      id: c.id,
      active: c.active,
      name: nameHouse?.nameKey ?? null,
      rootHouseId: c.rootHouseId,
      rootHouseName: rootHouse?.nameKey ?? null,
      nameSourceHouseId: c.nameSourceHouseId,
      founderPersonId: c.founderPersonId ?? null,
      founderName: c.founderPersonId ? personNameKey(c.founderPersonId) : null,
      createdWeek: c.createdWeek,
      memberHouseCount: c.memberHouseIds.length,
      activeHouseCount: activeHouseIds.length,
      extinctHouseCount: extinctHouseIds.length,
      livingMemberCount: ws ? getClanLivingMemberCount(ws, c.id) : 0,
      totalWealth: ws ? getClanTotalWealth(ws, c.id) : 0,
      totalPrestige: ws ? getClanTotalLegacyPrestige(ws, c.id) : 0,
    }
  }
  return { kind, meta, entity }
}

export function getDevelopmentLabel(d: number): string {
  if (d <= -50) return '荒廃'
  if (d <= -10) return '衰退'
  if (d < 10) return '通常'
  if (d < 50) return '発展'
  return '繁栄'
}

/** PersonCard / 構成員一覧で表示する「代表役職」(最上位 1 件 + 残数) を解決する。 */
export type RepresentativeOffice = {
  label: string
  extraCount: number
  isUnemployed: boolean
}

const ROSTER_ROLE_ORDER = ['leader', 'administrator', 'treasurer', 'military', 'advisor']

type ResolveNameFn = (category: string, nameKey: string | undefined, fallbackName: string) => string

export function getPersonRepresentativeOffice(
  state: WorldState,
  personId: PersonId,
  resolveName: ResolveNameFn,
  t: TFunction,
): RepresentativeOffice {
  const officeIds = state.officeIndex.byHolderPerson[personId as string] ?? []
  const offices = officeIds.flatMap((oid) => {
    const o = state.officeAssignments[oid]
    return o && o.active ? [o] : []
  })
  const bailiffIds = state.holdingOfficeIndex.byHolderPerson[personId] ?? []
  const bailiffs = bailiffIds.flatMap((aid) => {
    const a = state.holdingOfficeAssignments[aid]
    return a && a.active ? [a] : []
  })
  const byRole = (a: { role: string }, b: { role: string }) =>
    ROSTER_ROLE_ORDER.indexOf(a.role) - ROSTER_ROLE_ORDER.indexOf(b.role)
  const polityOffices = offices.filter((o) => o.organization.kind === 'polity').sort(byRole)
  const houseOffices = offices.filter((o) => o.organization.kind === 'house').sort(byRole)
  const total = offices.length + bailiffs.length

  if (polityOffices.length > 0) {
    const o = polityOffices[0]!
    const roleName = resolveName('role', `${o.organization.kind}_${o.role}`, o.role)
    const orgName = getPolityShortName(state, resolveName, o.organization.id as PolityId)
    return { label: `${roleName} (${orgName})`, extraCount: total - 1, isUnemployed: false }
  }
  if (houseOffices.length > 0) {
    const o = houseOffices[0]!
    const roleName = resolveName('role', `${o.organization.kind}_${o.role}`, o.role)
    const orgNameKey = state.houses[o.organization.id as HouseId]?.nameKey ?? o.organization.id
    const orgName = resolveName('house', orgNameKey, orgNameKey)
    return { label: `${roleName} (${orgName})`, extraCount: total - 1, isUnemployed: false }
  }
  if (bailiffs.length > 0) {
    const a = bailiffs[0]!
    const hld = state.holdings[a.holdingId]
    const provNameKey = hld
      ? (state.provinces[hld.provinceId]?.nameKey ?? a.holdingId)
      : a.holdingId
    const provName = resolveName('province', provNameKey, provNameKey)
    return {
      label: `${t('detail.person_card.bailiff')} (${provName})`,
      extraCount: total - 1,
      isUnemployed: false,
    }
  }
  return { label: t('detail.person_card.unemployed'), extraCount: 0, isUnemployed: true }
}
