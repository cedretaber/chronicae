import type { PopType } from '../types/popGroup'

// v0.58: 賃金按分の役割重み。施設の netRevenue から carve した wageShare を雇用 PopType へ
//   contribShare × roleWeight 正規化比で配分する (山分け・均等ではない)。
//   役割は v0.57 の生産役割タクソノミーに準拠: 親方/自作農 = skilled (高給)、書記 = throughput (薄給)、
//   それ以外 = primary (基準)。非生産系 (兵士・貴族等) も primary 重みで按分に参加する
//   (Phase 1 の目的は carve の ripple 検証なので「全雇用 PopType に賃金が行き渡る」ことを優先)。
export type WageRole = 'primary' | 'skilled' | 'throughput'

export const WAGE_ROLE_BY_POP_TYPE: Record<PopType, WageRole> = {
  laborers: 'primary',
  peasants: 'primary',
  artisans: 'primary',
  scribes: 'throughput',
  soldiers: 'primary',
  freeholders: 'skilled',
  masters: 'skilled',
  merchants: 'primary',
  bureaucrats: 'primary',
  ministeriales: 'primary',
  nobles: 'primary',
  patricians: 'primary',
}
