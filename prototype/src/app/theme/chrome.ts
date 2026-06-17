// アプリ常時表示「chrome」(マストヘッド / 左レール / Sidebar / MapLegend) のデザイントークン。
//   役割で色を分ける 2 アクセント体系:
//     - 温かい鉄丹の朱 (@/app/theme/chronicle の rubric) = 「記録・文書」面 (年代記 / EventLog)
//     - 冷たい鋼青 (本ファイル CHROME.accent) = 「計器・操作」面 (chrome の active/選択状態)
//   chrome のサーフェスは中立な暗グレー (bg-gray-950/900/800) のままにし、地図と意味色
//   (戦争=赤・スコア=黄・tier 色) を引き立てる。bold さはブランド + 単一アクセントに集中する。
import { CHRONICLE_SERIF } from './chronicle'

// ブランドワードマーク用の display セリフ (Latin 専用; 日本語見出しには使わない)。
export const BRAND_SERIF = CHRONICLE_SERIF

export const CHROME = {
  accent: '#5E8CA8', // 統一した冷たい操作アクセント (鋼青)。active 下線・選択枠・強調に
  accentFill: '#3F6C8A', // active なボタン地 (再生中 / 選択中の塗り)
  accentFillHover: '#4C7E9E',
  border: '#374151', // 罫・境界 (chronicle dark トークンと共通の gray-700)
} as const
