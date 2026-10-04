/** Independently verify a proposed Plan against trusted local fixture facts. */
import { ingredientPrices, inventoryItems, recipes, scheduleDays } from './meal-fixtures.ts'
import type { IngredientAmount, MealPlan, PlanConstraints, Violation } from './meal-plan-types.ts'

type CheckName = 'nutrition' | 'budget' | 'inventory' | 'allergens' | 'schedule'

function record(violations: Violation[], checks: Map<CheckName, boolean>, check: CheckName, type: string, expected?: string | number, actual?: string | number) {
  checks.set(check, false)
  violations.push({ type, ...expected === undefined ? {} : { expected }, ...actual === undefined ? {} : { actual } })
}

/** Recompute the meal-level facts without reading any Solver aggregate. */
function inspectMeals(plan: MealPlan, constraints: PlanConstraints, violations: Violation[], checks: Map<CheckName, boolean>) {
  const demand = new Map<string, IngredientAmount>()
  if (plan.days.length !== constraints.days) record(violations, checks, 'schedule', 'DAY_COUNT_MISMATCH', constraints.days, plan.days.length)
  const seenDays = new Set<number>()
  const usedIngredients = new Set<string>()
  for (const day of plan.days) {
    if (seenDays.has(day.day)) record(violations, checks, 'schedule', 'DUPLICATE_DAY', undefined, day.day)
    seenDays.add(day.day)
    const seenMeals = new Set<string>()
    let protein = 0
    for (const meal of day.meals) {
      const recipe = recipes.find(item => item.recipe_id === meal.recipe_id)
      const slot = scheduleDays.find(item => item.day === day.day)?.slots.find(item => item.meal === meal.meal)
      if (seenMeals.has(meal.meal)) record(violations, checks, 'schedule', 'DUPLICATE_MEAL', undefined, `${day.day}:${meal.meal}`)
      seenMeals.add(meal.meal)
      if (!recipe || !Number.isFinite(meal.servings) || meal.servings <= 0) {
        record(violations, checks, 'nutrition', 'INVALID_MEAL', 'known recipe and positive servings', meal.recipe_id)
        continue
      }
      if (!slot) record(violations, checks, 'schedule', 'SLOT_NOT_FOUND', undefined, `${day.day}:${meal.meal}`)
      else if (recipe.cook_minutes > Math.min(slot.available_minutes, constraints.max_cook_minutes)) {
        record(violations, checks, 'schedule', 'COOK_TIME_EXCEEDED', Math.min(slot.available_minutes, constraints.max_cook_minutes), recipe.cook_minutes)
      }
      for (const allergen of recipe.allergens) if (constraints.exclude_allergens?.includes(allergen)) {
        record(violations, checks, 'allergens', 'EXCLUDED_ALLERGEN', 'absent', allergen)
      }
      protein += recipe.nutrition.protein_g * meal.servings / recipe.servings
      for (const ingredient of recipe.ingredient_amounts) {
        usedIngredients.add(ingredient.ingredient_id)
        if (constraints.excluded_ingredient_ids?.includes(ingredient.ingredient_id)) {
          record(violations, checks, 'inventory', 'EXCLUDED_INGREDIENT', 'absent', ingredient.ingredient_id)
        }
        const previous = demand.get(ingredient.ingredient_id)
        demand.set(ingredient.ingredient_id, {
          ingredient_id: ingredient.ingredient_id,
          quantity: (previous?.quantity ?? 0) + ingredient.quantity * meal.servings / recipe.servings,
          unit: ingredient.unit,
        })
      }
    }
    if (protein < constraints.min_daily_protein_g) record(violations, checks, 'nutrition', 'PROTEIN_BELOW_MINIMUM', constraints.min_daily_protein_g, protein)
    if (Math.abs(protein - day.protein_g) > 0.01) record(violations, checks, 'nutrition', 'PROTEIN_TOTAL_MISMATCH', protein, day.protein_g)
  }
  for (const id of constraints.required_ingredient_ids ?? []) if (!usedIngredients.has(id)) {
    record(violations, checks, 'inventory', 'REQUIRED_INGREDIENT_MISSING', id)
  }
  return [...demand.values()]
}

/** Recalculate purchases from recipe demand, pantry stock, and package prices. */
function inspectPurchases(plan: MealPlan, constraints: PlanConstraints, demand: IngredientAmount[], violations: Violation[], checks: Map<CheckName, boolean>) {
  let cost = 0
  let dataMissing = false
  for (const item of demand) {
    const owned = inventoryItems.find(value => value.ingredient === item.ingredient_id)
    if (owned && owned.unit !== item.unit) {
      record(violations, checks, 'inventory', 'INVENTORY_UNIT_MISMATCH', item.unit, owned.unit)
      continue
    }
    const shortage = Math.max(0, item.quantity - (owned?.quantity ?? 0))
    const listed = plan.grocery_list.find(value => value.ingredient_id === item.ingredient_id)
    if (shortage === 0) {
      if (listed) record(violations, checks, 'inventory', 'UNNEEDED_PURCHASE', 0, listed.quantity)
      continue
    }
    if (constraints.allow_purchase === false) record(violations, checks, 'inventory', 'PURCHASE_FORBIDDEN', 0, shortage)
    const price = ingredientPrices.find(value => value.ingredient_id === item.ingredient_id)
    if (!price || !price.in_stock || price.package_unit !== item.unit || price.package_quantity <= 0) {
      record(violations, checks, 'budget', 'PRICE_DATA_MISSING', item.ingredient_id)
      dataMissing = true
      continue
    }
    const packages = Math.ceil(shortage / price.package_quantity)
    const expectedQuantity = packages * price.package_quantity
    if (!listed || listed.unit !== item.unit || Math.abs(listed.quantity - expectedQuantity) > 0.01) {
      record(violations, checks, 'inventory', 'GROCERY_LIST_MISMATCH', expectedQuantity, listed?.quantity)
    }
    cost += packages * price.price_cny
  }
  for (const listed of plan.grocery_list) if (!demand.some(item => item.ingredient_id === listed.ingredient_id)) {
    record(violations, checks, 'inventory', 'UNKNOWN_PURCHASE', 'no extra ingredient', listed.ingredient_id)
  }
  if (!dataMissing) {
    if (Math.abs(cost - plan.estimated_cost_cny) > 0.01) record(violations, checks, 'budget', 'ESTIMATED_COST_MISMATCH', cost, plan.estimated_cost_cny)
    if (cost > constraints.budget_cny) record(violations, checks, 'budget', 'BUDGET_EXCEEDED', constraints.budget_cny, cost)
  }
  return dataMissing
}

/** Return verified, invalid, or unverified without mutating the supplied Plan. */
export function validatePlan(plan: MealPlan, constraints: PlanConstraints) {
  const checks = new Map<CheckName, boolean>([
    ['nutrition', true], ['budget', true], ['inventory', true], ['allergens', true], ['schedule', true],
  ])
  const violations: Violation[] = []
  const demand = inspectMeals(plan, constraints, violations, checks)
  for (const item of demand) {
    const reported = plan.ingredient_usage.find(value => value.ingredient_id === item.ingredient_id)
    if (!reported || reported.unit !== item.unit || Math.abs(reported.quantity - item.quantity) > 0.01) {
      record(violations, checks, 'inventory', 'INGREDIENT_USAGE_MISMATCH', item.quantity, reported?.quantity)
    }
  }
  for (const item of plan.ingredient_usage) if (!demand.some(value => value.ingredient_id === item.ingredient_id)) {
    record(violations, checks, 'inventory', 'UNKNOWN_INGREDIENT_USAGE', 'no extra ingredient', item.ingredient_id)
  }
  const dataMissing = inspectPurchases(plan, constraints, demand, violations, checks)
  const valid = violations.length === 0
  return {
    valid,
    validation_status: dataMissing ? 'unverified' as const : valid ? 'verified' as const : 'invalid' as const,
    checks: [...checks].map(([constraint, passed]) => ({ constraint, passed })),
    violations,
  }
}
