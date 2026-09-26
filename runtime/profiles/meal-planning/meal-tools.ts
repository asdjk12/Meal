/** Public V1 Meal Agent Tool catalog registered by the Profile plugin. */
import {
  getInventoryTool,
  getNutritionTool,
  getPricesTool,
  getScheduleTool,
  searchRecipesTool,
} from './meal-data-tools.ts'
import { solveMealPlanTool, validateMealPlanTool } from './meal-planning-tools.ts'

export const mealTools = [
  getInventoryTool,
  searchRecipesTool,
  getNutritionTool,
  getPricesTool,
  getScheduleTool,
  solveMealPlanTool,
  validateMealPlanTool,
]
