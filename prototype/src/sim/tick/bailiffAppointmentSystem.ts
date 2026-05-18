import type { TickContext } from './context'
import { makeEventId } from './context'
import type { ProvinceId, PolityId, PersonId } from '../types/ids'
import type { SimEvent } from '../types/event'
import {
  getPolityTerminalProvinceIds,
  isPlaceholderPerson,
} from '../selectors/landContractSelectors'
import {
  vacateBailiff,
  appointBailiff,
  installPlaceholderBailiff,
} from '../mutations/provinceOfficeMutations'
import { defaultLandContractConfig } from '../config/landContractConfig'

// v0.16 §19: BailiffAppointmentSystem
// 各 terminal Polity ごとに ProvinceOfficeAssignment (bailiff) を走査:
//   - bailiff が placeholder で候補がいる → 通常人物を任命 (BAILIFF_APPOINTED)
//   - bailiff が死亡 or holder houseId が terminal owner と無関係 → vacate → placeholder install (BAILIFF_VACATED + BAILIFF_PLACEHOLDER_INSTALLED)
// 候補者選定: terminal Polity の ownerHouse member 優先 (active, adult, alive)。
// 起動頻度は config.bailiffAppointmentInterval (月単位)。
export function runBailiffAppointmentSystem(ctx: TickContext): TickContext {
  const interval = defaultLandContractConfig.bailiffAppointmentInterval
  const absMonth = ctx.state.currentYear * 12 + ctx.state.currentMonth
  if (absMonth % interval !== 0) return ctx

  let currentCtx = ctx

  for (const polityIdStr of Object.keys(currentCtx.state.polities).sort()) {
    const polityId = polityIdStr as PolityId
    const polity = currentCtx.state.polities[polityId]
    if (!polity || !polity.active) continue
    const ownerHouseId = polity.ownerHouseId
    if (!ownerHouseId) continue
    const ownerHouse = currentCtx.state.houses[ownerHouseId]
    if (!ownerHouse) continue

    const terminalProvinceIds = getPolityTerminalProvinceIds(currentCtx.state, polityId)

    // 1) 死亡 / 不正な bailiff を vacate → placeholder へ
    for (const provinceId of terminalProvinceIds) {
      const officeId = currentCtx.state.provinceOfficeIndex.byProvince[provinceId]
      if (!officeId) continue
      const office = currentCtx.state.provinceOfficeAssignments[officeId]
      if (!office) continue
      const holder = currentCtx.state.persons[office.holderPersonId]
      const isAlive = holder?.alive === true && holder.kind !== 'placeholder'
      if (!isAlive) continue
      // holder の houseId が ownerHouse の members に属していない場合は再任命対象
      if (ownerHouse.memberIds.some((m) => m === holder.id)) {
        continue
      }
      currentCtx = emitBailiffVacated(currentCtx, provinceId, office.holderPersonId)
      const beforeVacate = currentCtx.state
      const afterPlaceholder = installPlaceholderBailiff(beforeVacate, {
        provinceId,
        appointingPolityId: polityId,
        year: beforeVacate.currentYear,
        month: beforeVacate.currentMonth,
      })
      currentCtx = { ...currentCtx, state: afterPlaceholder }
      currentCtx = emitBailiffPlaceholderInstalled(currentCtx, provinceId, polityId)
    }

    // 2) placeholder bailiff を ownerHouse member に交代 (候補がいれば)
    const adultMembers = ownerHouse.memberIds
      .map((mid) => currentCtx.state.persons[mid])
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .filter(
        (p) =>
          p.alive && p.age >= defaultLandContractConfig.bailiffMinAge && p.kind !== 'placeholder',
      )

    if (adultMembers.length === 0) continue

    // 既に他オフィスを持っている Person を避ける
    const busyPersonIds = new Set<string>()
    for (const memberId of ownerHouse.memberIds) {
      const offices = currentCtx.state.officeIndex.byHolderPerson[memberId] ?? []
      for (const oid of offices) {
        const o = currentCtx.state.officeAssignments[oid]
        if (o && o.active) busyPersonIds.add(memberId)
      }
      // ProvinceOffice 持ちも忙しい
      const pOffices = currentCtx.state.provinceOfficeIndex.byHolderPerson[memberId] ?? []
      if (pOffices.length > 0) busyPersonIds.add(memberId)
    }

    const freeAdults = adultMembers.filter((p) => !busyPersonIds.has(p.id))
    if (freeAdults.length === 0) continue

    // stewardship 相当 (numeracy + insight) でスコアリング
    freeAdults.sort((a, b) => {
      const aScore = a.abilities.numeracy + a.abilities.insight
      const bScore = b.abilities.numeracy + b.abilities.insight
      if (bScore !== aScore) return bScore - aScore
      return a.id.localeCompare(b.id)
    })

    for (const provinceId of terminalProvinceIds) {
      if (freeAdults.length === 0) break
      const officeId = currentCtx.state.provinceOfficeIndex.byProvince[provinceId]
      if (!officeId) continue
      const office = currentCtx.state.provinceOfficeAssignments[officeId]
      if (!office) continue
      if (!isPlaceholderPerson(currentCtx.state, office.holderPersonId)) continue

      const candidate = freeAdults.shift()
      if (!candidate) break

      const vacatedState = vacateBailiff(currentCtx.state, provinceId)
      const { state: appointedState } = appointBailiff(vacatedState, {
        provinceId,
        holderPersonId: candidate.id,
        appointingPolityId: polityId,
        year: vacatedState.currentYear,
        month: vacatedState.currentMonth,
      })
      currentCtx = { ...currentCtx, state: appointedState }
      currentCtx = emitBailiffAppointed(currentCtx, provinceId, polityId, candidate.id)
    }
  }

  return currentCtx
}

function emitBailiffAppointed(
  ctx: TickContext,
  provinceId: ProvinceId,
  polityId: PolityId,
  holderPersonId: PersonId,
): TickContext {
  const { id: eventId, ctx: c1 } = makeEventId(ctx)
  const province = c1.state.provinces[provinceId]
  const person = c1.state.persons[holderPersonId]
  const provinceName = province?.name ?? provinceId
  const personName = person?.name ?? holderPersonId
  const event: SimEvent = {
    id: eventId,
    year: c1.state.currentYear,
    month: c1.state.currentMonth,
    type: 'BAILIFF_APPOINTED',
    importance: 'minor',
    actorIds: [holderPersonId],
    houseIds: person?.houseId ? [person.houseId] : [],
    polityIds: [polityId],
    provinceIds: [provinceId],
    summary: `${personName} was appointed bailiff of ${provinceName}.`,
    reasons: [],
    effects: [],
  }
  return { ...c1, events: [...c1.events, event] }
}

function emitBailiffVacated(
  ctx: TickContext,
  provinceId: ProvinceId,
  holderPersonId: PersonId,
): TickContext {
  const { id: eventId, ctx: c1 } = makeEventId(ctx)
  const province = c1.state.provinces[provinceId]
  const person = c1.state.persons[holderPersonId]
  const provinceName = province?.name ?? provinceId
  const personName = person?.name ?? holderPersonId
  const event: SimEvent = {
    id: eventId,
    year: c1.state.currentYear,
    month: c1.state.currentMonth,
    type: 'BAILIFF_VACATED',
    importance: 'minor',
    actorIds: [holderPersonId],
    houseIds: [],
    polityIds: [],
    provinceIds: [provinceId],
    summary: `${personName} stepped down as bailiff of ${provinceName}.`,
    reasons: [],
    effects: [],
  }
  return { ...c1, events: [...c1.events, event] }
}

function emitBailiffPlaceholderInstalled(
  ctx: TickContext,
  provinceId: ProvinceId,
  polityId: PolityId,
): TickContext {
  const { id: eventId, ctx: c1 } = makeEventId(ctx)
  const province = c1.state.provinces[provinceId]
  const provinceName = province?.name ?? provinceId
  const event: SimEvent = {
    id: eventId,
    year: c1.state.currentYear,
    month: c1.state.currentMonth,
    type: 'BAILIFF_PLACEHOLDER_INSTALLED',
    importance: 'minor',
    actorIds: [],
    houseIds: [],
    polityIds: [polityId],
    provinceIds: [provinceId],
    summary: `An anonymous placeholder oversees ${provinceName}.`,
    reasons: [],
    effects: [],
  }
  return { ...c1, events: [...c1.events, event] }
}
