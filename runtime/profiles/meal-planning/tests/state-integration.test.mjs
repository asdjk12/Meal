/** ST-01 through ST-06 run the real local Solver and Validator under State orchestration. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ingredientPrices, inventoryItems, recipes, scheduleDays } from '../meal-fixtures.ts'
import { checkPlanningInput, solvePlan } from '../meal-solver.ts'
import { validatePlan } from '../meal-validator.ts'
import { StateError } from '../state/state-errors.ts'
import { StatePlanningFlow } from '../state/planning-flow.ts'

const constraints = { days: 3, budget_cny: 180, min_daily_protein_g: 120, max_cook_minutes: 30 }

function input() {
  return { constraints: { ...constraints }, inventory: structuredClone(inventoryItems),
    candidate_recipes: structuredClone(recipes),
    nutrition_data: recipes.map(recipe => ({ item_id: recipe.recipe_id, item_type: 'recipe',
      basis: '1 serving', amount: 1, unit: 'serving', ...recipe.nutrition })),
    price_data: structuredClone(ingredientPrices), schedule: structuredClone(scheduleDays) }
}

async function solve(flow, args, transform = value => value) {
  return flow.solve(args, async effective => {
    const completeness = checkPlanningInput(effective)
    if (completeness.missing.length || completeness.invalid.length) {
      return { success: false, error: { code: 'PRICE_NOT_FOUND' }, data: {} }
    }
    const plan = solvePlan(effective)
    return plan ? { success: true, data: { plan: transform(plan) }, error: null }
      : { success: false, data: {}, error: { code: 'NO_FEASIBLE_PLAN' } }
  })
}

async function validate(flow, plan, activeConstraints) {
  return flow.validate(plan, activeConstraints, async () => ({ success: true,
    data: validatePlan(plan, activeConstraints), error: null }))
}

async function initial(flow) {
  const result = await solve(flow, input())
  assert.equal(result.success, true)
  const validation = await validate(flow, result.data.plan, constraints)
  assert.equal(validation.data.validation_status, 'verified')
  return result.data.plan
}

test('ST-01 initial planning commits all facts, plan, purchases, and version', async () => {
  const flow = new StatePlanningFlow()
  await initial(flow)
  const state = flow.state.getState()
  assert.equal(state.version, 2)
  assert.deepEqual(state.constraints, constraints)
  assert.deepEqual(state.inventorySnapshot.items, inventoryItems)
  assert.deepEqual(state.scheduleSnapshot.items, scheduleDays)
  assert.deepEqual(state.shoppingList, state.currentPlan.grocery_list)
  assert.equal(state.planValidationStatus, 'verified')
})

test('ST-02 invalid Solver candidate fails Validator and preserves committed state', async () => {
  const flow = new StatePlanningFlow()
  await initial(flow)
  const before = flow.state.getState()
  const result = await solve(flow, input(), plan => ({ ...plan, estimated_cost_cny: 205 }))
  const validation = await validate(flow, result.data.plan, constraints)
  assert.equal(validation.data.validation_status, 'invalid')
  assert.deepEqual(flow.state.getState(), before)
})

test('ST-03 a feasible constraint update commits a re-plan based on state', async () => {
  const flow = new StatePlanningFlow()
  await initial(flow)
  const args = input()
  args.constraints.budget_cny = 160
  const result = await solve(flow, args)
  assert.equal(result.success, true)
  await validate(flow, result.data.plan, { ...constraints, budget_cny: 160 })
  const state = flow.state.getState()
  assert.equal(state.version, 3)
  assert.equal(state.constraints.budget_cny, 160)
  assert.equal(state.currentPlan.plan_id, 'fixture-plan-v2-replan')
  assert.deepEqual(state.runtimeEvents.slice(-2).map(event => event.type), ['CONSTRAINT_UPDATED', 'PLAN_REPLANNED'])
})

test('ST-04 impossible constraint update rejects and keeps old plan', async () => {
  const flow = new StatePlanningFlow()
  await initial(flow)
  const before = flow.state.getState()
  const args = input()
  args.constraints.budget_cny = 20
  const result = await solve(flow, args)
  assert.equal(result.error.code, 'NO_FEASIBLE_PLAN')
  assert.deepEqual(flow.state.getState(), before)
  assert.equal(flow.state.getEvents().at(-1).type, 'CANDIDATE_REJECTED')
})

test('ST-05 REMOVE_MEAL sources existing_plan from State and commits one version', async () => {
  const flow = new StatePlanningFlow()
  await initial(flow)
  const before = flow.state.getState()
  const args = { ...input(), existing_plan: { plan_id: 'invented' },
    plan_changes: [{ type: 'REMOVE_MEAL', day: 2, meal: 'dinner' }] }
  let actualExistingPlan
  const result = await flow.solve(args, async effective => {
    actualExistingPlan = effective.existing_plan
    const plan = solvePlan(effective)
    return { success: true, data: { plan }, error: null }
  })
  assert.deepEqual(actualExistingPlan, before.currentPlan)
  await validate(flow, result.data.plan, before.constraints)
  const state = flow.state.getState()
  assert.equal(state.version, before.version + 1)
  assert.equal(state.currentPlan.days[1].meals.length, 1)
  assert.deepEqual(state.runtimeEvents.slice(-2).map(event => event.type), ['MEAL_REMOVED', 'PLAN_REPLANNED'])
})

test('ST-06 stale candidate is blocked and leaves current snapshot untouched', async () => {
  const flow = new StatePlanningFlow()
  await initial(flow)
  const old = flow.state.stagePlan(flow.state.createCandidate({ reason: 'old', eventType: 'PLAN_REPLANNED',
    constraints, inventory: inventoryItems, schedule: scheduleDays }), flow.state.getState().currentPlan)
  const newer = flow.state.stagePlan(flow.state.createCandidate({ reason: 'new', eventType: 'PLAN_REPLANNED',
    constraints, inventory: inventoryItems, schedule: scheduleDays }), flow.state.getState().currentPlan)
  flow.state.commitCandidate(newer, { valid: true, validation_status: 'verified', violations: [] })
  const before = flow.state.getState()
  assert.throws(() => flow.state.commitCandidate(old, { valid: true, validation_status: 'verified', violations: [] }),
    error => error instanceof StateError && error.code === 'STATE_VERSION_CONFLICT')
  assert.deepEqual(flow.state.getState(), before)
})

test('required price failure does not overwrite a committed plan', async () => {
  const flow = new StatePlanningFlow()
  await initial(flow)
  const before = flow.state.getState()
  const args = input()
  args.price_data = args.price_data.filter(item => item.ingredient_id !== 'chicken_breast')
  const result = await solve(flow, args)
  assert.equal(result.error.code, 'PRICE_NOT_FOUND')
  assert.deepEqual(flow.state.getState(), before)
})

test('an unvalidated Solver proposal is rejected at the turn boundary', async () => {
  const flow = new StatePlanningFlow()
  const before = flow.state.getState()
  const result = await solve(flow, input())
  assert.equal(result.success, true)
  flow.rejectPending()
  assert.deepEqual(flow.state.getState(), before)
  assert.equal(flow.state.getTraces().at(-1).reject_reason, 'VALIDATOR_NOT_RUN')
})

test('a mismatched Validator call can be corrected before commit', async () => {
  const flow = new StatePlanningFlow()
  const result = await solve(flow, input())
  const plan = result.data.plan
  await assert.rejects(() => validate(flow, plan, { ...constraints, budget_cny: 160 }),
    error => error instanceof StateError && error.code === 'CANDIDATE_VALIDATION_FAILED')
  assert.equal(flow.state.getState().version, 1)
  await validate(flow, plan, constraints)
  assert.equal(flow.state.getState().version, 2)
})

test('Validator may reorder JSON object fields without changing the proposal', async () => {
  const flow = new StatePlanningFlow()
  const result = await solve(flow, input())
  const reordered = Object.fromEntries(Object.entries(constraints).reverse())
  await validate(flow, result.data.plan, reordered)
  assert.equal(flow.state.getState().version, 2)
})
