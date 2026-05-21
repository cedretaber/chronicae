import provinceForest01 from '@/assets/province/province_forest_01.png'
import provinceForest02 from '@/assets/province/province_forest_02.png'
import provinceForest03 from '@/assets/province/province_forest_03.png'
import provinceMountain01 from '@/assets/province/province_mountain_01.png'
import provinceMountain02 from '@/assets/province/province_mountain_02.png'
import provinceMountain03 from '@/assets/province/province_mountain_03.png'
import provincePlain01 from '@/assets/province/province_plain_01.png'
import provincePlain02 from '@/assets/province/province_plain_02.png'
import provincePlain03 from '@/assets/province/province_plain_03.png'
import provinceRiver01 from '@/assets/province/province_plain_with_river_01.png'
import provinceRiver02 from '@/assets/province/province_plain_with_river_02.png'
import provinceRiver03 from '@/assets/province/province_plain_with_river_03.png'

import holdingCity01 from '@/assets/holding/holding_city_01.png'
import holdingCity02 from '@/assets/holding/holding_city_02.png'
import holdingCity03 from '@/assets/holding/holding_city_03.png'
import holdingCity04 from '@/assets/holding/holding_city_04.png'
import holdingCity05 from '@/assets/holding/holding_city_05.png'
import holdingCity06 from '@/assets/holding/holding_city_06.png'
import holdingManor01 from '@/assets/holding/holding_manor_01.png'
import holdingManor02 from '@/assets/holding/holding_manor_02.png'
import holdingManor03 from '@/assets/holding/holding_manor_03.png'
import holdingManor04 from '@/assets/holding/holding_manor_04.png'
import holdingManor05 from '@/assets/holding/holding_manor_05.png'
import holdingManor06 from '@/assets/holding/holding_manor_06.png'

const PROVINCE_IMAGES = [
  provinceForest01,
  provinceForest02,
  provinceForest03,
  provinceMountain01,
  provinceMountain02,
  provinceMountain03,
  provincePlain01,
  provincePlain02,
  provincePlain03,
  provinceRiver01,
  provinceRiver02,
  provinceRiver03,
]

const HOLDING_CITY_IMAGES = [
  holdingCity01,
  holdingCity02,
  holdingCity03,
  holdingCity04,
  holdingCity05,
  holdingCity06,
]

const HOLDING_MANOR_IMAGES = [
  holdingManor01,
  holdingManor02,
  holdingManor03,
  holdingManor04,
  holdingManor05,
  holdingManor06,
]

function simpleHash(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function getProvinceImage(provinceId: string): string {
  return PROVINCE_IMAGES[simpleHash(provinceId) % PROVINCE_IMAGES.length]!
}

export function getHoldingImage(holdingId: string, kind: 'city' | 'manor'): string {
  const pool = kind === 'city' ? HOLDING_CITY_IMAGES : HOLDING_MANOR_IMAGES
  return pool[simpleHash(holdingId) % pool.length]!
}
