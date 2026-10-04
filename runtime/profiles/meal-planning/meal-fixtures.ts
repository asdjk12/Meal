/**
 * Deterministic local data used by the V1 Meal Agent Tool Calling demo.
 * The fixture models the three-day scenario from the project background.
 */

export const inventoryItems = [
  { ingredient: 'chicken_breast', quantity: 300, unit: 'g' },
  { ingredient: 'eggs', quantity: 6, unit: 'count' },
  { ingredient: 'broccoli', quantity: 1, unit: 'count' },
  { ingredient: 'milk', quantity: 500, unit: 'ml' },
]

export const recipes = [
  {
    recipe_id: 'chicken_broccoli_rice',
    name: 'Chicken Broccoli Rice',
    servings: 1,
    cook_minutes: 25,
    ingredients: ['chicken_breast', 'broccoli', 'rice'],
    ingredient_amounts: [
      { ingredient_id: 'chicken_breast', quantity: 175, unit: 'g' },
      { ingredient_id: 'broccoli', quantity: 0.5, unit: 'count' },
      { ingredient_id: 'rice', quantity: 125, unit: 'g' },
    ],
    allergens: [],
    nutrition: { calories_kcal: 620, protein_g: 58, carbs_g: 64, fat_g: 14 },
  },
  {
    recipe_id: 'chicken_omelette',
    name: 'Chicken Omelette',
    servings: 1,
    cook_minutes: 20,
    ingredients: ['chicken_breast', 'eggs', 'milk'],
    ingredient_amounts: [
      { ingredient_id: 'chicken_breast', quantity: 175, unit: 'g' },
      { ingredient_id: 'eggs', quantity: 2, unit: 'count' },
      { ingredient_id: 'milk', quantity: 125, unit: 'ml' },
    ],
    allergens: ['eggs', 'milk'],
    nutrition: { calories_kcal: 590, protein_g: 62, carbs_g: 12, fat_g: 31 },
  },
  {
    recipe_id: 'tofu_egg_bowl',
    name: 'Tofu Egg Bowl',
    servings: 1,
    cook_minutes: 20,
    ingredients: ['tofu', 'eggs', 'broccoli', 'rice'],
    ingredient_amounts: [
      { ingredient_id: 'tofu', quantity: 200, unit: 'g' },
      { ingredient_id: 'eggs', quantity: 1, unit: 'count' },
      { ingredient_id: 'broccoli', quantity: 0.5, unit: 'count' },
      { ingredient_id: 'rice', quantity: 125, unit: 'g' },
    ],
    allergens: ['eggs', 'soy'],
    nutrition: { calories_kcal: 610, protein_g: 62, carbs_g: 58, fat_g: 19 },
  },
]

export const ingredientNutrition = [
  { item_id: 'chicken_breast', item_type: 'ingredient' as const, basis: '100 g', calories_kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
  { item_id: 'eggs', item_type: 'ingredient' as const, basis: '1 count', calories_kcal: 72, protein_g: 6.3, carbs_g: 0.4, fat_g: 4.8 },
  { item_id: 'broccoli', item_type: 'ingredient' as const, basis: '100 g', calories_kcal: 35, protein_g: 2.4, carbs_g: 7.2, fat_g: 0.4 },
  { item_id: 'milk', item_type: 'ingredient' as const, basis: '100 ml', calories_kcal: 61, protein_g: 3.2, carbs_g: 4.8, fat_g: 3.3 },
  { item_id: 'rice', item_type: 'ingredient' as const, basis: '100 g dry', calories_kcal: 365, protein_g: 7.1, carbs_g: 80, fat_g: 0.7 },
  { item_id: 'tofu', item_type: 'ingredient' as const, basis: '100 g', calories_kcal: 144, protein_g: 17, carbs_g: 2.8, fat_g: 8.7 },
]

export const ingredientPrices = [
  { ingredient_id: 'chicken_breast', package_quantity: 500, package_unit: 'g', price_cny: 24, in_stock: true },
  { ingredient_id: 'eggs', package_quantity: 10, package_unit: 'count', price_cny: 12, in_stock: true },
  { ingredient_id: 'broccoli', package_quantity: 1, package_unit: 'count', price_cny: 6, in_stock: true },
  { ingredient_id: 'milk', package_quantity: 1000, package_unit: 'ml', price_cny: 11, in_stock: true },
  { ingredient_id: 'rice', package_quantity: 1000, package_unit: 'g', price_cny: 9, in_stock: true },
  { ingredient_id: 'tofu', package_quantity: 400, package_unit: 'g', price_cny: 6, in_stock: true },
]

export const scheduleDays = [
  { day: 1, slots: [{ meal: 'lunch', available_minutes: 30 }, { meal: 'dinner', available_minutes: 30 }] },
  { day: 2, slots: [{ meal: 'lunch', available_minutes: 25 }, { meal: 'dinner', available_minutes: 30 }] },
  { day: 3, slots: [{ meal: 'lunch', available_minutes: 30 }, { meal: 'dinner', available_minutes: 25 }] },
]

export const fixtureMealPlan = {
  plan_id: 'fixture-plan-v1',
  status: 'feasible' as const,
  days: [
    {
      day: 1,
      meals: [
        { meal: 'lunch', recipe_id: 'chicken_broccoli_rice', servings: 1 },
        { meal: 'dinner', recipe_id: 'chicken_omelette', servings: 1 },
      ],
      protein_g: 120,
    },
    {
      day: 2,
      meals: [
        { meal: 'lunch', recipe_id: 'tofu_egg_bowl', servings: 1 },
        { meal: 'dinner', recipe_id: 'chicken_omelette', servings: 1 },
      ],
      protein_g: 124,
    },
    {
      day: 3,
      meals: [
        { meal: 'lunch', recipe_id: 'chicken_broccoli_rice', servings: 1 },
        { meal: 'dinner', recipe_id: 'tofu_egg_bowl', servings: 1 },
      ],
      protein_g: 120,
    },
  ],
  grocery_list: [
    { ingredient_id: 'chicken_breast', quantity: 700, unit: 'g' },
    { ingredient_id: 'eggs', quantity: 6, unit: 'count' },
    { ingredient_id: 'rice', quantity: 500, unit: 'g' },
    { ingredient_id: 'tofu', quantity: 400, unit: 'g' },
  ],
  estimated_cost_cny: 92,
}
