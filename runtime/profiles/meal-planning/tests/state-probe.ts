/** Probe the scoped State runtime through DSH's real Tool registry. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { ingredientPrices, inventoryItems, recipes, scheduleDays } from '../meal-fixtures.ts'
import { stateFlowForAgent } from '../meal-state-runtime.ts'
import type { MealPlan, PlanningInput } from '../meal-plan-types.ts'

export const name = 'meal-state-probe'
export const inject = ['agents', 'tools']

const constraints = { days: 3, budget_cny: 180, min_daily_protein_g: 120, max_cook_minutes: 30 }
type Agent = Awaited<ReturnType<Context['agents']['create']>>['agent']
type Envelope<T> = { success: boolean, data: T, error: { code: string } | null }

function input(): PlanningInput {
  return { constraints: { ...constraints }, inventory: structuredClone(inventoryItems),
    candidate_recipes: structuredClone(recipes),
    nutrition_data: recipes.map(recipe => ({ item_id: recipe.recipe_id, item_type: 'recipe',
      basis: '1 serving', amount: 1, unit: 'serving', ...recipe.nutrition })),
    price_data: structuredClone(ingredientPrices), schedule: structuredClone(scheduleDays) }
}

async function call<T>(ctx: Context, agent: Agent, name: string, args: unknown): Promise<Envelope<T>> {
  const callId = randomUUID() as Parameters<Context['tools']['execute']>[0]['callId']
  const result = await ctx.tools.execute({ callId, name, arguments: args, agent,
    signal: new AbortController().signal })
  if (result.isError) throw new Error(`${name}: ${result.error.message}`)
  return result.value as Envelope<T>
}

/** Check registration, initial commit, State-sourced re-plan, and rejection. */
export function apply(ctx: Context): void {
  const ready = ctx.get('appReady')
  const exit = ctx.get('appExit')
  if (!ready || !exit) throw new Error('State probe requires app readiness and exit services')
  const run = async () => {
    const sessionId = randomUUID() as Parameters<Context['agents']['create']>[0]['sessionId']
    const handle = await ctx.agents.create({ sessionId,
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    try {
      const flow = stateFlowForAgent(handle.agent)
      if (!flow) throw new Error('Agent state was not installed')
      const scoped = ctx.tools.get('solve_meal_plan', handle.agent)
      const global = ctx.tools.get('solve_meal_plan')
      if (!scoped || !global || scoped === global
        || JSON.stringify(scoped.parameters) !== JSON.stringify(global.parameters)
        || JSON.stringify(scoped.output.schema) !== JSON.stringify(global.output.schema)) {
        throw new Error('Scoped Tool does not preserve the frozen schema')
      }
      const first = await call<{ plan: MealPlan }>(ctx, handle.agent, 'solve_meal_plan', input())
      if (!first.success) throw new Error(`Initial Solver failed: ${first.error?.code}`)
      const validation = await call<{ valid: boolean, validation_status: string }>(ctx, handle.agent,
        'validate_meal_plan', { plan: first.data.plan, constraints })
      const committed = flow.state.getState()
      if (!validation.data.valid || committed.version !== 2 || committed.planValidationStatus !== 'verified') {
        throw new Error('Initial plan was not committed')
      }
      const changed = await call<{ plan: MealPlan }>(ctx, handle.agent, 'solve_meal_plan', {
        ...input(), existing_plan: { plan_id: 'invented' },
        plan_changes: [{ type: 'REMOVE_MEAL', day: 2, meal: 'dinner' }],
      })
      if (!changed.success) throw new Error(`Re-plan failed: ${changed.error?.code}`)
      await call(ctx, handle.agent, 'validate_meal_plan', { plan: changed.data.plan, constraints })
      const after = flow.state.getState()
      if (after.version !== 3 || after.currentPlan?.days[1]?.meals.length !== 1) {
        throw new Error('State-sourced REMOVE_MEAL was not committed')
      }
      const impossible = await call(ctx, handle.agent, 'solve_meal_plan', {
        ...input(), constraints: { ...constraints, budget_cny: 20 },
      })
      if (impossible.success || impossible.error?.code !== 'NO_FEASIBLE_PLAN'
        || flow.state.getState().version !== 3) {
        throw new Error('No-solution state guard failed')
      }
      process.stdout.write(`MEAL_STATE_PROFILE_OK ${JSON.stringify({ version: after.version,
        events: after.runtimeEvents.map(event => event.type), rejected: flow.state.getEvents().at(-1)?.type,
        schemaUnchanged: true })}\n`, () => exit(0))
    } finally {
      await handle.dispose()
    }
  }
  ctx.effect(() => ready.onReady(() => { void run().catch((error: unknown) => {
    process.stderr.write(`MEAL_STATE_PROFILE_ERROR ${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  }) }), 'State registry probe')
}
