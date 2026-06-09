import { useSimulationStore } from '@/app/stores/simulationStore'
import { FamilyTreePanel } from '@/app/components/panels/details/FamilyTreePanel'

// store の familyTreeHouseId を購読し、非 null のとき家系図 overlay を描画する薄いラッパ。
// 詳細カード (WindowManager) より前にマウントすることで、ノードクリックで開く人物カードが
// 家系図の上に重なる z 順を確保する。
export function FamilyTreeWindow() {
  const houseId = useSimulationStore((s) => s.familyTreeHouseId)
  const session = useSimulationStore((s) => s.session)
  const closeFamilyTree = useSimulationStore((s) => s.closeFamilyTree)
  const openDetailWindow = useSimulationStore((s) => s.openDetailWindow)

  const state = session?.currentState
  if (houseId === null || !state) return null

  return (
    <FamilyTreePanel
      houseId={houseId}
      state={state}
      onClose={closeFamilyTree}
      onPersonClick={(id) => openDetailWindow('person', id)}
      onHouseClick={(id) => openDetailWindow('house', id)}
    />
  )
}
