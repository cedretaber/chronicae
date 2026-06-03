// worldStructureMutations: house split / house extinction / commonwealth lifecycle の
// 3 ドメインを domain 別ファイルへ分割した (調査 §3.10)。本ファイルは従来の公開 API を
// 維持する re-export バレル。
export { splitHouse } from './worldStructureSplitHouse'
export { extinctHouse } from './worldStructureExtinction'
export type { HouseExtinctionInput } from './worldStructureExtinction'
export {
  selectOrCreateCommonwealthLeader,
  createNegotiatingCommonwealth,
  dissolveNegotiatingCommonwealth,
  establishCommonwealth,
  suppressRevolt,
} from './worldStructureCommonwealth'
export type {
  CreateNegotiatingCommonwealthInput,
  DissolveCommonwealthInput,
} from './worldStructureCommonwealth'
