export type NameKey = string

export type NameCultureId = string

export type NamePoolData = {
  [category: string]: {
    [culture: string]: {
      [subcategory: string]: NameKey[]
    }
  }
}

export type PickNameKeyOptions = {
  nameCultureId: NameCultureId
  category: string
  path: string[]
  fallbackPaths?: string[][]
}

export type NamePoolService = {
  pickNameKey(
    rng: import('../rng/rng').RngState,
    options: PickNameKeyOptions,
  ): import('../rng/rng').RngResult<NameKey>

  pickUniqueNameKey(
    rng: import('../rng/rng').RngState,
    used: Set<NameKey>,
    options: PickNameKeyOptions,
    fallbackPrefix: string,
    fallbackIndex: number,
  ): import('../rng/rng').RngResult<NameKey>

  getPool(category: string, culture: NameCultureId, path: string[]): NameKey[]
}
