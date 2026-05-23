// v0.17.1 §observation: Activity report types.
//
// Activity report は run 終了時に集計する観察用 JSON 出力で、4 つの観察軸を提供する:
//   1. Office 流動性 (Polity / House Office の任命・任期切れ・revoke の集計)
//   2. 派閥ライフサイクル (結成・解散・継承・リクルートの集計)
//   3. Bailiff 動態 (normal/placeholder の比率、出所内訳)
//   4. 人口・婚姻・出生 (将来のバランス調整に向けた予備調査)
//
// Snapshot は --report-snapshot <years> 指定時に N 年ごとに取る軽量スナップショット。
// state 全体を JSON dump する代わりに、観察に必要な要素だけを抜く。

export type OfficeChurnAggregate = {
  assignments: number
  revokes: number
  termEnds: number
}

export type PolityOfficeStats = {
  assignments: number
  uniqueHolders: number
}

export type PolityActivityReport = {
  polityId: string
  name: string
  rank: number
  active: boolean
  ownerHouseId: string | undefined
  // role (polity Office role) → 統計
  officesByRole: Record<string, PolityOfficeStats>
  // historical assignment 配分: holder の所属 House (event.houseIds[0]) を集計
  holderHouseDistribution: Record<string, number>
  // ownerHouse (現在の state での owner) への holder 帰属比率 (0..1)
  ownerHouseHoldRatio: number
}

export type HouseActivityReport = {
  houseId: string
  name: string
  active: boolean
  kind: 'normal' | 'system'
  officesByRole: Record<string, PolityOfficeStats>
}

export type FactionLifecycleReport = {
  factionId: string
  name: string
  active: boolean
  leaderPersonId: string
  leaderHouseId: string | undefined
  foundedYear: number
  dissolvedYear: number | undefined
  lifespanYears: number
  leaderChanges: number
  recruitments: number
  abandonments: number
  fundsShortages: number
  bankruptcies: number
  // 派閥所属の歴史的多様性 (recruitment イベントから集計した unique House 数)
  uniqueRecruitHouses: number
  // 終局点の active member 数 (active=true のときのみ意味あり)
  finalMemberCount: number
}

export type FactionAggregate = {
  totalFormed: number
  totalDissolved: number
  totalLeaderChanges: number
  totalRecruitments: number
  totalAbandonments: number
  totalFundsShortages: number
  totalBankruptcies: number
  // 結成された派閥の平均寿命 (active なら currentYear - foundedYear)
  avgLifespanYears: number
}

export type BailiffActivityReport = {
  finalNormalCount: number
  finalPlaceholderCount: number
  finalVacantCount: number
  totalAppointments: number
  totalVacated: number
  totalPlaceholderInstalled: number
  // assignment source 推定 (event.houseIds[0] vs 任命当時の polity.ownerHouseId — 簡易に
  // 現在 state の polity.ownerHouseId と比較する)
  appointmentBySource: {
    ownerHouse: number
    otherHouse: number
    unknown: number
  }
}

export type PopulationReport = {
  finalLivingNormal: number
  finalLivingPlaceholder: number
  finalDeadCount: number
  totalBirths: number
  totalDeaths: number
  totalMarriages: number
  totalFadedFromHistory: number
  totalBornInObscurity: number
  totalHouseExtinct: number
  totalHouseSplit: number
  totalHouseMembersDispersed: number
}

export type ActivitySnapshotPolity = {
  polityId: string
  name: string
  rank: number
  active: boolean
  ownerHouseId: string | undefined
  treasury: number
  provinceCount: number
  // role → holder の (personId, houseId) 一覧
  offices: Array<{
    role: string
    holderPersonId: string
    holderHouseId: string
  }>
}

export type ActivitySnapshotFaction = {
  factionId: string
  name: string
  leaderPersonId: string
  leaderHouseId: string | undefined
  memberCount: number
  // 派閥員の所属 House 分布
  memberHouseCounts: Record<string, number>
}

export type ActivitySnapshot = {
  year: number
  polities: ActivitySnapshotPolity[]
  factions: ActivitySnapshotFaction[]
  bailiffs: {
    normal: number
    placeholder: number
    vacant: number
  }
  populationLiving: number
  populationLivingNormal: number
}

export type ActivityReport = {
  meta: {
    seed: string
    years: number
    finalYear: number
    finalWeekOfYear: number
    // 主要パラメータの抜粋 (再現性のため)
    keyConfig: {
      factionBailiffNominationWeight: number
      factionNominationPowerThreshold: number
      polityOfficeMaxByRank: Record<number, Record<string, number>>
      targetLivingPersons: number
      targetUnaffiliatedPersons: number
      adultAge: number
    }
  }
  eventCounts: Record<string, number>
  office: {
    aggregateByRole: Record<string, OfficeChurnAggregate>
    polity: PolityActivityReport[]
    house: HouseActivityReport[]
  }
  faction: {
    aggregate: FactionAggregate
    factions: FactionLifecycleReport[]
  }
  bailiff: BailiffActivityReport
  population: PopulationReport
  snapshots?: ActivitySnapshot[]
}
