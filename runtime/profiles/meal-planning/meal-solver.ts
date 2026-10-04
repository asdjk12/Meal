/** Deterministic three-day planning over the explicit V0.2 Tool inputs. */
import { fixtureMealPlan, ingredientPrices, inventoryItems, recipes, scheduleDays } from './meal-fixtures.ts'
import type { IngredientAmount, MealPlan, PlanDay, PlanMeal, PlanningInput, Recipe } from './meal-plan-types.ts'

const requiredInputs = ['constraints', 'inventory', 'candidate_recipes', 'nutrition_data', 'price_data', 'schedule'] as const

/** Reject absent or invented data before any plan can be emitted. */
export function checkPlanningInput(input: Partial<PlanningInput>): { missing: string[], invalid: string[] } {
  const missing: string[] = requiredInputs.filter(key => input[key] === undefined)
  if (missing.length > 0) return { missing: [...missing], invalid: [] }
  const data = input as PlanningInput
  const invalid: string[] = []
  if (data.candidate_recipes.length === 0) missing.push('candidate_recipes')
  if (data.schedule.length < data.constraints.days) missing.push('schedule')
  if (data.inventory.length !== inventoryItems.length || inventoryItems.some(known => {
    const received = data.inventory.find(item => item.ingredient === known.ingredient)
    return !received || received.quantity !== known.quantity || received.unit !== known.unit
  })) invalid.push('inventory')
  if (scheduleDays.slice(0, data.constraints.days).some(known => {
    const received = data.schedule.find(item => item.day === known.day)
    return !received || received.slots.length !== known.slots.length || known.slots.some(slot => {
      const actual = received.slots.find(item => item.meal === slot.meal)
      return !actual || actual.available_minutes !== slot.available_minutes
    })
  })) invalid.push('schedule')

  for (const recipe of data.candidate_recipes) {
    const trusted = recipes.find(item => item.recipe_id === recipe.recipe_id)
    if (!trusted || recipe.cook_minutes !== trusted.cook_minutes || recipe.servings !== trusted.servings
      || recipe.nutrition.protein_g !== trusted.nutrition.protein_g
      || recipe.ingredients.length !== trusted.ingredients.length
      || trusted.ingredients.some(id => !recipe.ingredients.includes(id))
      || recipe.ingredient_amounts.length !== trusted.ingredient_amounts.length
      || trusted.ingredient_amounts.some(amount => {
        const received = recipe.ingredient_amounts.find(item => item.ingredient_id === amount.ingredient_id)
        return !received || received.quantity !== amount.quantity || received.unit !== amount.unit
      })) invalid.push(`candidate_recipes:${recipe.recipe_id}`)
    const nutrition = data.nutrition_data.find(item => item.item_type === 'recipe' && item.item_id === recipe.recipe_id)
    if (!nutrition) missing.push(`nutrition_data:${recipe.recipe_id}`)
    else if (nutrition.amount !== trusted?.servings || nutrition.unit !== 'serving'
      || nutrition.protein_g !== trusted.nutrition.protein_g
      || nutrition.calories_kcal !== trusted.nutrition.calories_kcal
      || nutrition.carbs_g !== trusted.nutrition.carbs_g
      || nutrition.fat_g !== trusted.nutrition.fat_g) invalid.push(`nutrition_data:${recipe.recipe_id}`)
    for (const amount of recipe.ingredient_amounts) {
      const price = data.price_data.find(item => item.ingredient_id === amount.ingredient_id)
      const trustedPrice = ingredientPrices.find(item => item.ingredient_id === amount.ingredient_id)
      if (!price || !trustedPrice) missing.push(`price_data:${amount.ingredient_id}`)
      else if (price.price_cny !== trustedPrice.price_cny || price.package_quantity !== trustedPrice.package_quantity
        || price.package_unit !== trustedPrice.package_unit || price.in_stock !== trustedPrice.in_stock) {
        invalid.push(`price_data:${amount.ingredient_id}`)
      }
    }
  }
  return { missing: [...new Set(missing)], invalid: [...new Set(invalid)] }
}

function demandFor(days: PlanDay[], candidates: Map<string, Recipe>): IngredientAmount[] {
  const demand = new Map<string, IngredientAmount>()
  for (const day of days) for (const meal of day.meals) {
    const recipe = candidates.get(meal.recipe_id)
    if (!recipe) continue
    for (const ingredient of recipe.ingredient_amounts) {
      const previous = demand.get(ingredient.ingredient_id)
      demand.set(ingredient.ingredient_id, {
        ingredient_id: ingredient.ingredient_id,
        quantity: (previous?.quantity ?? 0) + ingredient.quantity * meal.servings / recipe.servings,
        unit: ingredient.unit,
      })
    }
  }
  return [...demand.values()]
}

/** Calculate actual package purchases after subtracting the local pantry. */
function purchasesFor(demand: IngredientAmount[], input: PlanningInput) {
  const groceries: IngredientAmount[] = []
  let cost = 0
  for (const item of demand) {
    const owned = input.inventory.find(value => value.ingredient === item.ingredient_id)
    const shortage = Math.max(0, item.quantity - (owned?.quantity ?? 0))
    if (shortage === 0) continue
    if (input.constraints.allow_purchase === false || (owned && owned.unit !== item.unit)) return null
    const price = input.price_data.find(value => value.ingredient_id === item.ingredient_id)
    if (!price || !price.in_stock || price.package_unit !== item.unit || price.package_quantity <= 0) return null
    const packages = Math.ceil(shortage / price.package_quantity)
    groceries.push({ ingredient_id: item.ingredient_id, quantity: packages * price.package_quantity, unit: item.unit })
    cost += packages * price.price_cny
  }
  return { groceries, cost: Math.round(cost * 100) / 100 }
}

function preferredMeals(input: PlanningInput): Map<string, PlanMeal> {
  const source = input.existing_plan?.days ?? fixtureMealPlan.days
  return new Map(source.flatMap(day => day.meals.map(meal => [`${day.day}:${meal.meal}`, meal] as const)))
}

function optionsFor(day: number, meal: string, availableMinutes: number, input: PlanningInput, preferred: Map<string, PlanMeal>) {
  const excludedIngredients = new Set(input.constraints.excluded_ingredient_ids ?? [])
  const excludedAllergens = new Set(input.constraints.exclude_allergens ?? [])
  const options = input.candidate_recipes
    .filter(recipe => recipe.cook_minutes <= Math.min(availableMinutes, input.constraints.max_cook_minutes)
      && recipe.ingredients.every(id => !excludedIngredients.has(id))
      && recipe.allergens.every(id => !excludedAllergens.has(id)))
    .flatMap(recipe => [1, 2].map(servings => ({ meal, recipe_id: recipe.recipe_id, servings })))
  const wanted = preferred.get(`${day}:${meal}`)
  return options.sort((a, b) => {
    const rank = (value: PlanMeal) => value.recipe_id === wanted?.recipe_id
      ? value.servings === wanted.servings ? 0 : 1 : 2
    return rank(a) - rank(b) || a.servings - b.servings
  })
}

function buildPlan(selected: Array<{ day: number, meal: PlanMeal }>, input: PlanningInput, candidates: Map<string, Recipe>): MealPlan | null {
  const nutrition = new Map(input.nutrition_data.filter(item => item.item_type === 'recipe').map(item => [item.item_id, item]))
  const days: PlanDay[] = Array.from({ length: input.constraints.days }, (_, index) => {
    const day = index + 1
    const meals = selected.filter(item => item.day === day).map(item => item.meal)
    const protein_g = meals.reduce((sum, meal) => {
      const recipe = candidates.get(meal.recipe_id)
      return sum + (nutrition.get(meal.recipe_id)?.protein_g ?? 0) * meal.servings / (recipe?.servings ?? 1)
    }, 0)
    return { day, meals, protein_g }
  })
  if (days.some(day => day.protein_g < input.constraints.min_daily_protein_g)) return null
  const demand = demandFor(days, candidates)
  if ((input.constraints.required_ingredient_ids ?? []).some(id => !demand.some(item => item.ingredient_id === id))) return null
  const purchases = purchasesFor(demand, input)
  if (!purchases || purchases.cost > input.constraints.budget_cny) return null
  return {
    plan_id: input.existing_plan ? 'fixture-plan-v2-replan' : 'fixture-plan-v2',
    status: 'feasible', verification_status: 'unverified', optimization_status: 'first_feasible', days,
    ingredient_usage: demand, grocery_list: purchases.groceries, estimated_cost_cny: purchases.cost,
  }
}

/** Return the first feasible assignment, preferring unchanged meals from the prior plan. */
export function solvePlan(input: PlanningInput): MealPlan | null {
  if (input.constraints.days !== 3) return null
  const removed = new Set((input.plan_changes ?? []).filter(change => change.type === 'REMOVE_MEAL')
    .map(change => `${change.day}:${change.meal}`))
  const slots = input.schedule.flatMap(day => day.slots
    .filter(slot => !removed.has(`${day.day}:${slot.meal}`))
    .map(slot => ({ day: day.day, ...slot })))
  const candidates = new Map(input.candidate_recipes.map(recipe => [recipe.recipe_id, recipe]))
  const preferred = preferredMeals(input)
  const selected: Array<{ day: number, meal: PlanMeal }> = []

  const search = (index: number): MealPlan | null => {
    if (index === slots.length) return buildPlan(selected, input, candidates)
    const slot = slots[index]!
    for (const meal of optionsFor(slot.day, slot.meal, slot.available_minutes, input, preferred)) {
      selected.push({ day: slot.day, meal })
      const plan = search(index + 1)
      if (plan) return plan
      selected.pop()
    }
    return null
  }
  return search(0)
}

/** Report only conflict categories established by counterfactual Solver runs. */
export function diagnoseNoPlan(input: PlanningInput): string[] {
  const relaxed = { ...input, constraints: { ...input.constraints, budget_cny: 100_000, min_daily_protein_g: 0, allow_purchase: true } }
  if (!solvePlan(relaxed)) return ['SCHEDULE_OR_CANDIDATES_INFEASIBLE']
  const conflicts: string[] = []
  if (!solvePlan({ ...input, constraints: { ...input.constraints, min_daily_protein_g: 0, allow_purchase: true } })) {
    conflicts.push('BUDGET_TOO_LOW_FOR_FULL_PLAN')
  }
  if (input.constraints.allow_purchase === false
    && !solvePlan({ ...input, constraints: { ...input.constraints, budget_cny: 100_000, min_daily_protein_g: 0 } })) {
    conflicts.push('INVENTORY_CANNOT_COVER_ALL_MEALS')
  }
  if (!solvePlan({ ...input, constraints: { ...input.constraints, budget_cny: 100_000, allow_purchase: true } })) {
    conflicts.push('PROTEIN_TARGET_UNREACHABLE')
  }
  return conflicts.length ? conflicts : ['COMBINED_CONSTRAINTS_INFEASIBLE']
}

/** Count exact retained, modified, and removed meals for a re-plan. */
export function replanSummary(existing: MealPlan | undefined, next: MealPlan) {
  if (!existing) return { unchanged_meals: 0, modified_meals: 0, removed_meals: 0 }
  const nextMeals = new Map(next.days.flatMap(day => day.meals.map(meal => [`${day.day}:${meal.meal}`, meal] as const)))
  let unchanged_meals = 0
  let modified_meals = 0
  let removed_meals = 0
  for (const day of existing.days) for (const meal of day.meals) {
    const after = nextMeals.get(`${day.day}:${meal.meal}`)
    if (!after) removed_meals++
    else if (after.recipe_id === meal.recipe_id && after.servings === meal.servings) unchanged_meals++
    else modified_meals++
  }
  return { unchanged_meals, modified_meals, removed_meals }
}
