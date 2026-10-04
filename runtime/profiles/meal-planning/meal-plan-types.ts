/** Shared V0.2 planning values passed through DSH Tool JSON contracts. */
export interface IngredientAmount {
  ingredient_id: string
  quantity: number
  unit: string
}

export interface InventoryItem {
  ingredient: string
  quantity: number
  unit: string
}

export interface NutritionValues {
  calories_kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

export interface Recipe {
  recipe_id: string
  name: string
  servings: number
  cook_minutes: number
  ingredients: string[]
  ingredient_amounts: IngredientAmount[]
  allergens: string[]
  nutrition: NutritionValues
}

export interface NutritionItem extends NutritionValues {
  item_id: string
  item_type: 'ingredient' | 'recipe'
  basis: string
  amount: number
  unit: string
}

export interface PriceItem {
  ingredient_id: string
  package_quantity: number
  package_unit: string
  price_cny: number
  in_stock: boolean
}

export interface ScheduleDay {
  day: number
  slots: Array<{ meal: string, available_minutes: number }>
}

export interface PlanConstraints {
  days: number
  budget_cny: number
  min_daily_protein_g: number
  max_cook_minutes: number
  required_ingredient_ids?: string[]
  excluded_ingredient_ids?: string[]
  exclude_allergens?: string[]
  allow_purchase?: boolean
}

export interface PlanMeal {
  meal: string
  recipe_id: string
  servings: number
}

export interface PlanDay {
  day: number
  meals: PlanMeal[]
  protein_g: number
}

export interface MealPlan {
  plan_id: string
  status: 'feasible'
  verification_status: 'unverified'
  optimization_status: 'first_feasible'
  days: PlanDay[]
  ingredient_usage: IngredientAmount[]
  grocery_list: IngredientAmount[]
  estimated_cost_cny: number
}

export interface PlanChange {
  type: 'REMOVE_MEAL'
  day: number
  meal: string
}

export interface PlanningInput {
  constraints: PlanConstraints
  inventory: InventoryItem[]
  candidate_recipes: Recipe[]
  nutrition_data: NutritionItem[]
  price_data: PriceItem[]
  schedule: ScheduleDay[]
  existing_plan?: MealPlan
  plan_changes?: PlanChange[]
}

export interface Violation {
  type: string
  expected?: string | number
  actual?: string | number
}
