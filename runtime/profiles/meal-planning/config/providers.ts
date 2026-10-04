/** Provider selection used during Meal Tool catalog initialization. */
export interface MealProviderConfig {
  inventory: string
  recipes: string
  nutrition: string
  prices: string
  schedule: string
}

export const localProviderConfig: Readonly<MealProviderConfig> = {
  inventory: 'local',
  recipes: 'local',
  nutrition: 'local',
  prices: 'local',
  schedule: 'local',
}
