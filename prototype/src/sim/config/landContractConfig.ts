import type { PolityRank } from '../types/polity'

// v0.16 §16 / §18 / §19: LandContract / Bailiff / 余剰分配の config 値。
// プロトタイプ段階の暫定値。バランス調整は機能完成後 (Stage C 以降) にまとめて行う。
export type LandContractConfig = {
  // 余剰分配: treasury から OfficeCompensation 控除後の余剰を Share holder に分配する比率
  politySurplusDistributionRate: number
  // Polity treasury のリザーブ目標 (これを下回ると分配しない)
  polityTreasuryReserveTarget: number
  // BailiffAppointment 起動頻度 (月単位)。1 = 毎月、6 = 半年に 1 回
  bailiffAppointmentInterval: number
  // bailiff 候補者の最小年齢
  bailiffMinAge: number
  // 反乱 leader の年齢範囲
  rebelLeaderAgeRange: [number, number]
  // rank ≥ 4 Polity の institutionalPower 下限 (Rebel Polity 生成直後に消滅しないため)
  institutionalPowerFloorByRank: Record<PolityRank, number>
  // chain 上納 (LandRevenue) の徴税効率倍率
  taxFlowEfficiency: number
  // §18 LandContract purchase:
  // 買い手 Polity の treasury がこれを超えていれば購入提案を試みる
  purchaseBuyerTreasuryThreshold: number
  // 売り手 Polity の treasury がこれを下回っていれば売却を受け入れる
  purchaseSellerTreasuryThreshold: number
  // 1 Province の購入価格 = base + development × developmentFactor
  purchasePriceBase: number
  purchasePriceDevelopmentFactor: number
  // 各買い手 Polity が年次でひとつ提案を試みる確率
  purchaseAttemptChance: number
}

export const defaultLandContractConfig: LandContractConfig = {
  politySurplusDistributionRate: 0.15,
  polityTreasuryReserveTarget: 100,
  bailiffAppointmentInterval: 6,
  bailiffMinAge: 16,
  rebelLeaderAgeRange: [20, 50],
  institutionalPowerFloorByRank: {
    1: 0,
    2: 0,
    3: 10,
    4: 20,
    5: 30,
  },
  taxFlowEfficiency: 1.0,
  purchaseBuyerTreasuryThreshold: 1500,
  purchaseSellerTreasuryThreshold: 800,
  purchasePriceBase: 500,
  purchasePriceDevelopmentFactor: 30,
  // 年 1 月実行で買い手候補ごとに試行。15 Polity × 10% ≈ 1.5 件/年 (上限)
  purchaseAttemptChance: 0.1,
}
