/** Profile-level DSH prompt guidance for choosing Meal Tools and reporting results. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'meal-agent-guidance'
export const inject = ['systemPrompt']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'meal-tool-selection',
    order: 100,
    text: [
      'For a direct named ingredient price or nutrition question, call only its matching Tool with only the requested item. For a recipe-only search, call search_recipes; do not fetch inventory or prices unless the user needs them.',
      'For a meal plan, first obtain inventory, schedule, candidate recipes, recipe nutrition, and prices for every candidate ingredient. Pass their data to solve_meal_plan without inventing missing values. Pass the entire resulting Plan and constraints to validate_meal_plan.',
      'A Solver Plan has verification_status unverified until the Validator returns validation_status verified. It is the first feasible plan, not a proven cheapest or optimal plan. Report ingredient usage, purchases, cost, and nutrition only from Tool results. Do not make numeric claims for untested portion changes or alternatives.',
      'On missing required data, explain the missing item and do not claim a completed plan. On NO_FEASIBLE_PLAN, describe ONLY the Tool error.conflicts categories as proven causes. Do not infer another independent blocker, an exact minimum price, a health threshold, or any unsupported fact.',
    ].join('\n'),
  }), 'meal Tool selection guidance')
}
