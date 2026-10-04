/** Add reviewed V0.2 outcomes to the preserved second-round Agent traces. */
import { readFile, writeFile } from 'node:fs/promises'

const traceDir = new URL('../../../../traces/step5_2/', import.meta.url)
const review = {
  'TC-01': { expected_tools: ['get_inventory'], validation_result: 'not_applicable', note: 'Only the four inventory records were returned.' },
  'TC-02': { expected_tools: ['get_prices'], validation_result: 'not_applicable', note: 'One price call requested only chicken_breast.' },
  'TC-03': { expected_tools: ['get_nutrition'], validation_result: 'not_applicable', note: 'The Tool returned the 300 g values directly.' },
  'TC-04': { expected_tools: ['search_recipes'], validation_result: 'not_applicable', note: 'One filtered search returned two recipes; alias normalization is separately covered by the Registry probe.' },
  'TC-05': { expected_tools: ['get_inventory', 'get_schedule', 'search_recipes', 'get_nutrition', 'get_prices', 'solve_meal_plan', 'validate_meal_plan'], validation_result: 'verified', note: 'All required data preceded Solver; Validator received the complete Plan and returned verified.' },
  'TC-06': { expected_tools: ['solve_meal_plan', 'validate_meal_plan'], validation_result: 'verified', note: 'The earlier CNY 45 plan remains feasible under the new CNY 60 budget; no optimality claim.' },
  'TC-07': { expected_tools: ['solve_meal_plan', 'validate_meal_plan'], validation_result: 'verified', note: 'REMOVE_MEAL day 2 dinner changed one other serving, kept four meals, and validated the CNY 57 Plan.' },
  'TC-08': { expected_tools: ['get_inventory', 'get_schedule', 'search_recipes', 'get_nutrition', 'get_prices', 'solve_meal_plan'], validation_result: 'not_run_no_plan', note: 'Solver returned NO_FEASIBLE_PLAN; the final answer reported only its conflict categories.' },
  'TC-09': { expected_tools: ['get_inventory', 'get_schedule', 'search_recipes', 'get_nutrition', 'get_prices'], validation_result: 'not_run_missing_price', note: 'PRICE_NOT_FOUND blocked Solver and Validator. Five extra price calls are an efficiency warning.' },
  'TC-10': { expected_tools: ['validate_meal_plan'], validation_result: 'invalid', note: 'Direct Registry call submitted an artificial Plan and received invalid with violations.' },
}

for (const [caseId, assessment] of Object.entries(review)) {
  const path = new URL(`${caseId}.json`, traceDir)
  const trace = JSON.parse(await readFile(path, 'utf8'))
  const calls = trace.actual_tool_trace ?? []
  const signatures = calls.map(call => `${call.tool}:${JSON.stringify(call.arguments)}`)
  const actualTools = calls.map(call => call.tool)
  const expectedPrefix = assessment.expected_tools
  const orderMatches = caseId === 'TC-09'
    ? expectedPrefix.every((tool, index) => actualTools[index] === tool)
    : JSON.stringify(actualTools) === JSON.stringify(expectedPrefix)
  const solver = calls.findLast(call => call.tool === 'solve_meal_plan')
  const validator = calls.findLast(call => call.tool === 'validate_meal_plan')
  const outcomeMatches = caseId === 'TC-08'
    ? solver?.result?.error?.code === 'NO_FEASIBLE_PLAN' && !validator
    : caseId === 'TC-09'
      ? calls.some(call => call.result?.error?.code === 'PRICE_NOT_FOUND') && !solver && !validator
      : caseId === 'TC-10'
        ? validator?.result?.data?.valid === false && validator.result.data.violations.length > 0
        : assessment.validation_result === 'verified'
          ? validator?.result?.data?.validation_status === 'verified'
          : calls.every(call => call.status === 'success')
  const caseResult = orderMatches && outcomeMatches ? 'PASS' : 'FAIL'
  if (caseResult !== 'PASS') throw new Error(`${caseId} differs from the reviewed V0.2 assessment`)
  Object.assign(trace, {
    expected_tools: assessment.expected_tools,
    tool_call_order: actualTools,
    redundant_calls: signatures.length - new Set(signatures).size,
    failed_calls: calls.filter(call => call.status !== 'success').length,
    validation_result: assessment.validation_result,
    case_result: caseResult,
    review_note: assessment.note,
    final_status: trace.turn_end_reason?.kind ?? 'direct_registry',
  })
  await writeFile(path, `${JSON.stringify(trace, null, 2)}\n`, 'utf8')
}
