/** Clone-isolated in-memory store; a later durable store can replace this seam. */
import type { MealPlanningState } from './state-types.ts'

export interface StateStore {
  read(): MealPlanningState | null
  write(state: MealPlanningState): void
}

export class InMemoryStateStore implements StateStore {
  private state: MealPlanningState | null = null

  read(): MealPlanningState | null {
    return this.state === null ? null : structuredClone(this.state)
  }

  write(state: MealPlanningState): void {
    this.state = structuredClone(state)
  }
}
