/** StateManager transition and store isolation checks with no DSH process. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inventoryItems, scheduleDays } from '../meal-fixtures.ts'
import { InMemoryStateStore } from '../state/in-memory-state-store.ts'
import { StateError } from '../state/state-errors.ts'
import { StateManager } from '../state/state-manager.ts'

const constraints = { days: 3, budget_cny: 180, min_daily_protein_g: 120, max_cook_minutes: 30 }
const change = () => ({ reason: 'initial plan', eventType: 'PLAN_CREATED', constraints,
  inventory: inventoryItems, schedule: scheduleDays })
const plan = { plan_id: 'test-plan', status: 'feasible', verification_status: 'unverified',
  optimization_status: 'first_feasible', days: [], ingredient_usage: [],
  grocery_list: [{ ingredient_id: 'rice', quantity: 1, unit: 'g' }], estimated_cost_cny: 1 }
const verified = { valid: true, validation_status: 'verified', violations: [] }

test('initial state has v1 empty plan and isolated reads', () => {
  const manager = new StateManager()
  assert.throws(() => manager.getState(), error => error instanceof StateError && error.code === 'STATE_NOT_INITIALIZED')
  const initial = manager.createState()
  assert.equal(initial.version, 1)
  assert.equal(initial.currentPlan, null)
  assert.deepEqual(initial.shoppingList, [])
  initial.shoppingList.push({ ingredient_id: 'bad', quantity: 1, unit: 'g' })
  assert.deepEqual(manager.getState().shoppingList, [])
  assert.throws(() => manager.createState(), error => error.code === 'INVALID_STATE_TRANSITION')
})

test('candidate is private until verified plan and purchases commit together', () => {
  const store = new InMemoryStateStore()
  const manager = new StateManager(store)
  manager.createState()
  const before = manager.getState()
  const draft = manager.createCandidate(change())
  assert.equal(draft.baseVersion, 1)
  assert.deepEqual(manager.getState(), before)
  assert.throws(() => manager.commitCandidate(draft, verified), error => error.code === 'INVALID_STATE_TRANSITION')
  const staged = manager.stagePlan(draft, plan)
  assert.throws(() => manager.commitCandidate(staged, { ...verified, validation_status: 'unverified' }),
    error => error.code === 'CANDIDATE_VALIDATION_FAILED')
  const committed = manager.commitCandidate(staged, verified)
  assert.equal(committed.version, 2)
  assert.equal(committed.currentPlan.plan_id, 'test-plan')
  assert.equal(committed.planValidationStatus, 'verified')
  assert.deepEqual(committed.shoppingList, committed.currentPlan.grocery_list)
  assert.equal(committed.runtimeEvents[0].type, 'PLAN_CREATED')
  committed.currentPlan.grocery_list[0].quantity = 999
  assert.equal(store.read().shoppingList[0].quantity, 1)
})

test('reject keeps committed snapshot and version while auditing the reason', () => {
  const manager = new StateManager()
  manager.createState()
  const before = manager.getState()
  const candidate = manager.createCandidate(change())
  manager.rejectCandidate(candidate, 'NO_FEASIBLE_PLAN')
  assert.deepEqual(manager.getState(), before)
  assert.equal(manager.getEvents()[0].type, 'CANDIDATE_REJECTED')
  assert.equal(manager.getTraces()[0].commit_status, 'rejected')
  assert.throws(() => manager.commitCandidate(candidate, verified), error => error.code === 'INVALID_STATE_TRANSITION')
})

test('stale candidate cannot overwrite a newer committed version', () => {
  const manager = new StateManager()
  manager.createState()
  const old = manager.stagePlan(manager.createCandidate(change()), plan)
  const newer = manager.stagePlan(manager.createCandidate(change()), plan)
  manager.commitCandidate(newer, verified)
  const before = manager.getState()
  assert.throws(() => manager.commitCandidate(old, verified), error => error.code === 'STATE_VERSION_CONFLICT')
  assert.deepEqual(manager.getState(), before)
})

test('store errors remain State errors', () => {
  const manager = new StateManager({ read: () => { throw new Error('disk') }, write: () => {} })
  assert.throws(() => manager.getState(), error => error.code === 'STATE_STORE_ERROR')
})

test('missing required constraints cannot cross the commit guard', () => {
  const manager = new StateManager()
  manager.createState()
  const candidate = manager.stagePlan(manager.createCandidate({ ...change(), constraints: { ...constraints, budget_cny: undefined } }), plan)
  assert.throws(() => manager.commitCandidate(candidate, verified), error => error.code === 'INVALID_STATE_TRANSITION')
  assert.equal(manager.getState().version, 1)
})
