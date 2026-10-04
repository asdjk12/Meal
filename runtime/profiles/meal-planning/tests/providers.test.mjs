/** Provider contract tests exercise the replaceable data seam without DSH. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inventoryItems } from '../meal-fixtures.ts'
import { LocalInventoryProvider } from '../providers/local/local-inventory-provider.ts'
import { LocalNutritionProvider } from '../providers/local/local-nutrition-provider.ts'
import { LocalPriceProvider } from '../providers/local/local-price-provider.ts'
import { LocalRecipeProvider } from '../providers/local/local-recipe-provider.ts'
import { LocalScheduleProvider } from '../providers/local/local-schedule-provider.ts'
import { ProviderError } from '../providers/provider-error.ts'
import { localProviderConfig } from '../config/providers.ts'
import { createMealProviders } from '../providers/provider-factory.ts'

test('LocalInventoryProvider returns deterministic isolated inventory data', async () => {
  const provider = new LocalInventoryProvider()
  const first = await provider.getInventory()
  const second = await provider.getInventory()

  assert.deepEqual(first, { items: inventoryItems })
  assert.deepEqual(second, first)
  assert.notStrictEqual(first.items, inventoryItems)

  first.items[0].quantity = 0
  assert.equal(inventoryItems[0].quantity, 300)
  assert.equal((await provider.getInventory()).items[0].quantity, 300)
})

test('LocalRecipeProvider applies canonical filters and isolates recipe records', async () => {
  const provider = new LocalRecipeProvider()
  const matches = await provider.searchRecipes({
    ingredientIds: ['chicken_breast'],
    excludedAllergens: ['milk'],
    maxCookMinutes: 25,
    limit: 10,
  })

  assert.deepEqual(matches.map(recipe => recipe.recipe_id), ['chicken_broccoli_rice'])
  assert.deepEqual(await provider.searchRecipes({
    query: 'does-not-exist', ingredientIds: [], excludedAllergens: [], limit: 10,
  }), [])

  matches[0].ingredients.push('mutated')
  const reread = await provider.searchRecipes({
    ingredientIds: ['chicken_breast'], excludedAllergens: ['milk'], limit: 10,
  })
  assert.equal(reread[0].ingredients.includes('mutated'), false)
})

test('LocalRecipeProvider reports unknown canonical ingredients', () => {
  const provider = new LocalRecipeProvider()

  assert.throws(
    () => provider.searchRecipes({ ingredientIds: ['dragonfruit'], excludedAllergens: [], limit: 10 }),
    error => error instanceof ProviderError
      && error.code === 'DATA_NOT_FOUND'
      && assert.deepEqual(error.details.missing, ['dragonfruit']) === undefined,
  )
})

test('LocalNutritionProvider returns base facts without amount conversion', async () => {
  const provider = new LocalNutritionProvider()
  const ingredient = await provider.getNutritionBase('ingredient', 'chicken_breast')
  const recipe = await provider.getNutritionBase('recipe', 'chicken_omelette')

  assert.deepEqual(ingredient, {
    item_id: 'chicken_breast', item_type: 'ingredient', basis: '100 g',
    calories_kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6,
  })
  assert.equal(recipe.basis, '1 serving')
  assert.equal(recipe.protein_g, 62)
  assert.equal('amount' in ingredient, false)
  assert.equal('unit' in ingredient, false)
})

test('LocalNutritionProvider reports an unknown nutrition item', () => {
  const provider = new LocalNutritionProvider()

  assert.throws(
    () => provider.getNutritionBase('ingredient', 'dragonfruit'),
    error => error instanceof ProviderError
      && error.code === 'DATA_NOT_FOUND'
      && assert.deepEqual(error.details.missing, ['dragonfruit']) === undefined,
  )
})

test('LocalPriceProvider supports single and batch price queries', async () => {
  const provider = new LocalPriceProvider()
  const single = await provider.getPrices(['eggs'])
  const batch = await provider.getPrices(['eggs', 'tofu'])

  assert.deepEqual(single.map(price => price.ingredient_id), ['eggs'])
  assert.deepEqual(batch.map(price => price.ingredient_id), ['eggs', 'tofu'])
  single[0].price_cny = 0
  assert.equal((await provider.getPrices(['eggs']))[0].price_cny, 12)
})

test('LocalPriceProvider rejects missing prices instead of treating them as zero', () => {
  const provider = new LocalPriceProvider()

  assert.throws(
    () => provider.getPrices(['eggs', 'dragonfruit']),
    error => error instanceof ProviderError
      && error.code === 'DATA_NOT_FOUND'
      && assert.deepEqual(error.details.missing, ['dragonfruit']) === undefined,
  )
})

test('LocalScheduleProvider returns the requested deterministic window', async () => {
  const provider = new LocalScheduleProvider()
  const schedule = await provider.getSchedule({ days: 2 })

  assert.deepEqual(schedule.days.map(day => day.day), [1, 2])
  schedule.days[0].slots[0].available_minutes = 0
  assert.equal((await provider.getSchedule({ days: 1 })).days[0].slots[0].available_minutes, 30)
})

test('LocalScheduleProvider reports an unsupported window', () => {
  const provider = new LocalScheduleProvider()

  assert.throws(
    () => provider.getSchedule({ days: 4 }),
    error => error instanceof ProviderError
      && error.code === 'INVALID_PROVIDER_QUERY'
      && error.details.maxDays === 3,
  )
})

test('Provider factory creates the configured local adapters', () => {
  const providers = createMealProviders(localProviderConfig)

  assert.ok(providers.inventory instanceof LocalInventoryProvider)
  assert.ok(providers.recipes instanceof LocalRecipeProvider)
  assert.ok(providers.nutrition instanceof LocalNutritionProvider)
  assert.ok(providers.prices instanceof LocalPriceProvider)
  assert.ok(providers.schedule instanceof LocalScheduleProvider)
})

test('Provider factory fails fast instead of falling back for an unknown provider', () => {
  assert.throws(
    () => createMealProviders({ ...localProviderConfig, prices: 'api' }),
    error => error instanceof ProviderError
      && error.code === 'UNSUPPORTED_PROVIDER'
      && error.details.provider === 'api'
      && error.details.providerName === 'prices',
  )
})
