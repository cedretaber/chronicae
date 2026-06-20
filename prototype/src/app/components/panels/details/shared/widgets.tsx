// Detail パネル共通 widget 群。実体はドメイン別ファイルに分割し、ここは従来の
// import パス ('./widgets') を維持する re-export バレル。
export {
  PanelHeader,
  DetailSection,
  CollapsibleSection,
  EntityChronicleSection,
  WatchButton,
  CopyJsonButton,
} from './widgetsLayout'
export { InfluenceSection, ShareholderSection } from './widgetsInfluence'
export { RightHolderLine, HouseRightsSection, PersonRightsSection } from './widgetsRights'
export {
  AttitudeList,
  PolityLandContracts,
  PolityRegiments,
  PolityThreats,
  RepublicPowerProfileSection,
} from './widgetsPolity'
