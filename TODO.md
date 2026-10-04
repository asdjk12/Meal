# Meal Agent TODO

## TD-001：统一 Solver / Validator 的事实来源

- [ ] 在接入真实数据库或真实 API Provider 时，移除 Solver 输入防伪检查与 Validator 对 `meal-fixtures.ts` 的直接依赖，让 Tool、Solver、Validator 使用同一份可追踪的数据快照。

### 当前状态

- 五个数据 Tool 已通过 Provider 获取数据。
- Solver 的输入防伪比较仍读取本地 Fixture。
- Validator 的库存、菜谱、价格与日程事实仍读取本地 Fixture。
- Step 6 保留该绑定作为 Known Limitation；当前不修改 Solver、Validator 或 Tool Contract v0.2。

### 触发时机

开始接入真实数据 Provider 时处理，并在真实数据链路被验收为可信计划链路前完成。

### 风险

如果 Tool 与 Solver 使用真实数据，而 Validator 继续使用旧 Fixture，验证结果可能来自不同事实源，不能作为可信 Plan 的证明。

### 完成标准

- Solver 输入防伪与 Validator 使用和数据 Tool 相同的数据快照或事实来源。
- 数据来源带有可比较的 provider、版本或 snapshot 标识，能够阻止跨快照混用。
- 保持七个 Tool 的公开 Contract、Agent、DSH Runtime 与 Tool Registry 不变。
- Local Provider 回归仍通过。
- 新增真实 Provider 的来源一致性测试。
- 重新执行 TC-01～TC-10，尤其验证 TC-05、TC-09、TC-10。
