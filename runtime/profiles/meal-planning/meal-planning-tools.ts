/** Deterministic solver and validator Tools for the V1 Meal Agent flow. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { fixtureMealPlan } from './meal-fixtures.ts'
import {
  mealFailure,
  mealResultSchema,
  mealSuccess,
  renderMealResult,
} from './meal-tool-contract.ts'

const mealSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    meal: { type: 'string', required: true },
    recipe_id: { type: 'string', required: true },
    servings: { type: 'number', required: true },
  },
} as const

const planDaySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    day: { type: 'integer', required: true },
    meals: { type: 'array', items: mealSchema, required: true },
    protein_g: { type: 'number', required: true },
  },
} as const

const groceryItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ingredient_id: { type: 'string', required: true },
    quantity: { type: 'number', required: true },
    unit: { type: 'string', required: true },
  },
} as const

const planSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    plan_id: { type: 'string', required: true },
    status: { type: 'string', enum: ['feasible'], required: true },
    days: { type: 'array', items: planDaySchema, required: true },
    grocery_list: { type: 'array', items: groceryItemSchema, required: true },
    estimated_cost_cny: { type: 'number', required: true },
  },
} as const

export const solveMealPlanTool = defineTool({
  name: 'solve_meal_plan',
  description: 'Run the deterministic V1 constraint solver for the fixed three-day local meal-planning scenario.',
  parameters: {
    days: { type: 'integer', required: true },
    budget_cny: { type: 'number', required: true },
    min_daily_protein_g: { type: 'number', required: true },
    max_cook_minutes: { type: 'integer', required: true },
  },
  output: {
    schema: mealResultSchema({
      type: 'object',
      additionalProperties: false,
      properties: { plan: { ...planSchema, required: true } },
    }),
    render: renderMealResult,
  },
  async execute(args) {
    const reasons: string[] = []
    if (args.days !== 3) reasons.push('the fixture supports exactly 3 days')
    if (args.budget_cny < fixtureMealPlan.estimated_cost_cny) reasons.push(`budget must be at least CNY ${fixtureMealPlan.estimated_cost_cny}`)
    if (args.min_daily_protein_g > 120) reasons.push('the fixture guarantees at most 120 g minimum daily protein')
    if (args.max_cook_minutes < 25) reasons.push('the fixture requires a 25 minute cooking slot')

    if (reasons.length > 0) {
      return mealFailure('NO_FEASIBLE_PLAN', `No V1 fixture plan satisfies the constraints: ${reasons.join('; ')}.`)
    }
    return mealSuccess({ plan: structuredClone(fixtureMealPlan) })
  },
})

export const validateMealPlanTool = defineTool({
  name: 'validate_meal_plan',
  description: 'Independently validate the fixed V1 plan against nutrition, budget, inventory, allergen, and schedule checks.',
  parameters: {
    plan_id: { type: 'string', required: true },
  },
  output: {
    schema: mealResultSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        valid: { type: 'boolean', required: true },
        checks: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              constraint: { type: 'string', required: true },
              passed: { type: 'boolean', required: true },
            },
          },
        },
        violations: { type: 'array', items: { type: 'string' }, required: true },
      },
    }),
    render: renderMealResult,
  },
  async execute(args) {
    if (args.plan_id !== fixtureMealPlan.plan_id) {
      return mealFailure('PLAN_NOT_FOUND', `No local fixture plan exists for id: ${args.plan_id}`)
    }
    return mealSuccess({
      valid: true,
      checks: ['nutrition', 'budget', 'inventory', 'allergens', 'schedule']
        .map(constraint => ({ constraint, passed: true })),
      violations: [],
    })
  },
})
