import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { SimulationSession } from '@/sim/types/world'
import type { BattleLog, BattleTickLog } from '@sim/types/battleLog'
import type { WarSideKey } from '@sim/types/war'
import type { RegimentId, PersonId } from '@/sim/types/ids'
import type { ClickHandler } from './shared/helpers'
import { useEntityName } from '@/app/hooks/useEntityName'
import { getProvinceShortName } from '@/app/hooks/entityNameHelpers'
import { PersonLink, PolityLink, HouseLink } from './shared/links'
import { formatAbsoluteWeek } from '@/app/utils/format'

// 会戦再生パネル。恒久の BattleLog (Battle entity は war cleanup で消えるため後年はこちらが唯一の source)
//   を slot grid + tick スクラバで再生し、「どの連隊が・どの位置で・どの指揮官に率いられ・どう推移したか」を
//   後年も追えるようにする。War は終結で削除されるため worldState.wars には依存しない (総大将・連隊 owner で解決)。

type CellState = 'healthy' | 'routed' | 'destroyed' | 'retreated' | 'empty'
type Badge = { text: string; cls: string }
type Cell = {
  regimentId: RegimentId | null
  state: CellState
  badges: Badge[]
  commanderFeat?: boolean
}

const other = (s: WarSideKey): WarSideKey => (s === 'attacker' ? 'defender' : 'attacker')

export function BattleReplayPanel({
  log,
  session,
  onPersonClick,
  onPolityClick,
  onHouseClick,
}: {
  log: BattleLog
  session: SimulationSession | null
  onPersonClick: ClickHandler
  onPolityClick: ClickHandler
  onHouseClick: ClickHandler
}) {
  const { t } = useTranslation()
  const resolveName = useEntityName()
  const [tick, setTick] = useState(0)
  const worldState = session?.currentState ?? null
  if (!worldState) return null
  const { regiments, persons, provinces } = worldState

  // 現場指揮官 regimentId -> personId の早見表 (Phase A で BattleLog に恒久化済み)。
  const cmdByRegiment = new Map<string, PersonId>()
  for (const c of log.attackerCommanders ?? []) cmdByRegiment.set(c.regimentId, c.commanderPersonId)
  for (const c of log.defenderCommanders ?? []) cmdByRegiment.set(c.regimentId, c.commanderPersonId)

  const sideLabel = (s: WarSideKey): string =>
    s === 'attacker' ? t('detail.war.attacker') : t('detail.war.defender')
  const col = (i: number): string => t('detail.battle.column', { n: i + 1 })
  const battlefieldName = t(`enum.battlefieldKind.${log.battlefieldKind}`, { ns: 'events' })
  const provinceName = getProvinceShortName(worldState, resolveName, log.provinceId)
  const resultText = t(`enum.result.${log.result}`, { ns: 'events' })
  const outcomeText = log.outcomeQuality
    ? t(`enum.outcomeQuality.${log.outcomeQuality}`, { ns: 'events' })
    : null

  const importanceBg: Record<string, string> = {
    major: 'bg-amber-700',
    normal: 'bg-gray-600',
    minor: 'bg-gray-700',
  }

  const regLabel = (regId: RegimentId): string => {
    const r = regiments[regId]
    if (!r) return t('detail.battle.unknown_regiment')
    if (r.homeProvinceId && provinces[r.homeProvinceId]) {
      return getProvinceShortName(worldState, resolveName, r.homeProvinceId)
    }
    return r.homeHoldingId ?? regId
  }
  const troopIcon = (regId: RegimentId): string => {
    const r = regiments[regId]
    if (!r) return '?'
    return r.troopKind === 'cavalry'
      ? t('detail.battle.cavalry_icon')
      : t('detail.battle.infantry_icon')
  }
  const commanderOf = (regId: RegimentId): ReactNode => {
    const pid = cmdByRegiment.get(regId)
    if (!pid) return null
    return <PersonLink personId={pid} persons={persons} onClick={onPersonClick} />
  }

  // side の代表組織 (tick0 で最初に占有していた連隊の owner)。War 不在でも連隊から「どの勢力か」を示す。
  const sideOrg = (s: WarSideKey): ReactNode => {
    const tl0 = log.tickLogs[0]
    const slots = tl0 ? (s === 'attacker' ? tl0.attackerSlotsBefore : tl0.defenderSlotsBefore) : []
    for (const rid of slots) {
      if (!rid) continue
      const r = regiments[rid]
      if (!r) continue
      if (r.owner.kind === 'polity') {
        return <PolityLink polityId={r.owner.id} world={worldState} onClick={onPolityClick} />
      }
      if (r.owner.kind === 'house') {
        return <HouseLink houseId={r.owner.id} houses={worldState.houses} onClick={onHouseClick} />
      }
      // v0.61: 商会は連隊 owner にならない。
      return null
    }
    return null
  }

  // 1 tick・1 side の slot 列を構築。base=slotsBefore (tick0 は初期布陣) に this-tick イベントを重畳する。
  const buildCells = (s: WarSideKey, tl: BattleTickLog): Cell[] => {
    const base = s === 'attacker' ? tl.attackerSlotsBefore : tl.defenderSlotsBefore
    const cells: Cell[] = []
    for (let i = 0; i < log.effectiveFrontage; i++) {
      const occ = base[i] ?? null
      cells.push({ regimentId: occ, state: occ ? 'healthy' : 'empty', badges: [] })
    }
    const at = (i: number): Cell | undefined => (i >= 0 && i < cells.length ? cells[i] : undefined)
    for (const ev of tl.events) {
      switch (ev.kind) {
        case 'rout': {
          if (ev.side !== s) break
          const c = at(ev.slotIndex)
          if (!c) break
          c.state = 'routed'
          if (!c.regimentId) c.regimentId = ev.regimentId
          c.badges.push({
            text: t('detail.battle.badge.rout'),
            cls: 'bg-yellow-800 text-yellow-200',
          })
          break
        }
        case 'retreat': {
          if (ev.side !== s) break
          const c = at(ev.slotIndex)
          if (!c) break
          if (c.state === 'healthy' || c.state === 'empty') c.state = 'retreated'
          if (!c.regimentId) c.regimentId = ev.regimentId
          c.badges.push({
            text: t('detail.battle.badge.retreat'),
            cls: 'bg-gray-600 text-gray-200',
          })
          break
        }
        case 'regiment_destroyed': {
          if (ev.side !== s) break
          const c = at(ev.slotIndex)
          if (!c) break
          c.state = 'destroyed'
          if (!c.regimentId) c.regimentId = ev.regimentId
          c.badges.push({
            text: `${t('detail.battle.badge.destroyed')} (${t(`detail.battle.cause.${ev.cause}`)})`,
            cls: 'bg-red-800 text-red-100',
          })
          break
        }
        case 'fill_frontline': {
          if (ev.side !== s) break
          const c = at(ev.slotIndex)
          if (!c) break
          if (!c.regimentId) c.regimentId = ev.regimentId
          c.badges.push({ text: t('detail.battle.badge.fill'), cls: 'bg-sky-800 text-sky-200' })
          break
        }
        case 'breakthrough': {
          if (ev.side !== s) break
          const c = at(ev.slotIndex)
          if (!c) break
          c.badges.push({
            text: t('detail.battle.badge.breakthrough'),
            cls: 'bg-purple-800 text-purple-100',
          })
          break
        }
        case 'pursuit': {
          // target は pursuer の反対 side の targetSlotIndex。
          if (s !== other(ev.side)) break
          const c = at(ev.targetSlotIndex)
          if (!c) break
          if (ev.destroyed) {
            c.state = 'destroyed'
            if (!c.regimentId) c.regimentId = ev.targetRegimentId
          }
          // 壊滅は別途 regiment_destroyed イベントが badge を出すため、ここは「追撃」のみ (二重 badge 回避)。
          c.badges.push({
            text: t('detail.battle.badge.pursuit'),
            cls: 'bg-orange-800 text-orange-100',
          })
          break
        }
        case 'commander_feat': {
          if (ev.side !== s) break
          const c = at(ev.slotIndex)
          if (!c) break
          c.commanderFeat = true
          c.badges.push({
            text: `★ ${t('detail.battle.badge.feat')}`,
            cls: 'bg-amber-600 text-white',
          })
          break
        }
        case 'commander_failure': {
          if (ev.side !== s) break
          const c = at(ev.slotIndex)
          if (!c) break
          c.badges.push({
            text: `✗ ${t('detail.battle.badge.failure')}`,
            cls: 'bg-red-900 text-red-200',
          })
          break
        }
        case 'cavalry_charge': {
          // cavalry charge は side (= cavalry 側) のスロットでなく target slot に表示
          if (s !== other(ev.side)) break
          const c = at(ev.targetSlotIndex)
          if (!c) break
          c.badges.push({
            text: t('detail.battle.badge.cavalry_charge'),
            cls: ev.result === 'success' ? 'bg-purple-700 text-white' : 'bg-gray-700 text-gray-300',
          })
          break
        }
        case 'cavalry_pursuit': {
          if (s !== other(ev.side)) break
          const c = at(ev.targetSlotIndex)
          if (!c) break
          if (ev.destroyed) c.state = 'destroyed'
          c.badges.push({
            text: t('detail.battle.badge.cavalry_pursuit'),
            cls: 'bg-orange-700 text-orange-100',
          })
          break
        }
        case 'cavalry_screen': {
          if (ev.side !== s) break
          const c = at(ev.screenedSlotIndex)
          if (!c) break
          c.badges.push({
            text: t('detail.battle.badge.cavalry_screen'),
            cls: 'bg-teal-700 text-teal-100',
          })
          break
        }
        case 'morale_shift':
        case 'tactic':
          break
      }
    }
    // 敗走・戦列離脱は event 化されない (simulateBattle は breakthrough/pursuit/regiment_destroyed のみ emit) ため、
    //   slotsBefore に居て slotsAfter に居ない連隊を occupancy 差分から「戦列離脱 (敗走)」として導出する。
    //   これにより「戦列がどう痩せたか」を毎 tick 可視化できる (event 待ちにしない)。
    const after = s === 'attacker' ? tl.attackerSlotsAfter : tl.defenderSlotsAfter
    const survivors = new Set<string>()
    for (const rid of after) if (rid) survivors.add(rid)
    for (const c of cells) {
      if (!c.regimentId || c.state !== 'healthy') continue
      if (!survivors.has(c.regimentId)) {
        c.state = 'routed'
        c.badges.push({ text: t('detail.battle.badge.rout'), cls: 'bg-yellow-800 text-yellow-200' })
      }
    }
    return cells
  }

  const cellStateCls: Record<CellState, string> = {
    healthy: 'bg-gray-800 border-gray-600',
    routed: 'bg-gray-800 border-yellow-700 opacity-70',
    destroyed: 'bg-red-950 border-red-800 opacity-80',
    retreated: 'bg-gray-800 border-gray-600 opacity-60',
    empty: 'border-dashed border-gray-700 bg-transparent',
  }

  // 配置図は正方形 + 列番号のみ (戦列幅が広くても全体を俯瞰できる)。連隊の素性は下の連隊一覧表に出す。
  //   状態 (敗走/壊滅/離脱) は背景色、武功は ring。hover で連隊名を tooltip 表示。
  const renderSquares = (cells: Cell[]): ReactNode => (
    <div className="flex gap-1">
      {cells.map((c, i) => (
        <div
          key={i}
          title={c.regimentId ? regLabel(c.regimentId) : undefined}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border text-[11px] ${cellStateCls[c.state]} ${
            c.commanderFeat ? 'ring-1 ring-amber-400' : ''
          } ${c.regimentId ? 'text-gray-100' : 'text-gray-600'}`}
        >
          {i + 1}
        </div>
      ))}
    </div>
  )

  // 連隊一覧表: 配置図の列番号 → 連隊 (兵種・本拠地)・指揮官・状態。占有 slot のみ行に出す。
  const renderRoster = (s: WarSideKey, cells: Cell[]): ReactNode => {
    const rows = cells.flatMap((c, i) => (c.regimentId ? [{ i, rid: c.regimentId, c }] : []))
    if (rows.length === 0) return null
    return (
      <div className="mt-1">
        <div className="text-xs font-semibold text-gray-300">{sideLabel(s)}</div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="pr-2 font-normal">{t('detail.battle.header.column')}</th>
              <th className="pr-2 font-normal">{t('detail.battle.header.troop')}</th>
              <th className="pr-2 font-normal">{t('detail.battle.header.regiment')}</th>
              <th className="pr-2 font-normal">{t('detail.battle.header.commander')}</th>
              <th className="font-normal">{t('detail.battle.header.state')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ i, rid, c }) => (
              <tr key={i} className="align-top">
                <td className="pr-2 text-gray-400">{i + 1}</td>
                <td className="pr-2 text-gray-300">{troopIcon(rid)}</td>
                <td className="truncate pr-2 text-gray-200">{regLabel(rid)}</td>
                <td className="pr-2">
                  {commanderOf(rid) ?? <span className="text-gray-500">&mdash;</span>}
                </td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {c.badges.map((b, bi) => (
                      <span key={bi} className={`rounded px-1 ${b.cls}`}>
                        {b.text}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // this-tick イベントのテキスト列。tactic は別行で出すので除外。
  const renderEvents = (tl: BattleTickLog): ReactNode => {
    const lines: ReactNode[] = []
    tl.events.forEach((ev, idx) => {
      switch (ev.kind) {
        case 'rout':
          lines.push(
            <li key={idx}>
              {sideLabel(ev.side)} {col(ev.slotIndex)} {regLabel(ev.regimentId)}{' '}
              {t('detail.battle.badge.rout')}
            </li>,
          )
          break
        case 'retreat':
          lines.push(
            <li key={idx}>
              {sideLabel(ev.side)} {col(ev.slotIndex)} {regLabel(ev.regimentId)}{' '}
              {t('detail.battle.badge.retreat')}
            </li>,
          )
          break
        case 'regiment_destroyed':
          lines.push(
            <li key={idx} className="text-red-300">
              {sideLabel(ev.side)} {col(ev.slotIndex)} {regLabel(ev.regimentId)}{' '}
              {t('detail.battle.badge.destroyed')} ({t(`detail.battle.cause.${ev.cause}`)})
            </li>,
          )
          break
        case 'breakthrough':
          lines.push(
            <li key={idx} className="text-purple-300">
              {sideLabel(ev.side)} {col(ev.slotIndex)} {regLabel(ev.regimentId)}{' '}
              {t('detail.battle.event.breakthrough')}
            </li>,
          )
          break
        case 'pursuit':
          lines.push(
            <li key={idx} className="text-orange-300">
              {sideLabel(ev.side)} {t('detail.battle.badge.pursuit')} &rarr;{' '}
              {sideLabel(other(ev.side))} {col(ev.targetSlotIndex)} {regLabel(ev.targetRegimentId)}
              {ev.destroyed ? `・${t('detail.battle.badge.destroyed')}` : ''}
            </li>,
          )
          break
        case 'fill_frontline':
          lines.push(
            <li key={idx} className="text-sky-300">
              {sideLabel(ev.side)} {col(ev.slotIndex)} {regLabel(ev.regimentId)}{' '}
              {t('detail.battle.badge.fill')}
            </li>,
          )
          break
        case 'commander_feat':
          lines.push(
            <li key={idx} className="text-amber-300">
              ★ <PersonLink personId={ev.personId} persons={persons} onClick={onPersonClick} /> (
              {sideLabel(ev.side)}) {t('detail.battle.event.feat')}:{' '}
              {t(`detail.battle.feat.${ev.feat}`)}
            </li>,
          )
          break
        case 'commander_failure':
          lines.push(
            <li key={idx} className="text-red-300">
              ✗ <PersonLink personId={ev.personId} persons={persons} onClick={onPersonClick} /> (
              {sideLabel(ev.side)}) {t('detail.battle.event.failure')}:{' '}
              {t(`detail.battle.failure.${ev.failure}`)}
            </li>,
          )
          break
        case 'cavalry_charge':
          lines.push(
            <li key={idx} className={ev.result === 'success' ? 'text-purple-300' : 'text-gray-400'}>
              {sideLabel(ev.side)} {t('detail.battle.event.cavalry_charge')} &rarr;{' '}
              {sideLabel(other(ev.side))} {col(ev.targetSlotIndex)} {regLabel(ev.targetRegimentId)}
              {ev.result === 'success'
                ? ` (${t('detail.battle.badge.breakthrough')})`
                : ` (${t('detail.battle.badge.failure')})`}
            </li>,
          )
          break
        case 'cavalry_pursuit':
          lines.push(
            <li key={idx} className="text-orange-300">
              {sideLabel(ev.side)} {t('detail.battle.event.cavalry_pursuit')} &rarr;{' '}
              {sideLabel(other(ev.side))} {col(ev.targetSlotIndex)} {regLabel(ev.targetRegimentId)}
              {ev.destroyed ? `・${t('detail.battle.badge.destroyed')}` : ''}
            </li>,
          )
          break
        case 'cavalry_screen':
          lines.push(
            <li key={idx} className="text-teal-300">
              {sideLabel(ev.side)} {t('detail.battle.event.cavalry_screen')} &rarr;{' '}
              {col(ev.screenedSlotIndex)} {regLabel(ev.screenedRegimentId)}
            </li>,
          )
          break
        case 'morale_shift':
          lines.push(
            <li key={idx} className="text-blue-300">
              {sideLabel(ev.side)} {t('detail.battle.event.morale_shift')}: +
              {ev.rallyTotal.toFixed(0)} / -{ev.shockTotal.toFixed(0)}
            </li>,
          )
          break
        case 'tactic':
          break
      }
    })
    return lines
  }

  const renderCaptainGeneral = (pid: PersonId | undefined): ReactNode =>
    pid ? (
      <PersonLink personId={pid} persons={persons} onClick={onPersonClick} />
    ) : (
      <span className="text-gray-500">&mdash;</span>
    )

  const nTicks = log.tickLogs.length
  const curTick = Math.min(tick, Math.max(0, nTicks - 1))
  const tl = log.tickLogs[curTick]
  const attackerCells = tl ? buildCells('attacker', tl) : []
  const defenderCells = tl ? buildCells('defender', tl) : []

  return (
    <div className="flex flex-col gap-1 p-3 text-sm">
      {/* ヘッダ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-bold text-gray-100">
          {provinceName} &middot; {battlefieldName}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs text-white ${importanceBg[log.importance]}`}
        >
          {t(`detail.battle.importance.${log.importance}`)}
        </span>
        <span className="text-xs text-gray-400">{formatAbsoluteWeek(log.week)}</span>
      </div>

      <div className="text-xs text-gray-300">
        {resultText}
        {outcomeText ? ` ・ ${outcomeText}` : ''}
      </div>

      {/* 両軍の総大将・代表勢力 */}
      <div className="mt-1 grid grid-cols-2 gap-2">
        {(['attacker', 'defender'] as const).map((s) => (
          <div key={s} className="rounded bg-gray-800 px-2 py-1 text-xs">
            <div className="font-semibold text-gray-300">{sideLabel(s)}</div>
            <div className="flex justify-between gap-1">
              <span className="shrink-0 text-gray-500">{t('detail.battle.realm')}:</span>
              <span className="truncate text-right">
                {sideOrg(s) ?? <span className="text-gray-500">&mdash;</span>}
              </span>
            </div>
            <div className="flex justify-between gap-1">
              <span className="shrink-0 text-gray-500">{t('detail.war.captain_general')}:</span>
              <span className="truncate text-right">
                {renderCaptainGeneral(
                  s === 'attacker'
                    ? log.attackerCaptainGeneralPersonId
                    : log.defenderCaptainGeneralPersonId,
                )}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 戦場幅 */}
      <div className="text-xs text-gray-400">
        {t('detail.battle.frontage')}: {log.baseFrontage}
        {log.effectiveFrontage < log.baseFrontage ? (
          <>
            {' '}
            &rarr; {log.effectiveFrontage}{' '}
            <span className="text-amber-400">({t('detail.battle.caught')})</span>
          </>
        ) : null}
      </div>

      {nTicks === 0 || !tl ? (
        <div className="mt-2 rounded bg-gray-800 px-2 py-2 text-xs text-gray-300">
          {t('detail.battle.no_resistance')}
        </div>
      ) : (
        <>
          {/* 戦場 (slot grid): 正方形 + 列番号。幅が広い会戦は横スクロール。攻防は同じ列で整列。 */}
          <div className="mt-2 rounded bg-gray-900/60 p-2">
            <div className="overflow-x-auto">
              <div className="flex flex-col gap-1">
                <div className="text-[10px] text-gray-500">{sideLabel('attacker')}</div>
                {renderSquares(attackerCells)}
                <div className="my-0.5 border-t border-dashed border-gray-700" />
                {renderSquares(defenderCells)}
                <div className="text-right text-[10px] text-gray-500">{sideLabel('defender')}</div>
              </div>
            </div>
          </div>

          {/* 連隊一覧 (列番号 → 連隊詳細) */}
          <div className="mt-2">
            <div className="text-xs text-gray-400">{t('detail.battle.roster')}:</div>
            {renderRoster('attacker', attackerCells)}
            {renderRoster('defender', defenderCells)}
          </div>

          {/* tick スクラバ */}
          <div className="mt-1 flex items-center justify-center gap-3">
            <button
              className="rounded bg-gray-700 px-2 py-0.5 text-gray-200 disabled:opacity-40"
              onClick={() => setTick(Math.max(0, curTick - 1))}
              disabled={curTick <= 0}
            >
              ◀
            </button>
            <span className="text-xs text-gray-300">
              {t('detail.battle.tick')} {curTick + 1} / {nTicks}
            </span>
            <button
              className="rounded bg-gray-700 px-2 py-0.5 text-gray-200 disabled:opacity-40"
              onClick={() => setTick(Math.min(nTicks - 1, curTick + 1))}
              disabled={curTick >= nTicks - 1}
            >
              ▶
            </button>
          </div>

          {/* 戦術 */}
          <div className="text-xs text-gray-300">
            {t('detail.battle.tactic_label')}: {sideLabel('attacker')}=
            {t(`detail.battle.tactic.${tl.attackerTactic}`)} vs {sideLabel('defender')}=
            {t(`detail.battle.tactic.${tl.defenderTactic}`)}
            {tl.tacticAdvantageSide ? (
              <span className="ml-1 text-amber-300">
                &rarr; {sideLabel(tl.tacticAdvantageSide)} {t('detail.battle.advantage')}
              </span>
            ) : null}
          </div>

          {/* この tick の出来事 */}
          <div className="text-xs">
            <div className="text-gray-400">{t('detail.battle.events_this_tick')}:</div>
            {tl.events.some((e) => e.kind !== 'tactic') ? (
              <ul className="ml-3 list-disc text-gray-300">{renderEvents(tl)}</ul>
            ) : (
              <div className="ml-3 text-gray-600">&mdash;</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
