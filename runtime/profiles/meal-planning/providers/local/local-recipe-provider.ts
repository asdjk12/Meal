/** Local recipe adapter that filters and clones the deterministic V1 Fixture. */
import { recipes } from '../../meal-fixtures.ts'
import type { Recipe } from '../../meal-plan-types.ts'
import type { RecipeProvider, RecipeQuery } from '../contracts/recipe-provider.ts'
import { ProviderError } from '../provider-error.ts'

function cloneRecipe(recipe: Recipe): Recipe {
  return {
    ...recipe,
    ingredients: [...recipe.ingredients],
    ingredient_amounts: recipe.ingredient_amounts.map(item => ({ ...item })),
    allergens: [...recipe.allergens],
    nutrition: { ...recipe.nutrition },
  }
}

export class LocalRecipeProvider implements RecipeProvider {
  searchRecipes(query: RecipeQuery): Recipe[] {
    const knownIngredients = new Set(recipes.flatMap(recipe => recipe.ingredients))
    const missing = query.ingredientIds.filter(id => !knownIngredients.has(id))
    if (missing.length > 0) {
      throw new ProviderError('DATA_NOT_FOUND', 'Recipe ingredient is not available.', {
        entity: 'ingredient',
        missing,
      })
    }

    const excluded = new Set(query.excludedAllergens)
    return recipes.filter((recipe) => {
      const searchable = `${recipe.recipe_id} ${recipe.name} ${recipe.ingredients.join(' ')}`.toLowerCase()
      return (!query.query || searchable.includes(query.query))
        && (query.maxCookMinutes === undefined || recipe.cook_minutes <= query.maxCookMinutes)
        && query.ingredientIds.every(id => recipe.ingredients.includes(id))
        && recipe.allergens.every(allergen => !excluded.has(allergen))
    }).slice(0, query.limit).map(cloneRecipe)
  }
}
