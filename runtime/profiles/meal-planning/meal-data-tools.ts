/** Read-only Meal Agent tools backed by deterministic local V1 fixtures. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ingredientNutrition,
  ingredientPrices,
  inventoryItems,
  recipes,
  scheduleDays,
} from './meal-fixtures.ts'
import {
  mealFailure,
  mealResultSchema,
  mealSuccess,
  renderMealResult,
} from './meal-tool-contract.ts'

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
    allergens: { type: 'array', items: { type: 'string' }, required: true },
    nutrition: { ...nutritionSchema, required: true },
  },
} as const

export const getInventoryTool = defineTool({
  name: 'get_inventory',
  description: 'Return the ingredients currently available to the user.',
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
    return mealSuccess({ items: inventoryItems.map(item => ({ ...item })) })
  },
})

export const searchRecipesTool = defineTool({
  name: 'search_recipes',
  description: 'Search deterministic local recipe candidates that match ingredients, allergens, cooking time, and an optional text query.',
  parameters: {
    query: { type: 'string', description: 'Optional recipe name, id, or ingredient text.' },
    max_cook_minutes: { type: 'integer', description: 'Maximum allowed cooking time.' },
    include_ingredients: { type: 'array', items: { type: 'string' }, description: 'Ingredients that every result must include.' },
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
    const included = args.include_ingredients ?? []
    const excluded = new Set(args.exclude_allergens ?? [])
    const limit = Math.max(0, args.limit ?? 10)

    const matches = recipes.filter((recipe) => {
      const searchable = `${recipe.recipe_id} ${recipe.name} ${recipe.ingredients.join(' ')}`.toLowerCase()
      return (!query || searchable.includes(query))
        && (args.max_cook_minutes === undefined || recipe.cook_minutes <= args.max_cook_minutes)
        && included.every(ingredient => recipe.ingredients.includes(ingredient))
        && recipe.allergens.every(allergen => !excluded.has(allergen))
    }).slice(0, limit)

    return mealSuccess({ recipes: matches.map(recipe => ({ ...recipe })) })
  },
})

export const getNutritionTool = defineTool({
  name: 'get_nutrition',
  description: 'Return deterministic nutrition facts for known ingredient ids or recipe ids.',
  parameters: {
    item_type: { type: 'string', enum: ['ingredient', 'recipe'], required: true },
    item_ids: { type: 'array', items: { type: 'string' }, required: true },
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
    const catalog = args.item_type === 'ingredient'
      ? ingredientNutrition
      : recipes.map(recipe => ({
          item_id: recipe.recipe_id,
          item_type: 'recipe' as const,
          basis: `${recipe.servings} serving`,
          ...recipe.nutrition,
        }))
    const found = args.item_ids
      .map(itemId => catalog.find(item => item.item_id === itemId))
      .filter(item => item !== undefined)
    const missing = args.item_ids.filter(itemId => !found.some(item => item.item_id === itemId))

    if (missing.length > 0) {
      return mealFailure('NUTRITION_NOT_FOUND', `No ${args.item_type} nutrition fixture for: ${missing.join(', ')}`)
    }
    return mealSuccess({ items: found })
  },
})

export const getPricesTool = defineTool({
  name: 'get_prices',
  description: 'Return deterministic CNY package prices and stock state for known ingredient ids.',
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
    const found = args.ingredient_ids
      .map(ingredientId => ingredientPrices.find(price => price.ingredient_id === ingredientId))
      .filter(price => price !== undefined)
    const missing = args.ingredient_ids.filter(ingredientId => !found.some(price => price.ingredient_id === ingredientId))

    if (missing.length > 0) {
      return mealFailure('PRICE_NOT_FOUND', `No price fixture for: ${missing.join(', ')}`)
    }
    return mealSuccess({ prices: found })
  },
})

export const getScheduleTool = defineTool({
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
    if (days < 1 || days > scheduleDays.length) {
      return mealFailure('SCHEDULE_RANGE_UNAVAILABLE', `The V1 fixture supports 1-${scheduleDays.length} days.`)
    }
    return mealSuccess({ days: scheduleDays.slice(0, days).map(day => ({ ...day })) })
  },
})
