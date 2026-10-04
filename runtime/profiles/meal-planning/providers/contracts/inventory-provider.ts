/** Inventory data seam shared by Tools and replaceable provider adapters. */
import type { InventoryItem } from '../../meal-plan-types.ts'

export interface InventoryData {
  items: InventoryItem[]
}

export interface InventoryProvider {
  getInventory(): InventoryData | Promise<InventoryData>
}
