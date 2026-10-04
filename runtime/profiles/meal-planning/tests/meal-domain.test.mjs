/** Deterministic V0.2 planning and validation checks over the unchanged local scenario. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixtureMealPlan, ingredientPrices, inventoryItems, recipes, scheduleDays } from '../meal-fixtures.ts'
import { checkPlanningInput, diagnoseNoPlan, replanSummary, solvePlan } from '../meal-solver.ts'
import { validatePlan } from '../meal-validator.ts'

const constraints = { days: 3, budget_cny: 180, min_daily_protein_g: 120, max_cook_minutes: 30 }

function planningInput() {
  return {
    constraints: { ...constraints },
    inventory: structuredClone(inventoryItems),
    candidate_recipes: structuredClone(recipes),
    nutrition_data: recipes.map(recipe => ({
      item_id: recipe.recipe_id, item_type: 'recipe', basis: '1 serving', amount: 1, unit: 'serving',
      ...recipe.nutrition,
    })),
    price_data: structuredClone(ingredientPrices),
    schedule: structuredClone(scheduleDays),
  }
}

test('Solver requires complete trusted data and computes package purchases from inventory', () => {
  const input = planningInput()
  assert.deepEqual(checkPlanningInput(input), { missing: [], invalid: [] })
  assert.deepEqual(checkPlanningInput({ ...input, price_data: undefined }).missing, ['price_data'])
  assert.deepEqual(checkPlanningInput({ ...input, price_data: input.price_data.filter(item => item.ingredient_id !== 'chicken_breast') }).missing,
    ['price_data:chicken_breast'])
  const plan = solvePlan(input)
  assert.ok(plan)
  assert.equal(plan.estimated_cost_cny, 45)
  assert.equal(plan.grocery_list.length, 4)
  assert.equal(plan.ingredient_usage.find(item => item.ingredient_id === 'eggs')?.quantity, 6)
  assert.deepEqual(plan.days.map(day => day.protein_g), [120, 124, 120])
})

test('Validator rejects artificial changes and never changes the supplied Plan', () => {
  const plan = solvePlan(planningInput())
  assert.ok(plan)
  assert.equal(validatePlan(plan, constraints).validation_status, 'verified')
  const altered = { ...plan, estimated_cost_cny: 205 }
  const before = structuredClone(altered)
  const outcome = validatePlan(altered, constraints)
  assert.equal(outcome.valid, false)
  assert.ok(outcome.violations.some(item => item.type === 'ESTIMATED_COST_MISMATCH'))
  assert.deepEqual(altered, before)
})

test('Re-planning removes dinner and only changes the meal needed for daily protein', () => {
  const input = planningInput()
  const original = solvePlan(input)
  assert.ok(original)
  const changed = solvePlan({ ...input, constraints: { ...constraints, budget_cny: 60 },
    existing_plan: original, plan_changes: [{ type: 'REMOVE_MEAL', day: 2, meal: 'dinner' }] })
  assert.ok(changed)
  assert.equal(changed.days[1].meals.length, 1)
  assert.equal(changed.days[1].protein_g, 124)
  assert.deepEqual(replanSummary(original, changed), { unchanged_meals: 4, modified_meals: 1, removed_meals: 1 })
  assert.equal(validatePlan(changed, { ...constraints, budget_cny: 60 }).validation_status, 'verified')
})

test('Missing chicken price makes a previously feasible Plan unverified', () => {
  const plan = solvePlan(planningInput())
  assert.ok(plan)
  const index = ingredientPrices.findIndex(item => item.ingredient_id === 'chicken_breast')
  const [removed] = ingredientPrices.splice(index, 1)
  try {
    const input = planningInput()
    assert.ok(checkPlanningInput(input).missing.includes('price_data:chicken_breast'))
    const outcome = validatePlan(plan, constraints)
    assert.equal(outcome.valid, false)
    assert.equal(outcome.validation_status, 'unverified')
    assert.ok(outcome.violations.some(item => item.type === 'PRICE_DATA_MISSING'))
  } finally {
    ingredientPrices.splice(index, 0, removed)
  }
})

test('Original fixed recipe arrangement remains the preference, not a trusted cost', () => {
  const plan = solvePlan(planningInput())
  assert.ok(plan)
  assert.deepEqual(plan.days.map(day => day.meals.map(meal => meal.recipe_id)),
    fixtureMealPlan.days.map(day => day.meals.map(meal => meal.recipe_id)))
  assert.notEqual(plan.estimated_cost_cny, fixtureMealPlan.estimated_cost_cny)
})

test('Infeasible diagnostics identify budget and pantry blockers without inventing a price floor', () => {
  const input = planningInput()
  input.constraints = { ...constraints, budget_cny: 20, min_daily_protein_g: 200, allow_purchase: false }
  assert.equal(solvePlan(input), null)
  assert.deepEqual(diagnoseNoPlan(input), [
    'BUDGET_TOO_LOW_FOR_FULL_PLAN', 'INVENTORY_CANNOT_COVER_ALL_MEALS',
  ])
})
