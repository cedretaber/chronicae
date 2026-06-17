// ツリー上のあるノードの「系統」(祖先 ∪ 子孫 ∪ 自身) を集める純関数。家系図・派閥図のホバー
//   ハイライトで共有する (集合外を減光)。parentsOf / childrenOf は displayed なノードのみを返す
//   想定。木でも DAG (家系図は父母 2 系統) でも動くよう visited で多重訪問を防ぐ。
//   兄弟・いとこなど「root を通らない」ノードは含めない (祖先は親方向のみ、子孫は子方向のみ辿る)。
export function collectLineage(
  rootId: string,
  parentsOf: (id: string) => string[],
  childrenOf: (id: string) => string[],
): Set<string> {
  const set = new Set<string>([rootId])

  // 祖先方向 (親をたどる)
  const up: string[] = [rootId]
  while (up.length > 0) {
    const cur = up.pop() as string
    for (const p of parentsOf(cur)) {
      if (!set.has(p)) {
        set.add(p)
        up.push(p)
      }
    }
  }

  // 子孫方向 (子をたどる)。root からのみ下り、祖先の別の子 (兄弟) には広げない。
  const down: string[] = [rootId]
  const seenDown = new Set<string>([rootId])
  while (down.length > 0) {
    const cur = down.pop() as string
    for (const c of childrenOf(cur)) {
      if (!seenDown.has(c)) {
        seenDown.add(c)
        set.add(c)
        down.push(c)
      }
    }
  }

  return set
}
