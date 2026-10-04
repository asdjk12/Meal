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
import { ingredientAmountSchema } from './meal-plan-schemas.ts'

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

export const getInventoryTool = defineTool({
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
    return mealSuccess({ items: inventoryItems.map(item => ({ ...item })) })
  },
})

export const searchRecipesTool = defineTool({
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
    const knownIngredients = new Set(recipes.flatMap(recipe => recipe.ingredients))
    const included = (args.include_ingredients ?? []).map(value => value.trim().toLowerCase().replace(/[\s-]+/g, '_'))
    const unknown = included.filter(value => !knownIngredients.has(value))
    if (unknown.length > 0) {
      return mealFailure('INGREDIENT_NOT_FOUND', `Unknown ingredient: ${unknown.join(', ')}`)
    }
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

export const getPricesTool = defineTool({
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
