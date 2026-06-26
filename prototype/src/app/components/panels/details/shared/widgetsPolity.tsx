import { useTranslation } from 'react-i18next'
import type { ClickHandler } from './helpers'
import type { Person } from '@/sim/types/person'
import { PersonLink, HouseLink } from './links'
import type { House } from '@/sim/types/house'
import type { AttitudeMap } from '@/sim/types/attitude'
import type { WorldState } from '@/sim/types/world'
import { useEntityName } from '@/app/hooks/useEntityName'
import {
  getPolityShortName,
  getHoldingShortName,
  getHouseDisplayName,
} from '@/app/hooks/entityNameHelpers'
import type {
  PolityId,
  HouseId,
  PersonId,
  LandContractId,
  HoldingId,
  ProvinceId,
} from '@/sim/types/ids'
import type { Polity } from '@/sim/types/polity'
import { getHoldingLandContractChain } from '@sim/selectors/landContractSelectors'
import {
  getActiveDefaultForContract,
  getActiveDefaultsForClaimantPolity,
  getDefaultPrescriptionRemainingYears,
} from '@sim/selectors/landContractDefaultSelectors'
import type { LandContractDefault } from '@sim/types/landContractDefault'
import {
  getActivePressuresForPolity,
  getActiveCrisesForPolity,
} from '@sim/selectors/polityThreatSelectors'
import { getProvincePolityControlFromHoldings } from '@/sim/selectors/landContractSelectors'
import { EntityRefLink } from './ProjectCard'
import { useSimulationStore } from '@/app/stores/simulationStore'
import { formatAbsoluteWeek } from '@/app/utils/format'
import { getProvinceMonthlyResourceRevenue } from '@sim/selectors/resourceRevenueSelectors'
import { defaultConfig } from '@sim/config/defaultConfig'
import { WEEKS_PER_YEAR } from '@sim/utils/timeUtils'
import { getRegimentsForActor } from '@sim/selectors/regimentSelectors'
import { getRegimentHoldingId } from '@sim/mutations/regimentMutations'
import {
  getHoldingOfficeAppointmentRight,
  getRegimentControllerRight,
} from '@sim/selectors/politicalRightSelectors'
import { getHoldingBailiffPerson } from '@sim/selectors/provinceOfficeSelectors'
import type { PoliticalRight, PoliticalRightHolderRef } from '@sim/types/politicalRight'
import type { PolityInfluenceHolderRef } from '@sim/types/influence'
import type { RepublicPowerProfile } from '@sim/selectors/republicSelectors'
import { RightHolderLine } from './widgetsRights'
import { DetailSection } from './widgetsLayout'

export function AttitudeList({
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
          const displayName = p ? getPolityShortName(worldState, resolveName, id as PolityId) : id
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
          const displayName = getHouseDisplayName(resolveName, h, id)
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

export function PolityLandContracts({
  polity,
  worldState,
  persons,
  houses,
  onProvinceClick,
  onPersonClick,
  onHouseClick,
}: {
  polity: Polity
  worldState: WorldState | null
  persons: Record<string, Person>
  houses: Record<string, House>
  onProvinceClick: (id: string) => void
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
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
    bailiffPersonId: PersonId | undefined
    appointmentRight: PoliticalRight | undefined
    // v0.53: この契約 (この Polity が grantee) 自身が上納拒否されている = この Polity が「拒否している側」(加害)。
    withholdingDefault: LandContractDefault | undefined
    // v0.53: この Polity が claimant の default (= 下位がこの Polity への上納を拒否) = 「拒否されている側」(被害)。
    //   default は子契約上にあるため byClaimantPolity で引き holdingId でこのカードに紐付ける。
    beingWithheldDefaults: LandContractDefault[]
  }
  type ProvinceGroup = {
    provinceId: ProvinceId
    provinceName: string
    holdings: ContractInfo[]
    totalRevenue: number
  }

  // 被害側 (この Polity が claimant) の default を holdingId で索引し、該当契約カードへ紐付ける。
  const beingWithheldByHolding = new Map<string, LandContractDefault[]>()
  for (const d of getActiveDefaultsForClaimantPolity(worldState, polity.id)) {
    const k = d.holdingId as string
    const arr = beingWithheldByHolding.get(k) ?? []
    arr.push(d)
    beingWithheldByHolding.set(k, arr)
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
          getProvinceMonthlyResourceRevenue(worldState, defaultConfig, c.provinceId) *
          (polityControl / 100)
        let remaining = grossTax
        for (let i = chain.length - 1; i >= 0; i--) {
          const seg = chain[i]
          if (!seg) continue
          const rate = seg.terms.taxRateToGrantor
          const retained = remaining * (1 - rate)
          if (i === idx) {
            estimatedRevenue = Math.round(retained * WEEKS_PER_YEAR * 10) / 10
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
    // 代官・任命権はこの Polity が terminal (実効支配) の Holding でのみ意味を持つ
    // (非 terminal 行の代官は下位 Polity に仕えるため表示しない)。
    const bailiff =
      isTerminal && holdingId ? getHoldingBailiffPerson(worldState, holdingId) : undefined
    group.holdings.push({
      id: c.id,
      holdingId,
      // Province 見出しの下に並ぶため短名で十分 (qualified 名は冗長)
      holdingName: holding ? getHoldingShortName(worldState, resolveName, holding.id) : '(unknown)',
      taxRate: c.terms.taxRateToGrantor,
      isRoot,
      isTerminal,
      estimatedRevenue,
      bailiffPersonId: bailiff && bailiff.kind !== 'placeholder' ? bailiff.id : undefined,
      appointmentRight:
        isTerminal && holdingId
          ? getHoldingOfficeAppointmentRight(worldState, holdingId)
          : undefined,
      // v0.53: 加害 = この契約自身が上納拒否されている (この Polity が grantee = 占拠側)。
      withholdingDefault: getActiveDefaultForContract(worldState, c.id),
      // v0.53: 被害 = この Polity が claimant の default を holdingId で紐付け。
      beingWithheldDefaults: holdingId ? (beingWithheldByHolding.get(holdingId) ?? []) : [],
    })
    group.totalRevenue += estimatedRevenue
  }

  const groups = [...groupMap.values()].sort((a, b) => b.totalRevenue - a.totalRevenue)
  const totalContracts = groups.reduce((sum, g) => sum + g.holdings.length, 0)

  return (
    <div>
      <DetailSection title={t('detail.polity.land_contracts')} count={totalContracts} />
      <div className="pl-2 text-xs text-gray-500">{t('detail.polity.land_contracts_note')}</div>
      <div className="mt-1 max-h-64 overflow-y-auto text-sm">
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
            <div className="grid grid-cols-2 gap-1">
              {g.holdings.map((c) => (
                <div key={c.id} className="rounded bg-gray-700/60 p-1.5 text-xs">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="min-w-0 truncate font-medium text-gray-300">
                      {c.holdingName}
                    </span>
                    <span className="shrink-0 text-[10px] text-gray-500">
                      {c.isRoot && c.isTerminal
                        ? `${t('detail.province.root')}+${t('detail.province.term')}`
                        : c.isRoot
                          ? t('detail.province.root')
                          : c.isTerminal
                            ? t('detail.province.term')
                            : ''}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>{Math.round(c.taxRate * 100)}%</span>
                    <span className="text-amber-300">
                      {c.estimatedRevenue > 0 ? c.estimatedRevenue.toFixed(1) : '—'}
                    </span>
                  </div>
                  {/* v0.53 加害: この Polity がこの契約の上納を拒否している (能動) — 橙 */}
                  {c.withholdingDefault && (
                    <div className="mt-0.5 rounded bg-amber-950/40 px-1 text-[10px] text-amber-300">
                      ⚠{' '}
                      {c.withholdingDefault.origin === 'revolt_independence'
                        ? t('detail.obligation.default_revolt', { defaultValue: '反乱占拠' })
                        : t('detail.obligation.withholding', { defaultValue: '上納拒否中' })}{' '}
                      · {t('detail.obligation.default_claimant', { defaultValue: '請求元' })}:{' '}
                      {getPolityShortName(
                        worldState,
                        resolveName,
                        c.withholdingDefault.claimantPolityId,
                      )}{' '}
                      ·{' '}
                      {t('detail.obligation.prescription_remaining', {
                        defaultValue: '時効まで残り {{years}} 年',
                        years: Math.floor(
                          getDefaultPrescriptionRemainingYears(
                            worldState,
                            defaultConfig,
                            c.withholdingDefault,
                          ),
                        ),
                      })}
                    </div>
                  )}
                  {/* v0.53 被害: 下位がこの Polity への上納を拒否している (受動) — 赤 */}
                  {c.beingWithheldDefaults.map((d) => (
                    <div
                      key={d.id}
                      className="mt-0.5 rounded bg-red-950/50 px-1 text-[10px] text-red-300"
                    >
                      ⚠{' '}
                      {d.origin === 'revolt_independence'
                        ? t('detail.obligation.default_revolt', { defaultValue: '反乱占拠' })
                        : t('detail.obligation.being_withheld', {
                            defaultValue: '上納を拒否されている',
                          })}{' '}
                      · {t('detail.obligation.default_occupier', { defaultValue: '占拠者' })}:{' '}
                      {getPolityShortName(worldState, resolveName, d.occupiedByPolityId)} ·{' '}
                      {t('detail.obligation.prescription_remaining', {
                        defaultValue: '時効まで残り {{years}} 年',
                        years: Math.floor(
                          getDefaultPrescriptionRemainingYears(worldState, defaultConfig, d),
                        ),
                      })}
                    </div>
                  ))}
                  {c.bailiffPersonId !== undefined && (
                    <div className="mt-0.5 truncate text-[11px] text-gray-500">
                      {t('holding.bailiff', { ns: 'roles' })}:{' '}
                      <PersonLink
                        personId={c.bailiffPersonId}
                        persons={persons}
                        onClick={onPersonClick}
                      />
                    </div>
                  )}
                  <RightHolderLine
                    right={c.appointmentRight}
                    label={t('detail.polity.appointment_right')}
                    persons={persons}
                    houses={houses}
                    onPersonClick={onPersonClick}
                    onHouseClick={onHouseClick}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// v0.53: この Polity が直面している外圧 (Pressure, target=polity) と領内 (実効支配 holding) の危機 (Crisis)。
//   観賞用スナップショット。active のみ表示。どちらも無ければ何も描画しない。
export function PolityThreats({
  polity,
  worldState,
}: {
  polity: Polity
  worldState: WorldState | null
}) {
  const { t } = useTranslation()
  const onNavigate = useSimulationStore((s) => s.openDetailWindow)
  if (!worldState) return null
  const pressures = getActivePressuresForPolity(worldState, polity.id)
  const crises = getActiveCrisesForPolity(worldState, polity.id)
  if (pressures.length === 0 && crises.length === 0) return null
  return (
    <div>
      {pressures.length > 0 && (
        <>
          <DetailSection title={t('detail.pressure.section_title')} count={pressures.length} />
          <div className="mt-1 flex flex-col gap-0.5 text-xs">
            {pressures.map((p) => (
              <div key={p.id} className="rounded bg-amber-950/30 px-1.5 py-1">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="font-medium text-amber-200">
                    {t(`detail.project.pressure_kind.${p.kind}`, { defaultValue: p.kind })}
                  </span>
                  <span
                    className={p.responseProjectId !== undefined ? 'text-gray-400' : 'text-red-300'}
                  >
                    {p.responseProjectId !== undefined
                      ? t('detail.pressure.responding')
                      : t('detail.pressure.unanswered')}
                  </span>
                </div>
                <div className="flex justify-between gap-1 text-gray-400">
                  <span className="shrink-0">{t('detail.pressure.source')}:</span>
                  <EntityRefLink
                    entityRef={p.source}
                    worldState={worldState}
                    onNavigate={onNavigate}
                  />
                </div>
                {p.deadlineWeek !== undefined && (
                  <div className="flex justify-between text-gray-400">
                    <span>{t('detail.pressure.deadline')}:</span>
                    <span>{formatAbsoluteWeek(p.deadlineWeek)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {crises.length > 0 && (
        <>
          <DetailSection
            title={t('detail.crisis.section_title')}
            count={crises.length}
            tone="alert"
          />
          <div className="mt-1 flex flex-col gap-0.5 text-xs">
            {crises.map((c) => (
              <div key={c.id} className="rounded bg-red-950/30 px-1.5 py-1">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="font-medium text-red-200">
                    {t(`detail.crisis.kind.${c.kind}`, { defaultValue: c.kind })}
                  </span>
                  <span className="text-gray-400">
                    {t('detail.crisis.severity')}: {c.severity.toFixed(0)}
                  </span>
                </div>
                <div className="flex justify-between gap-1 text-gray-400">
                  <EntityRefLink
                    entityRef={{ kind: 'holding', id: c.holdingId }}
                    worldState={worldState}
                    onNavigate={onNavigate}
                  />
                  {c.kind !== 'disrepair' && (
                    <span className="shrink-0">{formatAbsoluteWeek(c.deadlineWeek)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// v0.36 Regiment: Polity が保有する連隊一覧。観賞用スナップショットなので active のみ表示
//   (destroyed は再編成待ちの過渡状態・strength≈0、disbanded は恒久解散)。連隊詳細パネルは未実装。
// v0.42: カード化し、regiment_control right の保持者 (管理権) をカード内に表示。
export function PolityRegiments({
  polity,
  worldState,
  persons,
  houses,
  onPersonClick,
  onHouseClick,
}: {
  polity: Polity
  worldState: WorldState | null
  persons: Record<string, Person>
  houses: Record<string, House>
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  if (!worldState) return null
  const regiments = getRegimentsForActor(worldState, { kind: 'polity', id: polity.id }).filter(
    (r) => r.status === 'active',
  )
  if (regiments.length === 0) return null

  const rows = regiments
    .map((r) => {
      const holdingId = getRegimentHoldingId(worldState, r)
      const holding = holdingId !== undefined ? worldState.holdings[holdingId] : undefined
      const province = holding !== undefined ? worldState.provinces[holding.provinceId] : undefined
      const provinceName = province
        ? resolveName('province', province.nameKey, province.nameKey)
        : undefined
      const regName = provinceName
        ? `${provinceName} ${t('detail.polity.regiment_suffix')}`
        : r.troopKind === 'cavalry'
          ? t('detail.polity.cavalry_regiment')
          : String(r.id)
      return {
        id: r.id,
        name: regName,
        organization: Math.round(r.organization),
        baselineOrganization: Math.round(r.baselineOrganization),
        morale: Math.round(r.morale),
        baselineMorale: Math.round(r.baselineMorale),
        strength: Math.round(r.strength),
        controlRight: getRegimentControllerRight(worldState, r.id),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div>
      <DetailSection title={t('detail.polity.regiments')} count={rows.length} />
      <div className="pl-2 text-xs text-gray-500">{t('detail.polity.reg_baseline_hint')}</div>
      <div className="mt-1 grid max-h-64 grid-cols-2 gap-1 overflow-y-auto text-xs">
        {rows.map((r) => (
          <div key={r.id} className="rounded bg-gray-700/60 p-1.5">
            <div className="truncate font-medium text-gray-300">{r.name}</div>
            <div className="flex justify-between text-gray-400">
              <span>{t('detail.polity.reg_organization')}:</span>
              <span className="text-gray-300">
                {r.organization}
                <span className="text-gray-500">/{r.baselineOrganization}</span>%
              </span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>{t('detail.polity.reg_morale')}:</span>
              <span className="text-gray-300">
                {r.morale}
                <span className="text-gray-500">/{r.baselineMorale}</span>
              </span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>{t('detail.polity.reg_strength')}:</span>
              <span className="text-gray-300">{r.strength}%</span>
            </div>
            <RightHolderLine
              right={r.controlRight}
              label={t('detail.polity.control_right')}
              persons={persons}
              houses={houses}
              onPersonClick={onPersonClick}
              onHouseClick={onHouseClick}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// v0.46 §8: established commonwealth (共和国) の権力分布表示。getRepublicPowerProfile が
// 算出する read-model を UI に表示するのみ (event は出さない・§7.1)。topPercent が
// republicDominantHolderThreshold 以上の holder を「支配的」と視覚強調する。
function HolderLink({
  holder,
  persons,
  houses,
  onPersonClick,
  onHouseClick,
}: {
  holder: PolityInfluenceHolderRef | PoliticalRightHolderRef
  persons: Record<string, Person>
  houses: Record<string, House>
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  return holder.kind === 'house' ? (
    <HouseLink houseId={holder.id} houses={houses} onClick={onHouseClick} />
  ) : (
    <PersonLink personId={holder.id} persons={persons} onClick={onPersonClick} />
  )
}

export function RepublicPowerProfileSection({
  profile,
  dominantThreshold,
  persons,
  houses,
  onPersonClick,
  onHouseClick,
}: {
  profile: RepublicPowerProfile
  dominantThreshold: number
  persons: Record<string, Person>
  houses: Record<string, House>
  onPersonClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const { t } = useTranslation('ui')
  const isDominant = profile.topHolder !== undefined && profile.topPercent >= dominantThreshold
  return (
    <div className="mt-1 rounded border border-gray-700 p-2">
      <div className="mb-1 text-sm font-semibold text-gray-300">
        {t('detail.polity.republic.title')}
      </div>
      <div className="text-[11px] text-gray-400">
        <div className="flex items-center gap-1">
          <span>{t('detail.polity.republic.top_holder')}:</span>
          {profile.topHolder ? (
            <>
              <HolderLink
                holder={profile.topHolder.holder}
                persons={persons}
                houses={houses}
                onPersonClick={onPersonClick}
                onHouseClick={onHouseClick}
              />
              <span className={isDominant ? 'font-semibold text-amber-400' : ''}>
                {profile.topPercent.toFixed(0)}%
              </span>
              {isDominant && (
                <span className="rounded bg-amber-900 px-1 text-[10px] text-amber-300">
                  {t('detail.polity.republic.dominant_badge')}
                </span>
              )}
            </>
          ) : (
            <span>—</span>
          )}
        </div>
        <div>
          {t('detail.polity.republic.top3')}: {profile.top3Percent.toFixed(0)}%
        </div>
        <div>
          {t('detail.polity.republic.effective_holders')}: {profile.effectiveHolderCount.toFixed(1)}
        </div>
        <div>
          {t('detail.polity.republic.leader_influence')}:{' '}
          {profile.leaderInfluencePercent.toFixed(0)}%
        </div>
      </div>

      {profile.officeControlByHolder.length > 0 && (
        <div className="mt-1">
          <div className="text-[11px] font-semibold text-gray-400">
            {t('detail.polity.republic.office_control')}:
          </div>
          {profile.officeControlByHolder.map((o) => (
            <div
              key={`oc-${o.holder.kind}-${o.holder.id}`}
              className="flex items-center gap-1 text-[11px] text-gray-500"
            >
              <HolderLink
                holder={o.holder}
                persons={persons}
                houses={houses}
                onPersonClick={onPersonClick}
                onHouseClick={onHouseClick}
              />
              <span>
                {o.officeCount} {t('detail.polity.republic.offices_suffix')}
              </span>
            </div>
          ))}
        </div>
      )}

      {profile.rightControlByHolder.length > 0 && (
        <div className="mt-1">
          <div className="text-[11px] font-semibold text-gray-400">
            {t('detail.polity.republic.right_control')}:
          </div>
          {profile.rightControlByHolder.map((r) => (
            <div
              key={`rc-${r.holder.kind}-${r.holder.id}`}
              className="flex items-center gap-1 text-[11px] text-gray-500"
            >
              <HolderLink
                holder={r.holder}
                persons={persons}
                houses={houses}
                onPersonClick={onPersonClick}
                onHouseClick={onHouseClick}
              />
              <span>
                {r.rightCount} {t('detail.polity.republic.rights_suffix')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
