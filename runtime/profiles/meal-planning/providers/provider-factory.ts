/** Fail-fast provider factory used by the Tool catalog composition root. */
import type { MealProviderConfig } from '../config/providers.ts'
import type { InventoryProvider } from './contracts/inventory-provider.ts'
import type { NutritionProvider } from './contracts/nutrition-provider.ts'
import type { PriceProvider } from './contracts/price-provider.ts'
import type { RecipeProvider } from './contracts/recipe-provider.ts'
import type { ScheduleProvider } from './contracts/schedule-provider.ts'
import { LocalInventoryProvider } from './local/local-inventory-provider.ts'
import { LocalNutritionProvider } from './local/local-nutrition-provider.ts'
import { LocalPriceProvider } from './local/local-price-provider.ts'
import { LocalRecipeProvider } from './local/local-recipe-provider.ts'
import { LocalScheduleProvider } from './local/local-schedule-provider.ts'
import { ProviderError } from './provider-error.ts'

export interface MealProviders {
  inventory: InventoryProvider
  recipes: RecipeProvider
  nutrition: NutritionProvider
  prices: PriceProvider
  schedule: ScheduleProvider
}

function requireLocal(providerName: keyof MealProviderConfig, provider: string): void {
  if (provider !== 'local') {
    throw new ProviderError('UNSUPPORTED_PROVIDER', `Unsupported ${providerName} provider: ${provider}`, {
      providerName,
      provider,
    })
  }
}

export function createMealProviders(config: Readonly<MealProviderConfig>): MealProviders {
  const providerNames: Array<keyof MealProviderConfig> = [
    'inventory', 'recipes', 'nutrition', 'prices', 'schedule',
  ]
  for (const providerName of providerNames) requireLocal(providerName, config[providerName])
  return {
    inventory: new LocalInventoryProvider(),
    recipes: new LocalRecipeProvider(),
    nutrition: new LocalNutritionProvider(),
    prices: new LocalPriceProvider(),
    schedule: new LocalScheduleProvider(),
  }
}
