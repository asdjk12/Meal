/** Local inventory adapter backed by the deterministic V1 Fixture. */
import { inventoryItems } from '../../meal-fixtures.ts'
import type { InventoryData, InventoryProvider } from '../contracts/inventory-provider.ts'

export class LocalInventoryProvider implements InventoryProvider {
  getInventory(): InventoryData {
    return { items: inventoryItems.map(item => ({ ...item })) }
  }
}
