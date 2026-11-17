/** Bind one StatePlanningFlow to each DSH Agent through scoped Tool shadows. */
import type { Context } from '@deepseek-ai/cordis'
import type { MealPlan, PlanConstraints, PlanningInput } from './meal-plan-types.ts'
import { solveMealPlanTool, validateMealPlanTool } from './meal-planning-tools.ts'
import { StatePlanningFlow, type SolveResult, type ValidateResult } from './state/planning-flow.ts'

export const name = 'meal-state-runtime'
export const inject = ['agents', 'tools']

const flows = new WeakMap<object, StatePlanningFlow>()

export function stateFlowForAgent(agent: object): StatePlanningFlow | undefined {
  return flows.get(agent)
}

/** Keep public Tool schemas while sourcing re-planning and commit from State. */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    const flow = new StatePlanningFlow()
    flows.set(agent, flow)
    agent.ctx.tools.register({
      ...solveMealPlanTool,
      execute: (args, exec) => flow.solve(args as PlanningInput,
        effective => solveMealPlanTool.execute(effective, exec) as Promise<SolveResult>),
    })
    agent.ctx.tools.register({
      ...validateMealPlanTool,
      execute: (args, exec) => {
        const input = args as { plan: MealPlan, constraints: PlanConstraints }
        return flow.validate(input.plan, input.constraints,
          () => validateMealPlanTool.execute(args, exec) as Promise<ValidateResult>)
      },
    })
  })
  ctx.on('agent/disposed', ({ agent }) => { flows.delete(agent) })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') flows.get(agent)?.rejectPending()
  })
}
