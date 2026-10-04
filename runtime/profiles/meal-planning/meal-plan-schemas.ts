/** JSON schemas shared by the DSH planning Tools and data Tool outputs. */
export const ingredientAmountSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    ingredient_id: { type: 'string', required: true },
    quantity: { type: 'number', required: true },
    unit: { type: 'string', required: true },
  },
} as const

export const inventoryItemSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    ingredient: { type: 'string', required: true },
    quantity: { type: 'number', required: true },
    unit: { type: 'string', required: true },
  },
} as const

export const nutritionValuesSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    calories_kcal: { type: 'number', required: true },
    protein_g: { type: 'number', required: true },
    carbs_g: { type: 'number', required: true },
    fat_g: { type: 'number', required: true },
  },
} as const

export const recipeSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    recipe_id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    servings: { type: 'integer', required: true },
    cook_minutes: { type: 'integer', required: true },
    ingredients: { type: 'array', items: { type: 'string' }, required: true },
    ingredient_amounts: { type: 'array', items: ingredientAmountSchema, required: true },
    allergens: { type: 'array', items: { type: 'string' }, required: true },
    nutrition: { ...nutritionValuesSchema, required: true },
  },
} as const

export const nutritionItemSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    item_id: { type: 'string', required: true },
    item_type: { type: 'string', enum: ['ingredient', 'recipe'], required: true },
    basis: { type: 'string', required: true },
    amount: { type: 'number', required: true },
    unit: { type: 'string', required: true },
    ...nutritionValuesSchema.properties,
  },
} as const

export const priceItemSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    ingredient_id: { type: 'string', required: true },
    package_quantity: { type: 'number', required: true },
    package_unit: { type: 'string', required: true },
    price_cny: { type: 'number', required: true },
    in_stock: { type: 'boolean', required: true },
  },
} as const

export const scheduleDaySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    day: { type: 'integer', required: true },
    slots: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          meal: { type: 'string', required: true },
          available_minutes: { type: 'integer', required: true },
        },
      },
    },
  },
} as const

export const constraintsSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    days: { type: 'integer', required: true },
    budget_cny: { type: 'number', required: true },
    min_daily_protein_g: { type: 'number', required: true },
    max_cook_minutes: { type: 'integer', required: true },
    required_ingredient_ids: { type: 'array', items: { type: 'string' } },
    excluded_ingredient_ids: { type: 'array', items: { type: 'string' } },
    exclude_allergens: { type: 'array', items: { type: 'string' } },
    allow_purchase: { type: 'boolean' },
  },
} as const

export const planMealSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    meal: { type: 'string', required: true },
    recipe_id: { type: 'string', required: true },
    servings: { type: 'number', required: true },
  },
} as const

export const planSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    plan_id: { type: 'string', required: true },
    status: { type: 'string', enum: ['feasible'], required: true },
    verification_status: { type: 'string', enum: ['unverified'], required: true },
    optimization_status: { type: 'string', enum: ['first_feasible'], required: true },
    days: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          day: { type: 'integer', required: true },
          meals: { type: 'array', items: planMealSchema, required: true },
          protein_g: { type: 'number', required: true },
        },
      },
    },
    ingredient_usage: { type: 'array', items: ingredientAmountSchema, required: true },
    grocery_list: { type: 'array', items: ingredientAmountSchema, required: true },
    estimated_cost_cny: { type: 'number', required: true },
  },
} as const

export const planChangeSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['REMOVE_MEAL'], required: true },
    day: { type: 'integer', required: true },
    meal: { type: 'string', required: true },
  },
} as const

export const violationSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    type: { type: 'string', required: true },
    expected: { type: 'json' },
    actual: { type: 'json' },
  },
} as const
