import { describe, it, expect } from 'vitest'
import { FOOD_RESOURCE_VALUE } from './popFoodDefinitions'

describe('FOOD_RESOURCE_VALUE', () => {
  it('staple/protein/fine_food 寄与資源を含み非食料を含まない', () => {
    expect(FOOD_RESOURCE_VALUE.grain).toBe(1.0) // staple_food
    expect(FOOD_RESOURCE_VALUE.fish).toBe(1.0) // protein
    expect(FOOD_RESOURCE_VALUE.meat).toBe(1.0) // protein
    expect(FOOD_RESOURCE_VALUE.smoked_fish).toBe(1.5) // protein (加工)
    expect(FOOD_RESOURCE_VALUE.processed_meat).toBe(1.5) // protein (加工)
    expect(FOOD_RESOURCE_VALUE.fruit).toBe(1.0) // fine_food
    expect(FOOD_RESOURCE_VALUE.beer ?? 0).toBe(0) // basic_drink は食料でない
    expect(FOOD_RESOURCE_VALUE.clothes ?? 0).toBe(0)
    expect(FOOD_RESOURCE_VALUE.wine ?? 0).toBe(0) // luxury_drink
  })
})
