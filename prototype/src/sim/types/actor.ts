import type { PolityId, HouseId } from './ids'

// v0.18 Stage A §6.1
// PoliticalActorRef: 外交・戦争・叛乱の主体を表す共通参照。
// v0.18 では型として polity と house を両方サポートするが、実動の Intent 生成・
// DiplomaticPlay initiator として有効なのは polity のみ。house actor は selector の
// 対応だけ用意し、IntentGenerationSystem から生成は行わない (spec §8.7)。
export type PoliticalActorRef = { kind: 'polity'; id: PolityId } | { kind: 'house'; id: HouseId }
