import { useCallback, useState } from 'react'

// Detail パネルの折りたたみ節の開閉を 1 つの Set に集約管理する (panel ローカル)。
//   controlled な CollapsibleSection に open/onToggle を渡す。位置依存の useState を避けることで、
//   条件レンダリングされる兄弟節が出入りしても開閉状態が別の節へ誤って引き継がれない。
//   v1: 既定は全節「開」。collapsed Set に入っている id のみ閉じる (折りたたみは純粋に追加機能)。
//   永続は panel ローカルのみ (store には載せない — 別機能として保留)。
export function useCollapsedSections() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const isOpen = useCallback((id: string) => !collapsed.has(id), [collapsed])
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  return { isOpen, toggle }
}
