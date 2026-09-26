/**
 * Compatibility entry point for the Meal Profile's native V1 Tool catalog.
 * The Cordis patch keeps this historical filename while the implementation is
 * split into data and planning modules.
 */
import type { Context } from '@deepseek-ai/cordis'
import { mealTools } from './meal-tools.ts'

export const name = 'meal-planning-tools'
export const inject = ['tools']

/** Register the complete deterministic V1 Tool catalog. */
export function apply(ctx: Context): void {
  for (const tool of mealTools) ctx.tools.register(tool)
}
