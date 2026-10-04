/** Recipe lookup seam; callers provide canonical ingredient identifiers. */
import type { Recipe } from '../../meal-plan-types.ts'

export interface RecipeQuery {
  query?: string
  maxCookMinutes?: number
  ingredientIds: string[]
  excludedAllergens: string[]
  limit: number
}

export interface RecipeProvider {
  searchRecipes(query: RecipeQuery): Recipe[] | Promise<Recipe[]>
}
