// 年代記の「視覚言語」を表すデザイントークン。年代記パネル (vellum) / インライン年代記 (dark) /
//   EventLog (dark) が共有し、配色だけ tone で差し替える。1 箇所に集約することで各所がドリフトしない。
//   - vellum: 暗いマップ上の「写本ページ」(羊皮紙 + 鉄胆インク + 鉄丹の朱)
//   - dark:   暗色ウィンドウ・ログに馴染む冷たいグレー基調。朱は重要印・年見出しのみ
import type { EventImportance } from '@sim/types/event'

export type ChronicleTone = 'vellum' | 'dark'

export const CHRONICLE_SERIF = "'Spectral', Georgia, serif"

export type ChroniclePalette = {
  rail: string // 左マージンの時の罫 + 年見出しの末尾ヘアライン
  rubric: string // 朱: 年見出し・アクセント
  inkSoft: string // 週など二次情報
  category: string // カテゴリ/種別の小ラベル
  ink: Record<EventImportance, string> // 本文インク (重要度で濃淡)
  mark: Record<EventImportance, { glyph: string; color: string }> // 余白の重要度印
  yearHeadSize: string // 年見出しの文字サイズ (vellum はやや大きく)
}

export const CHRONICLE_PALETTES: Record<ChronicleTone, ChroniclePalette> = {
  vellum: {
    rail: '#CDBF9E',
    rubric: '#9E3B2E',
    inkSoft: '#8A7F68',
    category: '#9C9075',
    ink: { critical: '#3A3326', major: '#3A3326', normal: '#4A4234', minor: '#7C7259' },
    mark: {
      critical: { glyph: '‡', color: '#9E3B2E' },
      major: { glyph: '†', color: '#9E3B2E' },
      normal: { glyph: '·', color: '#A99B79' },
      minor: { glyph: '·', color: '#C2B591' },
    },
    yearHeadSize: 'text-[15px]',
  },
  dark: {
    rail: '#374151', // gray-700 (ウィンドウ枠と同調)
    rubric: '#CC7A5C', // 暗色で読める鉄丹 (vellum の朱を明度調整)
    inkSoft: '#9CA3AF', // gray-400
    category: '#6B7280', // gray-500
    ink: { critical: '#F3F4F6', major: '#E5E7EB', normal: '#D1D5DB', minor: '#6B7280' },
    mark: {
      critical: { glyph: '‡', color: '#CC7A5C' },
      major: { glyph: '†', color: '#CC7A5C' },
      normal: { glyph: '·', color: '#6B7280' },
      minor: { glyph: '·', color: '#4B5563' },
    },
    yearHeadSize: 'text-[13px]',
  },
}
