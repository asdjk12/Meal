/** Runtime state shapes for the in-memory Meal planning layer. */
import type { IngredientAmount, InventoryItem, MealPlan, PlanConstraints, ScheduleDay } from '../meal-plan-types.ts'

export interface FactSnapshot<T> {
  capturedAt: string
  items: T[]
}

export type StateEventType =
  | 'PLAN_CREATED'
  | 'CONSTRAINT_UPDATED'
  | 'MEAL_REMOVED'
  | 'PLAN_REPLANNED'
  | 'CANDIDATE_REJECTED'

export interface RuntimeEvent {
  eventId: string
  type: StateEventType
  payload: Record<string, unknown>
  createdAt: string
}

export interface MealPlanningState {
  stateId: string
  version: number
  status: 'committed'
  constraints: PlanConstraints | null
  inventorySnapshot: FactSnapshot<InventoryItem> | null
  scheduleSnapshot: FactSnapshot<ScheduleDay> | null
  currentPlan: MealPlan | null
  planValidationStatus: 'verified' | null
  shoppingList: IngredientAmount[]
  runtimeEvents: RuntimeEvent[]
  metadata: { createdAt: string, updatedAt: string }
}

export interface CandidateState {
  candidateId: string
  baseVersion: number
  proposedState: MealPlanningState
  changeReason: string
  eventType: Exclude<StateEventType, 'CANDIDATE_REJECTED'>
}

export interface StateChange {
  reason: string
  eventType: CandidateState['eventType']
  constraints: PlanConstraints
  inventory: InventoryItem[]
  schedule: ScheduleDay[]
}

export interface ValidationProof {
  valid: boolean
  validation_status: 'verified' | 'unverified' | 'invalid'
  violations: readonly unknown[]
}

export interface StateTrace {
  state_version_before: number
  state_version_after: number
  candidate_id: string
  event_type: StateEventType
  validation_status: ValidationProof['validation_status'] | null
  commit_status: 'committed' | 'rejected'
  reject_reason: string | null
}
