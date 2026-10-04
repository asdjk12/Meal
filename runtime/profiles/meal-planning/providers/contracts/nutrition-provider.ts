/** Nutrition fact seam; amount and unit conversion remain a Tool responsibility. */
import type { NutritionValues } from '../../meal-plan-types.ts'

export type NutritionItemType = 'ingredient' | 'recipe'

export interface NutritionBase extends NutritionValues {
  item_id: string
  item_type: NutritionItemType
  basis: string
}

export interface NutritionProvider {
  getNutritionBase(itemType: NutritionItemType, itemId: string): NutritionBase | Promise<NutritionBase>
}
