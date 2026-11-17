/** Runtime orchestration around the unchanged Solver and Validator Tool bodies. */
import type { MealPlan, PlanConstraints, PlanningInput } from '../meal-plan-types.ts'
import { isDeepStrictEqual } from 'node:util'
import { StateError } from './state-errors.ts'
import { StateManager } from './state-manager.ts'
import type { CandidateState, ValidationProof } from './state-types.ts'

export interface SolveResult {
  success: boolean
  data?: { plan?: MealPlan }
  error?: { code: string } | null
}

export interface ValidateResult {
  success: boolean
  data?: ValidationProof
  error?: { code: string } | null
}

export class StatePlanningFlow {
  private pending: CandidateState | null = null

  constructor(readonly state: StateManager = new StateManager()) {
    state.createState()
  }

  /** Source prior plans and effective constraints from committed state. */
  private prepare(input: PlanningInput): { effective: PlanningInput, eventType: CandidateState['eventType'] } {
    const current = this.state.getState()
    if (input.plan_changes?.length) {
      if (!current.currentPlan || !current.constraints || current.planValidationStatus !== 'verified') {
        throw new StateError('INVALID_STATE_TRANSITION', 'Meal changes require a verified committed plan.')
      }
      return { eventType: 'MEAL_REMOVED', effective: {
        ...input, constraints: structuredClone(current.constraints), existing_plan: structuredClone(current.currentPlan),
      } }
    }
    if (!current.currentPlan) return { eventType: 'PLAN_CREATED', effective: input }
    if (!current.constraints) throw new StateError('INVALID_STATE_TRANSITION', 'A committed plan has no constraints.')
    const prior = current.constraints
    const changed = (Object.keys(input.constraints) as Array<keyof PlanConstraints>)
      .filter(key => !isDeepStrictEqual(input.constraints[key], prior[key]))
    const constraints = changed.length === 0 ? prior : { ...prior, ...Object.fromEntries(changed.map(key => [key, input.constraints[key]])) }
    return { eventType: changed.length ? 'CONSTRAINT_UPDATED' : 'PLAN_REPLANNED', effective: {
      ...input, constraints: structuredClone(constraints), existing_plan: structuredClone(current.currentPlan),
    } }
  }

  /** The Solver may propose; only a later matching Validator result may commit. */
  async solve<T extends SolveResult>(input: PlanningInput, run: (effective: PlanningInput) => Promise<T>): Promise<T> {
    if (this.pending) this.state.rejectCandidate(this.pending, 'SUPERSEDED')
    this.pending = null
    const { effective, eventType } = this.prepare(input)
    let candidate = this.state.createCandidate({ reason: eventType, eventType,
      constraints: effective.constraints, inventory: effective.inventory, schedule: effective.schedule })
    try {
      const result = await run(effective)
      if (!result.success || !result.data?.plan) {
        this.state.rejectCandidate(candidate, result.error?.code ?? 'SOLVER_FAILED')
        return result
      }
      candidate = this.state.stagePlan(candidate, result.data.plan)
      this.pending = candidate
      return result
    } catch (error) {
      this.state.rejectCandidate(candidate, error instanceof Error ? error.message : 'SOLVER_FAILED')
      throw error
    }
  }

  /** Validate independently, then commit only the exact Solver proposal. */
  async validate<T extends ValidateResult>(plan: MealPlan, constraints: PlanConstraints, run: () => Promise<T>): Promise<T> {
    const candidate = this.pending
    const result = await run()
    if (!candidate) return result
    if (!isDeepStrictEqual(candidate.proposedState.currentPlan, plan)
      || !isDeepStrictEqual(candidate.proposedState.constraints, constraints)) {
      throw new StateError('CANDIDATE_VALIDATION_FAILED', 'Validator arguments differ from the pending Solver proposal.')
    }
    this.pending = null
    if (!result.success || !result.data?.valid || result.data.validation_status !== 'verified') {
      this.state.rejectCandidate(candidate, result.error?.code ?? 'VALIDATOR_FAILED', result.data?.validation_status ?? null)
      return result
    }
    try {
      this.state.commitCandidate(candidate, result.data)
    } catch (error) {
      this.state.rejectCandidate(candidate, error instanceof StateError ? error.code : 'STATE_STORE_ERROR', 'verified')
      throw error
    }
    return result
  }

  /** Drop an unvalidated proposal when the Agent turn becomes idle. */
  rejectPending(reason = 'VALIDATOR_NOT_RUN'): void {
    if (!this.pending) return
    this.state.rejectCandidate(this.pending, reason)
    this.pending = null
  }
}
