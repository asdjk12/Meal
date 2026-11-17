/** Assess TC-01–TC-10 business outcomes and State effects from real Agent traces. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const traceDir = new URL('../../../../traces/step7/', import.meta.url)
const names = ['get_inventory', 'get_prices', 'get_nutrition', 'search_recipes']
const warnings = []

function calls(trace, name) { return trace.actual_tool_trace.filter(call => call.tool === name) }
function committed(trace, type) {
  return trace.state_traces.some(item => item.event_type === type && item.commit_status === 'committed'
    && item.validation_status === 'verified' && item.state_version_after === trace.state_version_after)
}

for (let index = 1; index <= 10; index++) {
  const id = `TC-${String(index).padStart(2, '0')}`
  const trace = JSON.parse(await readFile(new URL(`${id}.json`, traceDir), 'utf8'))
  const tools = trace.actual_tools ?? trace.actual_tool_trace.map(call => call.tool)
  if (index <= 4) {
    assert.deepEqual(tools, [names[index - 1]], `${id}: direct lookup changed`)
    assert.equal(trace.state_version_after, 1, `${id}: read-only lookup changed state`)
  } else if (index === 5 || index === 6 || index === 7) {
    const solver = calls(trace, 'solve_meal_plan').at(-1)
    const validator = calls(trace, 'validate_meal_plan').at(-1)
    assert.equal(solver?.result?.success, true, `${id}: Solver did not return a plan`)
    assert.equal(validator?.result?.data?.validation_status, 'verified', `${id}: plan was not verified`)
    assert.equal(trace.plan_validation_status, 'verified', `${id}: State lacks validation proof`)
    assert.equal(trace.state_version_after, trace.state_version_before + 1, `${id}: version did not advance`)
    assert.ok(tools.indexOf('solve_meal_plan') < tools.indexOf('validate_meal_plan'), `${id}: validation order changed`)
    assert.ok(committed(trace, index === 5 ? 'PLAN_CREATED' : index === 6 ? 'CONSTRAINT_UPDATED' : 'MEAL_REMOVED'),
      `${id}: expected State event was not committed`)
    if (index === 5) {
      for (const name of ['get_inventory', 'get_schedule', 'search_recipes', 'get_nutrition', 'get_prices']) {
        assert.ok(tools.indexOf(name) >= 0 && tools.indexOf(name) < tools.indexOf('solve_meal_plan'),
          `${id}: required facts did not precede Solver`)
      }
    }
    if (index === 7) {
      assert.deepEqual(solver.arguments.plan_changes, [{ type: 'REMOVE_MEAL', day: 2, meal: 'dinner' }])
    }
  } else if (index === 8) {
    const original = calls(trace, 'solve_meal_plan').find(call => call.arguments.constraints.budget_cny === 20)
    assert.equal(original?.result?.error?.code, 'NO_FEASIBLE_PLAN')
    assert.equal(calls(trace, 'validate_meal_plan').length, 0)
    assert.equal(trace.state_version_after, 1)
    assert.equal(trace.current_plan_id, null)
  } else if (index === 9) {
    assert.ok(calls(trace, 'get_prices').some(call => call.result?.error?.code === 'PRICE_NOT_FOUND'))
    assert.equal(calls(trace, 'solve_meal_plan').length, 0)
    assert.equal(calls(trace, 'validate_meal_plan').length, 0)
    assert.equal(trace.state_version_after, 1)
  } else {
    assert.equal(trace.execution_mode, 'direct_registry')
    assert.equal(calls(trace, 'validate_meal_plan')[0]?.result?.data?.validation_status, 'invalid')
  }
  if (trace.turn_end_reason) assert.equal(trace.turn_end_reason.kind, 'completed', `${id}: Agent turn did not complete`)
  const redundant = tools.length - new Set(trace.actual_tool_trace.map(call => `${call.tool}:${JSON.stringify(call.arguments)}`)).size
  if (redundant) warnings.push(`${id}: ${redundant} duplicate Tool calls`)
  process.stdout.write(`STEP7_REGRESSION ${id} PASS\n`)
}

process.stdout.write(`STEP7_REGRESSION_SUMMARY 10/10 PASS\n`)
for (const warning of warnings) process.stdout.write(`STEP7_EFFICIENCY ${warning}\n`)
