/** Run Step 5 cases through the DSH Agent and save model/tool evidence. */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
// The Profile resolves DSH services at runtime, but does not install these packages locally.
// @ts-expect-error Runtime-only path to the built DSH package.
import { createUserMessage } from '../../../../../DSH/_OriginalCode/packages/llm/llm/lib/index.js'
// @ts-expect-error Runtime-only path to the built DSH package.
import { SessionId } from '../../../../../DSH/_OriginalCode/packages/core/session/lib/index.js'
import { fixtureMealPlan, ingredientPrices } from '../meal-fixtures.ts'
import { stateFlowForAgent } from '../meal-state-runtime.ts'

export const name = 'meal-step5-agent-probe'
export const inject = ['agents', 'tools']

const requests: Record<string, string> = {
  'TC-01': '看看我现在有什么食材。',
  'TC-02': '鸡胸肉现在多少钱？',
  'TC-03': '300g 鸡胸肉有多少蛋白质？',
  'TC-04': '帮我找几个30分钟内可以做的鸡胸肉菜谱。',
  'TC-05': '帮我规划未来三天的午餐和晚餐。每天至少摄入120g蛋白质。预算180元。工作日做饭不超过30分钟。',
  'TC-06': '预算改成60元，重新规划。',
  'TC-07': '第二天晚上临时有聚餐，不需要晚餐了。',
  'TC-08': '未来三天午餐和晚餐，预算20元，每天至少200g蛋白质，只能使用当前测试菜谱，不允许新增其他食材。',
  'TC-09': '给我规划包含鸡胸肉的三日计划。每天至少120g蛋白质，预算180元，每餐不超过30分钟。',
}

const traceSet = process.env.MEAL_TRACE_SET === 'step7' ? 'step7' : 'step5_2'
const traceDir = new URL(`../../../../traces/${traceSet}/`, import.meta.url)
type Handle = Awaited<ReturnType<Context['agents']['create']>>
type Event = { type: string, data: any }

function toolValue(message: any): unknown {
  const text = message?.content?.find((block: any) => block.type === 'text')?.text
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

/** Reduce a DSH turn to portable Tool calls, results, and final model text. */
function traceFor(caseId: string, events: Event[]) {
  const calls = events.filter(event => event.type === 'tool/call')
  const results = events.filter(event => event.type === 'tool/result')
  const toolTrace = calls.map((call, index) => {
    const result = results.find(item => item.data.message?.toolCallId === call.data.callId)
    const value = toolValue(result?.data.message)
    let args: unknown = call.data.arguments
    try { args = JSON.parse(call.data.arguments) } catch {}
    return {
      index: index + 1, tool: call.data.name, arguments: args,
      status: !result ? 'missing_result' : result.data.message.isError || (value as any)?.success === false ? 'failed' : 'success',
      result: value,
    }
  })
  const finalMessage = events.filter(event => event.type === 'assistant/message').at(-1)?.data.message
  const finalText = finalMessage?.content?.filter((block: any) => block.type === 'text')
    .map((block: any) => block.text ?? '').join('') ?? ''
  return {
    case_id: caseId, execution_mode: 'dsh_agent', user_request: requests[caseId],
    actual_tool_trace: toolTrace, actual_tools: toolTrace.map(call => call.tool),
    tool_call_count: toolTrace.length,
    duplicate_tool_calls: toolTrace.length - new Set(toolTrace.map(call => `${call.tool}:${JSON.stringify(call.arguments)}`)).size,
    failed_calls: toolTrace.filter(call => call.status !== 'success').length,
    final_result: finalText,
    turn_end_reason: events.findLast(event => event.type === 'turn/end')?.data.reason ?? null,
  }
}

async function runTurn(handle: Handle, caseId: string, traceName = caseId) {
  const flow = stateFlowForAgent(handle.agent)
  if (!flow) throw new Error('Meal State runtime was not installed for the Agent')
  const stateBefore = flow.state.getState()
  const before = handle.agent.session.snapshotEvents().length
  handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: requests[caseId] }] }))
  await handle.agent.whenIdle()
  const trace = traceFor(caseId, handle.agent.session.snapshotEvents().slice(before))
  const stateAfter = flow.state.getState()
  Object.assign(trace, {
    state_version_before: stateBefore.version,
    state_version_after: stateAfter.version,
    current_plan_id: stateAfter.currentPlan?.plan_id ?? null,
    plan_validation_status: stateAfter.planValidationStatus,
    state_traces: flow.state.getTraces().filter(item => item.state_version_before >= stateBefore.version),
  })
  await writeFile(new URL(`${traceName}.json`, traceDir), `${JSON.stringify(trace, null, 2)}\n`, 'utf8')
  if (caseId === 'TC-05' && (stateAfter.version !== 2 || stateAfter.planValidationStatus !== 'verified'
    || JSON.stringify(stateAfter.shoppingList) !== JSON.stringify(stateAfter.currentPlan?.grocery_list))) {
    throw new Error(`TC-05 did not commit to v2: ${JSON.stringify({ version: stateAfter.version,
      validationStatus: stateAfter.planValidationStatus, tools: trace.actual_tools,
      stateTraces: flow.state.getTraces() })}`)
  }
  if (caseId === 'TC-07' && (stateBefore.version !== 2 || stateAfter.version !== 3
    || stateAfter.currentPlan?.days[1]?.meals.some(meal => meal.meal === 'dinner'))) {
    throw new Error('TC-07 did not commit the State-sourced REMOVE_MEAL re-plan')
  }
  if (caseId === 'TC-08' && stateAfter.version !== 1) throw new Error('TC-08 overwrote the no-plan state')
  if (caseId === 'TC-09' && stateAfter.version !== 1) throw new Error('TC-09 overwrote the missing-price state')
  process.stdout.write(`STEP5_CASE ${JSON.stringify({ caseId, actualTools: trace.actual_tools, failedCalls: trace.failed_calls, finalResult: trace.final_result, turnEndReason: trace.turn_end_reason })}\n`)
}

/** Start isolated sessions, retaining TC-05's conversation for follow-up requests. */
export function apply(ctx: Context): void {
  const ready = ctx.get('appReady')
  const exit = ctx.get('appExit')
  if (!ready || !exit) throw new Error('Step 5 requires app readiness and exit services')
  const run = async () => {
    await mkdir(traceDir, { recursive: true })
    let linked: Handle | undefined
    for (const caseId of (process.env.STEP5_CASES ?? 'TC-01').split(',')) {
      if (caseId === 'TC-10') {
        const validator = ctx.tools.get('validate_meal_plan')
        if (!validator) throw new Error('Validator is not registered')
        const plan = { ...structuredClone(fixtureMealPlan), verification_status: 'unverified', optimization_status: 'first_feasible', ingredient_usage: [], estimated_cost_cny: 205 }
        const constraints = { days: 3, budget_cny: 180, min_daily_protein_g: 120, max_cook_minutes: 30 }
        const result = await validator.execute({ plan, constraints }, undefined as never)
        const trace = { case_id: caseId, execution_mode: 'direct_registry', user_request: 'Validate an intentionally invalid plan.',
          actual_tool_trace: [{ index: 1, tool: 'validate_meal_plan', arguments: { plan, constraints }, status: 'success', result }],
          tool_call_count: 1, final_result: 'Artificial plan validation completed.' }
        await writeFile(new URL(`${caseId}.json`, traceDir), `${JSON.stringify(trace, null, 2)}\n`, 'utf8')
        process.stdout.write(`STEP5_CASE ${JSON.stringify({ caseId, result })}\n`)
        continue
      }
      if (!requests[caseId]) throw new Error(`Unknown Step 5 case ${caseId}`)
      if (caseId === 'TC-06') {
        if (!linked) throw new Error(`${caseId} needs TC-05 in this run`)
        await runTurn(linked, caseId)
        continue
      }
      if (caseId === 'TC-07') {
        const fresh = await ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: process.cwd() },
          agentOptions: { provider: 'deepseek-official', model: process.env.DSH_MODEL || 'deepseek-v4-flash' } })
        try {
          await runTurn(fresh, 'TC-05', 'TC-07-setup')
          await runTurn(fresh, caseId)
        } finally {
          await fresh.dispose()
        }
        continue
      }
      const handle = await ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: process.cwd() },
        agentOptions: { provider: 'deepseek-official', model: process.env.DSH_MODEL || 'deepseek-v4-flash' } })
      let missingPrice: typeof ingredientPrices[number] | undefined
      try {
        if (caseId === 'TC-09') {
          const index = ingredientPrices.findIndex(price => price.ingredient_id === 'chicken_breast')
          if (index < 0) throw new Error('Chicken price already missing')
          missingPrice = ingredientPrices.splice(index, 1)[0]
        }
        await runTurn(handle, caseId)
        if (caseId === 'TC-05') linked = handle
      } finally {
        if (missingPrice) ingredientPrices.unshift(missingPrice)
        if (handle !== linked) await handle.dispose()
      }
    }
    await linked?.dispose()
    exit(0)
  }
  ctx.effect(() => ready.onReady(() => { void run().catch((error: unknown) => {
    process.stderr.write(`STEP5_ERROR ${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  }) }), 'Step 5 Agent runner')
}
