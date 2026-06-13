import { useSimulationStore } from '@/app/stores/simulationStore'
import { FactionTreePanel } from '@/app/components/panels/details/FactionTreePanel'

// store の factionTreeFactionId を購読し、非 null のとき派閥図 overlay を描画する薄いラッパ。
// FamilyTreeWindow と同様、詳細カード (WindowManager) より前にマウントすることで、
// ノードクリックで開く人物カードが派閥図の上に重なる z 順を確保する。
export function FactionTreeWindow() {
  const factionId = useSimulationStore((s) => s.factionTreeFactionId)
  const session = useSimulationStore((s) => s.session)
  const closeFactionTree = useSimulationStore((s) => s.closeFactionTree)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)

  const state = session?.currentState
  if (factionId === null || !state) return null

  return (
    <FactionTreePanel
      factionId={factionId}
      state={state}
      onClose={closeFactionTree}
      onPersonClick={(id) => openDetailWindow('person', id)}
      onFactionClick={(id) => openDetailWindow('faction', id)}
    />
  )
}
