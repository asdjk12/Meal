/**
 * Boots inside the test Profile and verifies Meal Tools through the public
 * DSH Tool registry seam.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createHash } from 'node:crypto'
import { createGetPricesTool } from '../meal-data-tools.ts'
import type { PriceProvider } from '../providers/contracts/price-provider.ts'

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

const frozenDataToolContractHashes = {
  get_inventory: '283a8231de0f9afc44f47009049a86aaf3a62b09b63bd5164d4bfa97add49306',
  search_recipes: '261e280d9078f197b247697270b3ed385b88f8f580eafcaf1b46028629d59ea5',
  get_nutrition: '6163e88d2dc4397fe64799a0d609068b4f8d6958f67361e84675663f0f0d8600',
  get_prices: 'c5be917e48a96e3336826afa1603cdbd579ed4bb5ab0dacf8cd7069171a3a88d',
  get_schedule: '992680dcdc0ca6306c6bca895520e2754bf9fe523a32a492fb9dc125fb9a5936',
} as const

type JsonObject = Record<string, JsonValue>

function contractHash(tool: ReturnType<Context['tools']['get']>): string {
  if (!tool) throw new Error('Cannot hash a missing Tool')
  return createHash('sha256').update(JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    outputSchema: tool.output.schema,
  })).digest('hex')
}

function requireObject(value: JsonValue | undefined, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function requireArray(value: JsonValue | undefined, label: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
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
    exclude_allergens: [],
    limit: 10,
  })).result
  const nutritionResult = (await executeTool(ctx, 'get_nutrition', {
    item_type: 'recipe',
    item_ids: ['chicken_broccoli_rice', 'chicken_omelette', 'tofu_egg_bowl'],
  })).result
  const priceResult = (await executeTool(ctx, 'get_prices', {
    ingredient_ids: ['chicken_breast', 'eggs', 'broccoli', 'milk', 'rice', 'tofu'],
  })).result
  const scheduleResult = (await executeTool(ctx, 'get_schedule', { days: 3 })).result
  const recipeData = requireObject(recipeResult.data, 'search_recipes data')
  const nutritionData = requireObject(nutritionResult.data, 'get_nutrition data')
  const priceData = requireObject(priceResult.data, 'get_prices data')
  const scheduleData = requireObject(scheduleResult.data, 'get_schedule data')
  const constraints = { days: 3, budget_cny: 180, min_daily_protein_g: 120, max_cook_minutes: 30 }
  const planningInput = {
    constraints,
    inventory: value.data.items,
    candidate_recipes: requireArray(recipeData.recipes, 'candidate recipes'),
    nutrition_data: requireArray(nutritionData.items, 'recipe nutrition'),
    price_data: requireArray(priceData.prices, 'ingredient prices'),
    schedule: requireArray(scheduleData.days, 'schedule days'),
  }
  const solveResult = (await executeTool(ctx, 'solve_meal_plan', {
    ...planningInput,
  })).result
  const solveData = requireObject(solveResult.data, 'solve_meal_plan data')
  const plan = requireObject(solveData.plan, 'solve_meal_plan plan')
  const planId = plan.plan_id
  if (typeof planId !== 'string') throw new Error('solve_meal_plan returned an invalid plan id')
  const validateResult = (await executeTool(ctx, 'validate_meal_plan', {
    plan,
    constraints,
  })).result

  const validateData = requireObject(validateResult.data, 'validate_meal_plan data')
  if (!Array.isArray(recipeData.recipes) || recipeData.recipes.length !== 3
    || !Array.isArray(nutritionData.items) || nutritionData.items.length !== 3
    || !Array.isArray(priceData.prices) || priceData.prices.length !== 6
    || !Array.isArray(scheduleData.days) || scheduleData.days.length !== 3
    || planId !== 'fixture-plan-v2' || validateData.valid !== true
    || validateData.validation_status !== 'verified') {
    throw new Error('the deterministic V0.2 Tool flow returned unexpected data')
  }

  const normalizedSearch = (await executeTool(ctx, 'search_recipes', {
    include_ingredients: ['Chicken Breast'], max_cook_minutes: 30,
  })).result
  const measuredNutrition = (await executeTool(ctx, 'get_nutrition', {
    item_type: 'ingredient', item_ids: ['chicken_breast'], amount: 300, unit: 'g',
  })).result
  const searchItems = requireObject(normalizedSearch.data, 'normalized search data').recipes
  const nutritionItems = requireObject(measuredNutrition.data, 'measured nutrition data').items
  if (!Array.isArray(searchItems) || searchItems.length !== 2
    || !Array.isArray(nutritionItems) || nutritionItems.length !== 1
    || typeof nutritionItems[0] !== 'object' || nutritionItems[0] === null || Array.isArray(nutritionItems[0])
    || nutritionItems[0].protein_g !== 93) {
    throw new Error('search normalization or deterministic amount conversion failed')
  }

  let missingInputRejected = false
  try {
    await executeTool(ctx, 'solve_meal_plan', { constraints })
  } catch (error) {
    missingInputRejected = error instanceof Error && error.message.includes('missing required property')
  }
  if (!missingInputRejected) throw new Error('Solver accepted missing required planning data')

  const infeasibleResult = (await executeTool(ctx, 'solve_meal_plan', {
    ...planningInput,
    constraints: { ...constraints, budget_cny: 20, min_daily_protein_g: 200 },
  })).result
  const invalidPlanResult = (await executeTool(ctx, 'validate_meal_plan', {
    plan: { ...plan, estimated_cost_cny: 205 },
    constraints,
  })).result
  const infeasibleError = requireObject(infeasibleResult.error, 'infeasible plan error')
  const invalidData = requireObject(invalidPlanResult.data, 'invalid plan result')
  const violations = invalidData.violations
  if (infeasibleResult.success !== false || infeasibleError.code !== 'NO_FEASIBLE_PLAN'
    || invalidData.valid !== false || !Array.isArray(violations)
    || !violations.some(item => typeof item === 'object' && item !== null && !Array.isArray(item) && item.type === 'ESTIMATED_COST_MISMATCH')) {
    throw new Error('Meal planning failures do not use the V0.2 contract')
  }

  const expectedDataErrors: Array<[string, JsonObject, string]> = [
    ['search_recipes', { include_ingredients: ['dragonfruit'] }, 'INGREDIENT_NOT_FOUND'],
    ['get_nutrition', { item_type: 'ingredient', item_ids: ['dragonfruit'] }, 'NUTRITION_NOT_FOUND'],
    ['get_prices', { ingredient_ids: ['dragonfruit'] }, 'PRICE_NOT_FOUND'],
    ['get_schedule', { days: 4 }, 'SCHEDULE_RANGE_UNAVAILABLE'],
  ]
  for (const [toolName, args, expectedCode] of expectedDataErrors) {
    const failed = (await executeTool(ctx, toolName, args)).result
    const error = requireObject(failed.error, `${toolName} expected error`)
    if (failed.success !== false || error.code !== expectedCode) {
      throw new Error(`${toolName} changed its V0.2 error semantics`)
    }
  }

  const fakePriceProvider: PriceProvider = {
    getPrices: ingredientIds => ingredientIds.map(ingredient_id => ({
      ingredient_id,
      package_quantity: 1,
      package_unit: 'count',
      price_cny: 99,
      in_stock: true,
    })),
  }
  const registeredPriceTool = ctx.tools.get('get_prices')
  if (!registeredPriceTool) throw new Error('get_prices is not registered')
  const fakePriceTool = createGetPricesTool(fakePriceProvider)
  const fakePriceValue = await fakePriceTool.execute({ ingredient_ids: ['eggs'] }, undefined as never) as JsonValue
  const fakePriceResult = requireObject(fakePriceValue, 'fake get_prices result')
  const fakePriceData = requireObject(fakePriceResult.data, 'fake get_prices data')
  const fakePrices = requireArray(fakePriceData.prices, 'fake prices')
  const fakeFirstPrice = requireObject(fakePrices[0], 'fake first price')
  if (registeredPriceTool.name !== fakePriceTool.name
    || JSON.stringify(registeredPriceTool.parameters) !== JSON.stringify(fakePriceTool.parameters)
    || JSON.stringify(registeredPriceTool.output.schema) !== JSON.stringify(fakePriceTool.output.schema)
    || fakeFirstPrice.price_cny !== 99) {
    throw new Error('PriceProvider could not be swapped behind the unchanged get_prices contract')
  }

  const contractHashes = Object.fromEntries(expectedToolNames.slice(0, 5).map((toolName) => {
    return [toolName, contractHash(ctx.tools.get(toolName))]
  }))
  for (const [toolName, expectedHash] of Object.entries(frozenDataToolContractHashes)) {
    if (contractHashes[toolName] !== expectedHash) {
      throw new Error(`${toolName} changed its frozen V0.2 public contract`)
    }
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
      validator: 'ESTIMATED_COST_MISMATCH',
    })}`,
    `MEAL_ADAPTER_SWAP_OK ${JSON.stringify({
      tool: fakePriceTool.name,
      provider: 'fake',
      priceCny: fakeFirstPrice.price_cny,
      registryChanged: false,
    })}`,
    `MEAL_DATA_CONTRACT_REGRESSION_OK ${JSON.stringify({
      tools: Object.keys(frozenDataToolContractHashes).length,
      errors: expectedDataErrors.length,
    })}`,
    '',
  ].join('\n')

  process.stdout.write(marker, () => process.emit('SIGTERM'))
}
