// v0.54 資源経済: 資源種別。
// 第一段階では 3 種に限定する。v0.55 以降で資源・商品を細分化する。
export type ResourceKind = 'food' | 'raw_materials' | 'processed_goods'

// 全 ResourceKind を sorted key 順反復するための列挙 (determinism §13.1)。
// ResourceEconomySystem は market ごとに resource を跨いで集計するため、反復順を固定する。
export const RESOURCE_KINDS: readonly ResourceKind[] = ['food', 'processed_goods', 'raw_materials']
