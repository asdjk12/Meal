/** Local price adapter backed by the deterministic V1 Fixture. */
import { ingredientPrices } from '../../meal-fixtures.ts'
import type { PriceItem } from '../../meal-plan-types.ts'
import type { PriceProvider } from '../contracts/price-provider.ts'
import { ProviderError } from '../provider-error.ts'

export class LocalPriceProvider implements PriceProvider {
  getPrices(ingredientIds: string[]): PriceItem[] {
    const found = ingredientIds
      .map(id => ingredientPrices.find(price => price.ingredient_id === id))
      .filter(price => price !== undefined)
    const missing = ingredientIds.filter(id => !found.some(price => price.ingredient_id === id))
    if (missing.length > 0) {
      throw new ProviderError('DATA_NOT_FOUND', 'Price fact is not available.', {
        entity: 'price',
        missing,
      })
    }
    return found.map(price => ({ ...price }))
  }
}
