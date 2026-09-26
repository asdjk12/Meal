/**
 * Boots inside the test Profile and verifies Meal Tools through the public
 * DSH Tool registry seam.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export const name = 'meal-inventory-tool-test-probe'
export const inject = ['tools']

const expectedToolNames = [
  'get_inventory',
  'search_recipes',
  'get_nutrition',
  'get_prices',
  'get_schedule',
  'solve_meal_plan',
  'validate_meal_plan',
] as const

type JsonObject = Record<string, JsonValue>

function requireObject(value: JsonValue | undefined, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

async function executeTool(
  ctx: Context,
  toolName: string,
  args: JsonObject,
): Promise<{ result: JsonObject, rendered: boolean }> {
  const tool = ctx.tools.get(toolName)
  if (!tool) throw new Error(`${toolName} is not registered`)

  const value = await tool.execute(args, undefined as never) as JsonValue
  const result = requireObject(value, `${toolName} result`)
  requireObject(result.data, `${toolName} data`)
  requireObject(result.metadata, `${toolName} metadata`)

  const content = tool.output.render(args, value)
  const rendered = content.length === 1
    && content[0]?.type === 'text'
    && content[0].text === JSON.stringify(value)
  if (!rendered) throw new Error(`${toolName} did not render its canonical result`)

  return { result, rendered }
}

/** Validate the shared result contract through the inventory tracer bullet. */
export async function apply(ctx: Context): Promise<void> {
  const missingTools = expectedToolNames.filter(toolName => !ctx.tools.get(toolName))
  if (missingTools.length > 0) {
    throw new Error(`Meal Tool catalog is incomplete: ${missingTools.join(', ')}`)
  }

  const tool = ctx.tools.get('get_inventory')
  if (!tool) throw new Error('get_inventory is not registered')

  const schema = tool.output.schema as {
    oneOf?: Array<{
      properties?: {
        success?: { const?: boolean }
        data?: { type?: string }
        error?: { type?: string }
        metadata?: { type?: string }
      }
    }>
  }
  const successSchema = schema.oneOf?.find(branch => branch.properties?.success?.const === true)
  if (successSchema?.properties?.data?.type !== 'object'
    || successSchema.properties.error?.type !== 'null'
    || successSchema.properties.metadata?.type !== 'object') {
    throw new Error('get_inventory does not expose the shared Meal Tool result schema')
  }

  const value = await tool.execute({}, undefined as never) as JsonValue
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || value.success !== true
    || value.error !== null
    || value.data === null
    || typeof value.data !== 'object'
    || Array.isArray(value.data)
    || !Array.isArray(value.data.items)) {
    throw new Error('get_inventory returned a non-contract value')
  }

  const content = tool.output.render({}, value)
  const rendered = content.length === 1
    && content[0]?.type === 'text'
    && content[0].text === JSON.stringify(value)

  if (value.data.items.length !== 4 || !rendered) {
    throw new Error('get_inventory returned an invalid model-visible result')
  }

  const recipeResult = (await executeTool(ctx, 'search_recipes', {
    max_cook_minutes: 30,
    include_ingredients: ['chicken_breast'],
    exclude_allergens: [],
    limit: 10,
  })).result
  const nutritionResult = (await executeTool(ctx, 'get_nutrition', {
    item_type: 'ingredient',
    item_ids: ['chicken_breast', 'milk'],
  })).result
  const priceResult = (await executeTool(ctx, 'get_prices', {
    ingredient_ids: ['rice', 'tofu'],
  })).result
  const scheduleResult = (await executeTool(ctx, 'get_schedule', { days: 3 })).result
  const solveResult = (await executeTool(ctx, 'solve_meal_plan', {
    days: 3,
    budget_cny: 180,
    min_daily_protein_g: 120,
    max_cook_minutes: 30,
  })).result
  const solveData = requireObject(solveResult.data, 'solve_meal_plan data')
  const plan = requireObject(solveData.plan, 'solve_meal_plan plan')
  const planId = plan.plan_id
  if (typeof planId !== 'string') throw new Error('solve_meal_plan returned an invalid plan id')
  const validateResult = (await executeTool(ctx, 'validate_meal_plan', {
    plan_id: planId,
  })).result

  const recipeData = requireObject(recipeResult.data, 'search_recipes data')
  const nutritionData = requireObject(nutritionResult.data, 'get_nutrition data')
  const priceData = requireObject(priceResult.data, 'get_prices data')
  const scheduleData = requireObject(scheduleResult.data, 'get_schedule data')
  const validateData = requireObject(validateResult.data, 'validate_meal_plan data')
  if (!Array.isArray(recipeData.recipes) || recipeData.recipes.length !== 2
    || !Array.isArray(nutritionData.items) || nutritionData.items.length !== 2
    || !Array.isArray(priceData.prices) || priceData.prices.length !== 2
    || !Array.isArray(scheduleData.days) || scheduleData.days.length !== 3
    || planId !== 'fixture-plan-v1'
    || validateData.valid !== true) {
    throw new Error('the deterministic V1 Tool flow returned unexpected data')
  }

  const infeasibleResult = (await executeTool(ctx, 'solve_meal_plan', {
    days: 3,
    budget_cny: 50,
    min_daily_protein_g: 120,
    max_cook_minutes: 30,
  })).result
  const unknownPlanResult = (await executeTool(ctx, 'validate_meal_plan', {
    plan_id: 'missing-plan',
  })).result
  const infeasibleError = requireObject(infeasibleResult.error, 'infeasible plan error')
  const unknownPlanError = requireObject(unknownPlanResult.error, 'unknown plan error')
  if (infeasibleResult.success !== false || infeasibleError.code !== 'NO_FEASIBLE_PLAN'
    || unknownPlanResult.success !== false || unknownPlanError.code !== 'PLAN_NOT_FOUND') {
    throw new Error('Meal planning failures do not use the shared error contract')
  }

  const marker = [
    `MEAL_TOOL_CATALOG_OK ${JSON.stringify({ names: expectedToolNames })}`,
    `MEAL_TOOL_CONTRACT_OK ${JSON.stringify({
      name: tool.name,
      items: value.data.items.length,
      rendered,
    })}`,
    `MEAL_TOOL_FLOW_OK ${JSON.stringify({
      calls: expectedToolNames.length,
      planId,
      valid: validateData.valid,
      rendered: true,
    })}`,
    `MEAL_TOOL_FAILURES_OK ${JSON.stringify({
      solver: infeasibleError.code,
      validator: unknownPlanError.code,
    })}`,
    '',
  ].join('\n')

  process.stdout.write(marker, () => process.emit('SIGTERM'))
}
