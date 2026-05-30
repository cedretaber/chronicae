import type { RegimentId, PolityId, HoldingId, ProvinceId, WarId } from './ids'
import type { PoliticalActorRef } from './actor'
import type { WarSideKey } from './war'

// v0.36: persistent Regiment。これまで getActorMilitaryPower で抽象的に扱っていた軍事力を、
//   平時から state 上に存在する軍事動員単位 (1 Holding = 1 Regiment) として表現する。
//   (spec docs/drafts/spec-v036-update.md §3-6)

// §4.2 RegimentStatus
//   disbanded: owner/home 失効で解散。v0.36 では再利用しない。
//   destroyed: 戦闘損耗で壊滅。v0.36 では通常ほぼ発生しないが将来用に予約。
//   どちらの非 active record も records / regimentIndex.byOwner には残す
//   (§10.4 case(d) の「record 在り → 0 power, fallback しない」判定に必要)。
export type RegimentStatus = 'active' | 'disbanded' | 'destroyed'

// §4.3 RegimentSourceKind — 編制基盤の由来。mercenary は型予約のみ (v0.36 では生成しない)。
export type RegimentSourceKind = 'levy' | 'urban_militia' | 'noble_retinue' | 'mercenary'

// §4.4 RegimentTroopKind — 装備種ではなく戦場での役割分類。
//   infantry: 戦線を形成・維持。cavalry: 突破・追撃・機動 (騎士団・精鋭を含む抽象分類)。
export type RegimentTroopKind = 'infantry' | 'cavalry'

// §5 Regiment
export type Regiment = {
  id: RegimentId

  // §5.1 編制権を持つ主体。型は将来拡張用に PoliticalActorRef。
  //   v0.36 worldgen では owner.kind === 'polity' (homeHolding の terminal Polity) のみ生成。
  owner: PoliticalActorRef

  // §5.2 現在この Regiment を戦争動員している Polity。owner が Polity なら多くは owner.id と一致。
  mobilizedByPolityId?: PolityId

  status: RegimentStatus

  sourceKind: RegimentSourceKind
  troopKind: RegimentTroopKind

  // §5.3 由来 Holding / Province。v0.36 では原則すべて持つ。
  homeHoldingId?: HoldingId
  homeProvinceId?: ProvinceId

  // §5.4 動員先の soft reference。IntegrityCheck で hard invariant にしない (§18.4)。
  //   cleanup 済 War を指す場合があり、RegimentMaintenanceSystem (Phase B) が lazy detach する。
  currentWarId?: WarId
  currentSide?: WarSideKey

  // §5.5 兵員・装備・馬匹・従者の充足率 (0..100)。v0.36 では通常戦闘で大きく削らない。
  strength: number
  // §5.6 部隊としてまとまって行動できる度合い (0..100)。v0.36 では battle 後に主に削れる値。
  organization: number
  // §5.7 士気 (0..100)。v0.36 では write-once placeholder
  //   (worldgen 初期値を持ち、recovery が補正として読むだけ。低下も再書き込みもしない)。
  morale: number
  // §5.8 原則 100。将来 Regiment 規模差の表現に使う余地。
  maxStrength: number
  // §5.9 全快時の基礎戦闘力。worldgen 時点の calcPolityMilitaryPower / regiment 数で凍結 (§8.7)。
  basePower: number

  createdWeek: number
  lastMobilizedWeek?: number
}

// §6 regimentIndex (WorldState に保持)。
//   byOwner の key は既存 politicalActorKey(ref) を流用 ("polity:p-1" / "house:h-3")。
//   mutation は warMutations 規約 (add/remove mutating helper + 空配列 delete purge) に倣う。
//   disbanded / destroyed も byOwner / byHomeProvince / byHomeHolding には残す。byWar からは demobilize 時に外す。
export type RegimentIndex = {
  byOwner: Record<string, RegimentId[]>
  byWar: Record<WarId, RegimentId[]>
  byHomeProvince: Record<ProvinceId, RegimentId[]>
  byHomeHolding: Record<HoldingId, RegimentId[]>
}
