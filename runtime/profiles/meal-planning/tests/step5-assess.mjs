/** Attach reviewed expectations and outcomes to the raw Step 5 JSON traces. */
import { readFile, writeFile } from 'node:fs/promises'

const traceDir = new URL('../../../../traces/', import.meta.url)

const assessments = {
  'TC-01': {
    expected_tools: ['get_inventory'], case_result: 'PASS', validation_result: 'not_applicable',
    failure_reason: null, semantic_redundancy: 'none observed',
  },
  'TC-02': {
    expected_tools: ['get_prices'], case_result: 'FAIL', validation_result: 'not_applicable',
    failure_reason: 'The Agent queried inventory and four prices, then returned prices for unrelated ingredients.',
    semantic_redundancy: 'get_inventory was unnecessary; three extra price records were requested.',
  },
  'TC-03': {
    expected_tools: ['get_nutrition'], case_result: 'FAIL', validation_result: 'not_applicable',
    failure_reason: 'The Tool has no amount/unit input; the Agent calculated 300 g nutrition itself and added unsupported cooked-weight claims.',
    semantic_redundancy: 'none observed',
  },
  'TC-04': {
    expected_tools: ['search_recipes'], case_result: 'FAIL', validation_result: 'not_applicable',
    failure_reason: 'The first ingredient filter returned zero recipes; the Agent then queried inventory and prices outside the requested search.',
    semantic_redundancy: 'extra inventory and price calls; the second search recovered from a noncanonical ingredient id.',
  },
  'TC-05': {
    expected_tools: ['get_inventory', 'get_schedule', 'search_recipes', 'get_nutrition', 'get_prices', 'solve_meal_plan', 'validate_meal_plan'],
    case_result: 'FAIL', validation_result: 'reported_pass_but_validator_checks_only_plan_id',
    failure_reason: 'Solver ran before candidate recipes, price, and nutrition retrieval; the Validator cannot independently inspect the plan or constraints.',
    semantic_redundancy: 'late data calls did not inform the earlier Solver result.',
  },
  'TC-06': {
    expected_tools: ['solve_meal_plan'], case_result: 'PASS', validation_result: 'not_run_no_feasible_plan',
    failure_reason: null, semantic_redundancy: 'four exploratory calls after the first NO_FEASIBLE_PLAN were not needed to answer the unchanged budget request.',
  },
  'TC-07': {
    expected_tools: ['solve_meal_plan', 'validate_meal_plan'], case_result: 'FAIL', validation_result: 'not_run_for_edited_plan',
    failure_reason: 'The Solver cannot receive an existing plan or canceled meal; the Agent manually produced a five-meal plan without validation.',
    semantic_redundancy: 'two Solver calls changed days instead of representing the canceled dinner.',
  },
  'TC-08': {
    expected_tools: ['solve_meal_plan'], case_result: 'PASS', validation_result: 'not_required_for_infeasible_request',
    failure_reason: null, semantic_redundancy: 'many exploratory Solver calls; the relaxed plan was clearly identified as an alternative.',
  },
  'TC-09': {
    expected_tools: ['get_prices', 'solve_meal_plan'], case_result: 'FAIL', validation_result: 'reported_pass_despite_missing_price',
    failure_reason: 'PRICE_NOT_FOUND was surfaced, yet Solver and Validator returned success and the final answer presented the plan as completed.',
    semantic_redundancy: 'several recipe searches returned zero or repeated catalog data.',
    failure_injection: 'Removed chicken_breast from the in-memory price fixture for this case only; restored afterward.',
  },
  'TC-10': {
    expected_tools: ['validate_meal_plan'], case_result: 'FAIL', validation_result: 'invalid_plan_cannot_be_submitted',
    failure_reason: 'Validator input accepts only plan_id, so the deliberately invalid plan cannot be supplied for independent checking.',
    semantic_redundancy: 'none observed',
  },
}

for (const [caseId, assessment] of Object.entries(assessments)) {
  const path = new URL(`${caseId}.json`, traceDir)
  const trace = JSON.parse(await readFile(path, 'utf8'))
  const actual = trace.actual_tool_trace ?? []
  const signatures = actual.map(call => `${call.tool}:${JSON.stringify(call.arguments)}`)
  Object.assign(trace, {
    ...assessment,
    tool_call_order: actual.map(call => call.tool),
    tool_call_count: actual.length,
    redundant_calls: signatures.length - new Set(signatures).size,
    failed_calls: actual.filter(call => call.status === 'failed' || call.status === 'missing_result').length,
    final_status: trace.turn_end_reason?.kind ?? 'contract_blocked',
    unused_tool_results: caseId === 'TC-05' ? 'Not reliably measurable from the final text; three data Tools ran after Solver.' : 'not_assessed',
  })
  await writeFile(path, `${JSON.stringify(trace, null, 2)}\n`, 'utf8')
}
