/** Package-price lookup seam for canonical ingredient identifiers. */
import type { PriceItem } from '../../meal-plan-types.ts'

export interface PriceProvider {
  getPrices(ingredientIds: string[]): PriceItem[] | Promise<PriceItem[]>
}
