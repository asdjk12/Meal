/** DSH Solver and Validator Tools for the local V0.2 candidate contract. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mealFailure, mealResultSchema, mealSuccess, renderMealResult } from './meal-tool-contract.ts'
import {
  constraintsSchema, inventoryItemSchema, nutritionItemSchema, planChangeSchema,
  planSchema, priceItemSchema, recipeSchema, scheduleDaySchema, violationSchema,
} from './meal-plan-schemas.ts'
import { checkPlanningInput, diagnoseNoPlan, replanSummary, solvePlan } from './meal-solver.ts'
import type { MealPlan, PlanConstraints, PlanningInput } from './meal-plan-types.ts'
import { validatePlan } from './meal-validator.ts'

export const solveMealPlanTool = defineTool({
  name: 'solve_meal_plan',
  description: 'Solve only after get_inventory, get_schedule, search_recipes, get_nutrition for ALL candidate recipe ids, and get_prices for ALL candidate ingredient ids succeed. Pass those returned arrays unchanged. Never invent missing prices or nutrition. Use existing_plan plus plan_changes REMOVE_MEAL for a canceled meal. The returned Plan is unverified until validate_meal_plan checks it. This Tool returns the first feasible plan, NOT the cheapest plan. Quote ingredient_usage, grocery_list, and estimated_cost_cny from the Plan; do not recalculate them in model text. On NO_FEASIBLE_PLAN explain ONLY error.conflicts; never infer another independent blocker or an exact minimum budget.',
  parameters: {
    constraints: { ...constraintsSchema, required: true },
    inventory: { type: 'array', items: inventoryItemSchema, required: true },
    candidate_recipes: { type: 'array', items: recipeSchema, required: true },
    nutrition_data: { type: 'array', items: nutritionItemSchema, required: true },
    price_data: { type: 'array', items: priceItemSchema, required: true },
    schedule: { type: 'array', items: scheduleDaySchema, required: true },
    existing_plan: planSchema,
    plan_changes: { type: 'array', items: planChangeSchema },
  },
  output: {
    schema: mealResultSchema({
      type: 'object', additionalProperties: false,
      properties: {
        plan: { ...planSchema, required: true },
        replan_summary: {
          type: 'object', required: true, additionalProperties: false,
          properties: {
            unchanged_meals: { type: 'integer', required: true },
            modified_meals: { type: 'integer', required: true },
            removed_meals: { type: 'integer', required: true },
          },
        },
      },
    }),
    render: renderMealResult,
  },
  async execute(args) {
    const input = args as PlanningInput
    const check = checkPlanningInput(input)
    if (check.missing.length > 0) {
      return mealFailure('MISSING_REQUIRED_INPUT', `Planning data missing: ${check.missing.join(', ')}`, false, check.missing)
    }
    if (check.invalid.length > 0) {
      return mealFailure('INPUT_DATA_MISMATCH', `Planning data differs from current local Tool fixtures: ${check.invalid.join(', ')}`)
    }
    if (input.plan_changes?.length && !input.existing_plan) {
      return mealFailure('INVALID_PLAN_CHANGE', 'A plan change requires existing_plan.')
    }
    const plan = solvePlan(input)
    if (!plan) {
      const conflicts = diagnoseNoPlan(input)
      return mealFailure('NO_FEASIBLE_PLAN', `No local plan satisfies the hard constraints. Confirmed conflict categories: ${conflicts.join(', ')}.`, false, undefined, conflicts)
    }
    return mealSuccess({ plan, replan_summary: replanSummary(input.existing_plan, plan) })
  },
})

export const validateMealPlanTool = defineTool({
  name: 'validate_meal_plan',
  description: 'Independently verify the full Solver plan against hard constraints and current trusted local recipe, pantry, price, and schedule facts. Pass the entire plan, not its id. A Solver result is not verified until this Tool returns validation_status verified; never claim completion for invalid or unverified output.',
  parameters: {
    plan: { ...planSchema, required: true },
    constraints: { ...constraintsSchema, required: true },
  },
  output: {
    schema: mealResultSchema({
      type: 'object', additionalProperties: false,
      properties: {
        valid: { type: 'boolean', required: true },
        validation_status: { type: 'string', enum: ['verified', 'unverified', 'invalid'], required: true },
        checks: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              constraint: { type: 'string', required: true },
              passed: { type: 'boolean', required: true },
            },
          },
        },
        violations: { type: 'array', items: violationSchema, required: true },
      },
    }),
    render: renderMealResult,
  },
  async execute(args) {
    if (!args.plan || !args.constraints || !Array.isArray(args.plan.days)
      || !Array.isArray(args.plan.ingredient_usage) || !Array.isArray(args.plan.grocery_list)) {
      return mealFailure('VALIDATION_ERROR', 'A complete plan and hard constraints are required.')
    }
    return mealSuccess(validatePlan(args.plan as MealPlan, args.constraints as PlanConstraints))
  },
})
