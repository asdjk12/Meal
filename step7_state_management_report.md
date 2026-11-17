# Step 7 State Management Report

## Summary

在既有 `meal-planning` Profile 中接入每个 DSH Agent 独立的内存状态层。状态从 v1 空计划开始；Solver 只提出候选，Validator 验证同一候选后才由 Runtime 提交。原七个 Tool 的名称、参数、输出 schema、Solver 算法、Validator 规则及 Fixture 均未修改。

## State Schema

`MealPlanningState` 保存 `stateId`、版本、当前约束、库存和日程事实快照、当前计划、购物清单、已提交事件及时间戳。由于冻结的 Solver `MealPlan.verification_status` 固定为 `unverified`，状态另以 `planValidationStatus: verified` 保存独立 Validator 的验证结论；仅凭原始 Plan 字段不能判断已提交计划的验证状态。状态不保存完整对话、全部 Fixture 或 Tool Trace。

## State Manager

`StateManager` 提供初始化、隔离读取、候选创建、计划暂存、验证后提交、拒绝、事件和 trace 读取。`StateError` 单独定义 `STATE_NOT_INITIALIZED`、`STATE_VERSION_CONFLICT`、`INVALID_STATE_TRANSITION`、`CANDIDATE_VALIDATION_FAILED`、`STATE_STORE_ERROR`，不改变 Tool 错误合约。

## State Store

`StateStore` 只有 `read`/`write`；首版 `InMemoryStateStore` 对读写都做结构化复制。一个 Agent 使用一个 `StatePlanningFlow` 和一个 Store。DSH 的 Session Projection 是日志读模型，当前没有把它当作可写业务状态使用。

## Candidate / Commit / Reject

候选包含 ID、基准版本、拟议状态、原因和事件类型。Runtime 在 Solver 成功后暂存 Plan，并直接从该 Plan 生成同一候选的购物清单；Validator 必须验证完全相同的 Plan 和 Constraints。验证通过则 Plan、购物清单、约束和事实快照一次写入；无解、验证失败、必需 Tool 失败或 Agent turn 结束时尚未验证，均不覆盖已提交状态。Validator 输入不匹配时给出 State 错误，允许同一 turn 纠正后重试。

`REMOVE_MEAL` 的 `existing_plan` 由已提交的 `state.currentPlan` 提供，忽略模型提交的旧计划内容。约束更新基于已提交约束应用请求中的变化，只有产生 verified Plan 才一起提交。原 Solver/Validator Tool 本体仍无状态写入；DSH Agent 作用域中使用同名、同 schema 的 Runtime wrapper 编排状态转换。

## Versioning

初始化 v1；每次成功提交加一。候选保留 `baseVersion`，提交前不相等则抛出 `STATE_VERSION_CONFLICT`。拒绝及 Tool 失败不增加版本。TC-05、TC-06、TC-07 的真实 Agent trace 分别观察到 v1→v2、v2→v3、v2→v3；TC-08、TC-09 保持 v1。

## Runtime Events

支持 `PLAN_CREATED`、`CONSTRAINT_UPDATED`、`MEAL_REMOVED`、`PLAN_REPLANNED`、`CANDIDATE_REJECTED`。成功提交事件与新状态同次写入。拒绝事件存于 Manager 审计记录，不写入旧 committed snapshot，因此拒绝后版本和业务状态完全不变。State trace 记录提交前后版本、候选 ID、事件类型、验证状态、提交/拒绝状态及原因。

## State Unit Tests

6/6 通过：v1 初始化、隔离读取、候选不污染、验证后原子提交、拒绝不覆盖、旧候选版本冲突、Store 错误和必需约束守卫。

## State Integration Tests

ST-01～ST-06 6/6 通过，使用现有本地 Solver 与独立 Validator。附加覆盖必需价格失败、不验证即结束 turn、Validator 输入纠正和 JSON 字段顺序变化。DSH Profile 探针通过真实 Tool Registry 验证同名 scoped wrapper 保留 schema，首次规划到 v2、`REMOVE_MEAL` 到 v3、无解保持 v3。

## TC-01 ~ TC-10 Regression

真实 DSH Agent 重新执行了 TC-01～TC-10，并保存于 `traces/step7/`。`step7-assess.mjs` 按 Tool 结果、Validator 结论、State 版本和事件逐例检查，10/10 行为通过。TC-05 已提交 verified Plan 和同版本购物清单；TC-07 从 State 取旧计划；TC-08 无解后旧状态不变；TC-09 缺价时未调用 Solver/Validator 且状态不变；TC-10 独立 Validator 拒绝人工非法 Plan。

旧 `step5-assess-v02.mjs` 使用完全固定的 Tool 调用序列。此次真实模型运行中，TC-05 多次搜索菜谱，TC-06 重新获取五类数据，因此若把旧序列断言直接用于这批 trace，这两例不会满足精确调用次数；业务与状态断言均通过。TC-09 也进行了多次价格重试，但旧脚本本来允许该例的额外调用。这些额外调用是效率问题，没有被计作新的 State 成功或失败。

## Failure Cases

ST-02 的非法候选得到 `invalid`，旧 committed state 保持不变；ST-04 的 `NO_FEASIBLE_PLAN` 拒绝候选；缺价不会形成可信计划；ST-06 的旧候选被版本守卫阻断。真实 TC-08、TC-09 均保持 v1。

## Known Limitations

- `InMemoryStateStore` 不跨进程重启或 Agent 重建恢复；持久状态属于后续阶段。
- Solver/Validator 目前仍直接依赖本地 Fixture。真实数据库或 API 的一致事实来源工作记录在 `TODO.md` 的 TD-001；本报告不宣称真实数据验收。
- 未实现自然语言事件循环、外部库存/日程自动监听、多用户并发或历史 Plan 全量存储。
- 旧固定 Tool 序列与本次模型的实际调用次数有差异；需要把调用效率与状态正确性分别评估。

## Final Decision

Step 7 的本地状态功能与逐例业务/状态验收通过：全量本地测试 38/38、ST-01～ST-06 6/6、真实 Agent TC-01～TC-10 行为 10/10、TypeScript 和 Oxlint 均通过。旧精确调用序列断言在 TC-05、TC-06 上有差异，已作为可见限制记录。
