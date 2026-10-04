/** Local nutrition adapter exposing unscaled facts from the V1 Fixture. */
import { ingredientNutrition, recipes } from '../../meal-fixtures.ts'
import type {
  NutritionBase,
  NutritionItemType,
  NutritionProvider,
} from '../contracts/nutrition-provider.ts'
import { ProviderError } from '../provider-error.ts'

export class LocalNutritionProvider implements NutritionProvider {
  getNutritionBase(itemType: NutritionItemType, itemId: string): NutritionBase {
    const item = itemType === 'ingredient'
      ? ingredientNutrition.find(value => value.item_id === itemId)
      : recipes.find(value => value.recipe_id === itemId)

    if (!item) {
      throw new ProviderError('DATA_NOT_FOUND', 'Nutrition fact is not available.', {
        entity: itemType,
        missing: [itemId],
      })
    }
    if (itemType === 'ingredient' && 'basis' in item) return { ...item }

    const recipe = itemType === 'recipe' && 'recipe_id' in item ? item : undefined
    if (!recipe) throw new ProviderError('PROVIDER_INTERNAL_ERROR', 'Nutrition Fixture type mismatch.')
    return {
      item_id: recipe.recipe_id,
      item_type: 'recipe',
      basis: `${recipe.servings} serving`,
      ...recipe.nutrition,
    }
  }
}
