/** Candidate and version transitions over a clone-isolated StateStore. */
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { MealPlan } from '../meal-plan-types.ts'
import { InMemoryStateStore, type StateStore } from './in-memory-state-store.ts'
import { StateError } from './state-errors.ts'
import type {
  CandidateState, MealPlanningState, RuntimeEvent, StateChange, StateEventType,
  StateTrace, ValidationProof,
} from './state-types.ts'

interface PendingCandidate { candidate: CandidateState, planStaged: boolean }

export class StateManager {
  private readonly pending = new Map<string, PendingCandidate>()
  private readonly auditEvents: RuntimeEvent[] = []
  private readonly traces: StateTrace[] = []

  constructor(private readonly store: StateStore = new InMemoryStateStore(), private readonly now = () => new Date().toISOString()) {}

  private read(): MealPlanningState | null {
    try { return this.store.read() } catch (error) {
      throw new StateError('STATE_STORE_ERROR', `State read failed: ${String(error)}`)
    }
  }

  private write(state: MealPlanningState): void {
    try { this.store.write(state) } catch (error) {
      throw new StateError('STATE_STORE_ERROR', `State write failed: ${String(error)}`)
    }
  }

  /** Create the empty committed version once; no default plan is inferred. */
  createState(): MealPlanningState {
    if (this.read() !== null) throw new StateError('INVALID_STATE_TRANSITION', 'State is already initialized.')
    const time = this.now()
    const state: MealPlanningState = {
      stateId: randomUUID(), version: 1, status: 'committed',
      constraints: null, inventorySnapshot: null, scheduleSnapshot: null,
      currentPlan: null, planValidationStatus: null, shoppingList: [], runtimeEvents: [],
      metadata: { createdAt: time, updatedAt: time },
    }
    this.write(state)
    return structuredClone(state)
  }

  getState(): MealPlanningState {
    const state = this.read()
    if (state === null) throw new StateError('STATE_NOT_INITIALIZED', 'Meal planning state has not been initialized.')
    return state
  }

  /** Derive a candidate without writing a committed field. */
  createCandidate(change: StateChange): CandidateState {
    const current = this.getState()
    const time = this.now()
    const candidate: CandidateState = {
      candidateId: randomUUID(), baseVersion: current.version,
      changeReason: change.reason, eventType: change.eventType,
      proposedState: {
        ...current,
        constraints: structuredClone(change.constraints),
        inventorySnapshot: { capturedAt: time, items: structuredClone(change.inventory) },
        scheduleSnapshot: { capturedAt: time, items: structuredClone(change.schedule) },
      },
    }
    this.pending.set(candidate.candidateId, { candidate, planStaged: false })
    return structuredClone(candidate)
  }

  /** Attach one Solver output and its own purchases to the same candidate. */
  stagePlan(candidate: CandidateState, plan: MealPlan): CandidateState {
    const entry = this.requirePending(candidate)
    entry.candidate.proposedState.currentPlan = structuredClone(plan)
    entry.candidate.proposedState.shoppingList = structuredClone(plan.grocery_list)
    entry.candidate.proposedState.planValidationStatus = null
    entry.planStaged = true
    return structuredClone(entry.candidate)
  }

  private requirePending(candidate: CandidateState): PendingCandidate {
    const entry = this.pending.get(candidate.candidateId)
    if (!entry || entry.candidate.baseVersion !== candidate.baseVersion) {
      throw new StateError('INVALID_STATE_TRANSITION', 'Candidate is unknown or already resolved.')
    }
    return entry
  }

  /** Only a verified matching Solver candidate can replace committed state. */
  commitCandidate(candidate: CandidateState, validation: ValidationProof): MealPlanningState {
    const entry = this.requirePending(candidate)
    const current = this.getState()
    if (entry.candidate.baseVersion !== current.version) {
      throw new StateError('STATE_VERSION_CONFLICT', `Candidate v${entry.candidate.baseVersion} cannot replace v${current.version}.`)
    }
    const proposed = entry.candidate.proposedState
    const constraints = proposed.constraints
    const required = constraints !== null
      && Number.isInteger(constraints.days) && constraints.days > 0
      && Number.isFinite(constraints.budget_cny) && constraints.budget_cny >= 0
      && Number.isFinite(constraints.min_daily_protein_g) && constraints.min_daily_protein_g >= 0
      && Number.isFinite(constraints.max_cook_minutes) && constraints.max_cook_minutes >= 0
    if (!entry.planStaged || !isDeepStrictEqual(candidate, entry.candidate)
      || proposed.currentPlan === null || !required
      || proposed.inventorySnapshot === null || proposed.scheduleSnapshot === null
      || !isDeepStrictEqual(proposed.shoppingList, proposed.currentPlan.grocery_list)) {
      throw new StateError('INVALID_STATE_TRANSITION', 'Candidate lacks a matching plan, facts, constraints, or shopping list.')
    }
    if (!validation.valid || validation.validation_status !== 'verified' || validation.violations.length !== 0) {
      throw new StateError('CANDIDATE_VALIDATION_FAILED', 'Candidate requires a verified Validator result without violations.')
    }
    const newVersion = current.version + 1
    const eventTypes: StateEventType[] = [entry.candidate.eventType]
    if (entry.candidate.eventType === 'CONSTRAINT_UPDATED' || entry.candidate.eventType === 'MEAL_REMOVED') {
      eventTypes.push('PLAN_REPLANNED')
    }
    const events = eventTypes.map(type => this.makeEvent(type, {
      candidateId: candidate.candidateId, stateVersionBefore: current.version,
      stateVersionAfter: newVersion, reason: candidate.changeReason,
    }))
    const next: MealPlanningState = {
      ...proposed, version: newVersion, planValidationStatus: 'verified',
      runtimeEvents: [...current.runtimeEvents, ...events],
      metadata: { ...current.metadata, updatedAt: this.now() },
    }
    this.write(next)
    this.pending.delete(candidate.candidateId)
    this.auditEvents.push(...events)
    this.traces.push({ state_version_before: current.version, state_version_after: newVersion,
      candidate_id: candidate.candidateId, event_type: candidate.eventType,
      validation_status: 'verified', commit_status: 'committed', reject_reason: null })
    return structuredClone(next)
  }

  /** Record a rejection outside the committed snapshot, retaining its version. */
  rejectCandidate(candidate: CandidateState, reason: string, validationStatus: ValidationProof['validation_status'] | null = null): void {
    this.requirePending(candidate)
    const current = this.getState()
    this.pending.delete(candidate.candidateId)
    this.appendEvent('CANDIDATE_REJECTED', { candidateId: candidate.candidateId, reason,
      stateVersion: current.version })
    this.traces.push({ state_version_before: current.version, state_version_after: current.version,
      candidate_id: candidate.candidateId, event_type: candidate.eventType,
      validation_status: validationStatus, commit_status: 'rejected', reject_reason: reason })
  }

  appendEvent(type: StateEventType, payload: Record<string, unknown>): RuntimeEvent {
    const event = this.makeEvent(type, payload)
    this.auditEvents.push(event)
    return structuredClone(event)
  }

  getEvents(): RuntimeEvent[] { return structuredClone(this.auditEvents) }
  getTraces(): StateTrace[] { return structuredClone(this.traces) }

  private makeEvent(type: StateEventType, payload: Record<string, unknown>): RuntimeEvent {
    return { eventId: randomUUID(), type, payload: structuredClone(payload), createdAt: this.now() }
  }
}
