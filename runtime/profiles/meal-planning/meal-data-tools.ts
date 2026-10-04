/** Read-only Meal Agent tools backed by injected data providers. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { localProviderConfig } from './config/providers.ts'
import {
  mealFailure,
  mealResultSchema,
  mealSuccess,
  renderMealResult,
} from './meal-tool-contract.ts'
import { ingredientAmountSchema } from './meal-plan-schemas.ts'
import type { InventoryProvider } from './providers/contracts/inventory-provider.ts'
import type { NutritionProvider } from './providers/contracts/nutrition-provider.ts'
import type { PriceProvider } from './providers/contracts/price-provider.ts'
import type { RecipeProvider } from './providers/contracts/recipe-provider.ts'
import type { ScheduleProvider } from './providers/contracts/schedule-provider.ts'
import { ProviderError } from './providers/provider-error.ts'
import { createMealProviders } from './providers/provider-factory.ts'

function missingDetails(error: ProviderError): string[] {
  return Array.isArray(error.details.missing)
    ? error.details.missing.filter(value => typeof value === 'string')
    : []
}

function unavailable(error: unknown, code: string, message: string) {
  if (!(error instanceof ProviderError)) throw error
  return mealFailure(code, message, error.code === 'DATA_SOURCE_UNAVAILABLE')
}

const inventoryItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ingredient: { type: 'string', required: true },
    quantity: { type: 'number', required: true },
    unit: { type: 'string', required: true },
  },
} as const

const nutritionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    calories_kcal: { type: 'number', required: true },
    protein_g: { type: 'number', required: true },
    carbs_g: { type: 'number', required: true },
    fat_g: { type: 'number', required: true },
  },
} as const

const recipeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    recipe_id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    servings: { type: 'integer', required: true },
    cook_minutes: { type: 'integer', required: true },
    ingredients: { type: 'array', items: { type: 'string' }, required: true },
    ingredient_amounts: { type: 'array', items: ingredientAmountSchema, required: true },
    allergens: { type: 'array', items: { type: 'string' }, required: true },
    nutrition: { ...nutritionSchema, required: true },
  },
} as const

export function createGetInventoryTool(provider: InventoryProvider) {
  return defineTool({
    name: 'get_inventory',
    description: 'Read current inventory only when the request needs inventory or meal planning. For a direct price or nutrition lookup of a named ingredient, do not call this tool.',
    parameters: {},
    output: {
      schema: mealResultSchema({
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', items: inventoryItemSchema, required: true },
        },
      }),
      render: renderMealResult,
    },
    async execute() {
      try {
        return mealSuccess(await provider.getInventory())
      } catch (error) {
        return unavailable(error, 'INVENTORY_UNAVAILABLE', 'Inventory data is unavailable.')
      }
    },
  })
}

export function createSearchRecipesTool(provider: RecipeProvider) {
  return defineTool({
    name: 'search_recipes',
    description: 'Search local recipe candidates by ingredient and filters. Use this alone for a recipe-only request; fetch inventory or prices only if asked. Ingredient filters accept chicken_breast, chicken breast, or Chicken Breast.',
    parameters: {
      query: { type: 'string', description: 'Optional recipe name, id, or ingredient text.' },
      max_cook_minutes: { type: 'integer', description: 'Maximum allowed cooking time.' },
      include_ingredients: { type: 'array', items: { type: 'string' }, description: 'Ingredient ids or display names; each result must include all of them.' },
      exclude_allergens: { type: 'array', items: { type: 'string' }, description: 'Allergens that no result may contain.' },
      limit: { type: 'integer', description: 'Maximum result count.', default: 10 },
    },
    output: {
      schema: mealResultSchema({
        type: 'object',
        additionalProperties: false,
        properties: {
          recipes: { type: 'array', items: recipeSchema, required: true },
        },
      }),
      render: renderMealResult,
    },
    async execute(args) {
      const query = args.query?.trim().toLowerCase()
      const included = (args.include_ingredients ?? []).map(value => value.trim().toLowerCase().replace(/[\s-]+/g, '_'))
      const limit = Math.max(0, args.limit ?? 10)

      try {
        const matches = await provider.searchRecipes({
          ...(query ? { query } : {}),
          ...(args.max_cook_minutes === undefined ? {} : { maxCookMinutes: args.max_cook_minutes }),
          ingredientIds: included,
          excludedAllergens: args.exclude_allergens ?? [],
          limit,
        })
        return mealSuccess({ recipes: matches })
      } catch (error) {
        if (error instanceof ProviderError && error.code === 'DATA_NOT_FOUND') {
          const missing = missingDetails(error)
          return mealFailure('INGREDIENT_NOT_FOUND', `Unknown ingredient: ${missing.join(', ')}`)
        }
        return unavailable(error, 'RECIPE_DATA_UNAVAILABLE', 'Recipe data is unavailable.')
      }
    },
  })
}

export function createGetNutritionTool(provider: NutritionProvider) {
  return defineTool({
    name: 'get_nutrition',
    description: 'Return recipe nutrition per serving or calculate ingredient nutrition for an explicit amount and unit. For 300 g chicken_breast, pass item_ids [chicken_breast], amount 300, unit g; use returned totals without model-side arithmetic.',
    parameters: {
      item_type: { type: 'string', enum: ['ingredient', 'recipe'], required: true },
      item_ids: { type: 'array', items: { type: 'string' }, required: true },
      amount: { type: 'number', description: 'Optional quantity for each requested item; use with unit.' },
      unit: { type: 'string', description: 'Unit for amount: g, ml, count, or serving.' },
    },
    output: {
      schema: mealResultSchema({
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                item_id: { type: 'string', required: true },
                item_type: { type: 'string', enum: ['ingredient', 'recipe'], required: true },
                basis: { type: 'string', required: true },
                amount: { type: 'number', required: true },
                unit: { type: 'string', required: true },
                calories_kcal: { type: 'number', required: true },
                protein_g: { type: 'number', required: true },
                carbs_g: { type: 'number', required: true },
                fat_g: { type: 'number', required: true },
              },
            },
          },
        },
      }),
      render: renderMealResult,
    },
    async execute(args) {
      if ((args.amount === undefined) !== (args.unit === undefined) || (args.amount !== undefined && args.amount <= 0)) {
        return mealFailure('INVALID_NUTRITION_AMOUNT', 'Provide a positive amount together with its unit.')
      }
      const found = []
      const missing = []
      for (const itemId of args.item_ids) {
        try {
          found.push(await provider.getNutritionBase(args.item_type, itemId))
        } catch (error) {
          if (error instanceof ProviderError && error.code === 'DATA_NOT_FOUND') missing.push(itemId)
          else return unavailable(error, 'NUTRITION_DATA_UNAVAILABLE', 'Nutrition data is unavailable.')
        }
      }

      if (missing.length > 0) {
        return mealFailure('NUTRITION_NOT_FOUND', `No ${args.item_type} nutrition fixture for: ${missing.join(', ')}`)
      }
      const items = []
      for (const item of found) {
        const match = /^(\d+)\s+(g|ml|count|serving)/.exec(item.basis)
        if (!match) return mealFailure('INVALID_NUTRITION_BASIS', `Unsupported basis for: ${item.item_id}`)
        const basisAmount = Number(match[1])
        const basisUnit = match[2]!
        const amount = args.amount ?? basisAmount
        const unit = args.unit ?? basisUnit
        if (unit !== basisUnit) return mealFailure('UNSUPPORTED_NUTRITION_UNIT', `${item.item_id} is measured in ${basisUnit}, not ${unit}.`)
        const factor = amount / basisAmount
        items.push({
          ...item, amount, unit,
          calories_kcal: Math.round(item.calories_kcal * factor * 100) / 100,
          protein_g: Math.round(item.protein_g * factor * 100) / 100,
          carbs_g: Math.round(item.carbs_g * factor * 100) / 100,
          fat_g: Math.round(item.fat_g * factor * 100) / 100,
        })
      }
      return mealSuccess({ items })
    },
  })
}

export function createGetPricesTool(provider: PriceProvider) {
  return defineTool({
    name: 'get_prices',
    description: 'Return local package prices for only the explicitly requested ingredient_ids. A direct price question needs this Tool alone; do not query inventory first.',
    parameters: {
      ingredient_ids: { type: 'array', items: { type: 'string' }, required: true },
    },
    output: {
      schema: mealResultSchema({
        type: 'object',
        additionalProperties: false,
        properties: {
          prices: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ingredient_id: { type: 'string', required: true },
                package_quantity: { type: 'number', required: true },
                package_unit: { type: 'string', required: true },
                price_cny: { type: 'number', required: true },
                in_stock: { type: 'boolean', required: true },
              },
            },
          },
        },
      }),
      render: renderMealResult,
    },
    async execute(args) {
      try {
        return mealSuccess({ prices: await provider.getPrices(args.ingredient_ids) })
      } catch (error) {
        if (error instanceof ProviderError && error.code === 'DATA_NOT_FOUND') {
          const missing = missingDetails(error)
          return mealFailure('PRICE_NOT_FOUND', `No price fixture for: ${missing.join(', ')}`)
        }
        return unavailable(error, 'PRICE_DATA_UNAVAILABLE', 'Price data is unavailable.')
      }
    },
  })
}

export function createGetScheduleTool(provider: ScheduleProvider) {
  return defineTool({
    name: 'get_schedule',
    description: 'Return the user cooking-time slots for the requested number of fixture days.',
    parameters: {
      days: { type: 'integer', description: 'Number of days to return.', default: 3 },
    },
    output: {
      schema: mealResultSchema({
        type: 'object',
        additionalProperties: false,
        properties: {
          days: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                day: { type: 'integer', required: true },
                slots: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      meal: { type: 'string', required: true },
                      available_minutes: { type: 'integer', required: true },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      render: renderMealResult,
    },
    async execute(args) {
      const days = args.days ?? 3
      try {
        return mealSuccess(await provider.getSchedule({ days }))
      } catch (error) {
        if (error instanceof ProviderError && error.code === 'INVALID_PROVIDER_QUERY') {
          return mealFailure('SCHEDULE_RANGE_UNAVAILABLE', `The V1 fixture supports ${error.details.minDays}-${error.details.maxDays} days.`)
        }
        return unavailable(error, 'SCHEDULE_DATA_UNAVAILABLE', 'Schedule data is unavailable.')
      }
    },
  })
}

const providers = createMealProviders(localProviderConfig)

export const getInventoryTool = createGetInventoryTool(providers.inventory)
export const searchRecipesTool = createSearchRecipesTool(providers.recipes)
export const getNutritionTool = createGetNutritionTool(providers.nutrition)
export const getPricesTool = createGetPricesTool(providers.prices)
export const getScheduleTool = createGetScheduleTool(providers.schedule)
