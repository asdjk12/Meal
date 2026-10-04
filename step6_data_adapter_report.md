# Step 6 Data Adapter Report

## Summary

Step 6 已在冻结的 Tool Contract v0.2 下完成。五个数据 Tool 现在通过注入的 Provider 访问数据，默认组合仍使用确定性的本地 Fixture。Agent、DSH Runtime、Tool Registry、Solver、Validator、Fixture 值及两个 Domain Tool 的公开行为均未修改。

当前数据路径：

```text
DSH Runtime -> Tool Registry -> Data Tool -> Provider Interface -> Local Provider -> Local Fixture
```

## Provider Contracts

- `InventoryProvider.getInventory()`：返回内部 `InventoryData`。
- `RecipeProvider.searchRecipes(query)`：接收 canonical ingredient 与 filters，返回 Recipe records。
- `NutritionProvider.getNutritionBase(itemType, itemId)`：返回未换算的基础营养事实。
- `PriceProvider.getPrices(ingredientIds)`：支持单项与 batch 价格查询。
- `ScheduleProvider.getSchedule(query)`：返回指定规划窗口的日程事实。
- `ProviderError`：支持 `DATA_NOT_FOUND`、`DATA_SOURCE_UNAVAILABLE`、`INVALID_PROVIDER_QUERY`、`PROVIDER_INTERNAL_ERROR` 与配置阶段的 `UNSUPPORTED_PROVIDER`。

Provider 返回内部 Domain Data，不返回 Tool envelope，也没有注册进 Tool Registry。

## Local Providers

- `LocalInventoryProvider`
- `LocalRecipeProvider`
- `LocalNutritionProvider`
- `LocalPriceProvider`
- `LocalScheduleProvider`

所有 Local Provider 只读取当前 V1 Fixture，并返回隔离副本。Recipe Provider 执行查询与 filters；Nutrition Provider 不做 amount/unit 换算；Price Provider 对缺价抛出内部 `DATA_NOT_FOUND`，不会把缺价当作 0；Schedule Provider 对不支持的窗口抛出 `INVALID_PROVIDER_QUERY`。

## Provider Config and Factory

`config/providers.ts` 定义五类 Provider 的最小配置，当前全部为 `local`。`createMealProviders()` 在 Tool catalog 初始化时创建 Provider；任何未知值都会以 `UNSUPPORTED_PROVIDER` fail fast，不会自动回退到 local。

## Dependency Injection

五个数据 Tool 由以下工厂函数接收 Provider：

- `createGetInventoryTool`
- `createSearchRecipesTool`
- `createGetNutritionTool`
- `createGetPricesTool`
- `createGetScheduleTool`

默认导出的 Tool 在组合根使用 Provider Factory 注入 Local Provider。五个数据 Tool 不再导入或读取 `meal-fixtures.ts`。

## Tool Contract Changes

None.

五个数据 Tool 的 name、description、input schema 与 output schema 通过冻结的 SHA-256 contract fingerprints 回归。Registry Probe 还验证了以下既有错误映射：

```text
Recipe DATA_NOT_FOUND     -> INGREDIENT_NOT_FOUND
Nutrition DATA_NOT_FOUND  -> NUTRITION_NOT_FOUND
Price DATA_NOT_FOUND      -> PRICE_NOT_FOUND
Schedule invalid query    -> SCHEDULE_RANGE_UNAVAILABLE
```

`get_nutrition` 的 amount/unit 确定性换算仍位于 Tool；Provider 只返回 base facts。

## Provider Unit Tests

结果：**11 / 11 PASS**。

覆盖内容：

- Inventory：结构、确定性、返回值隔离。
- Recipe：canonical ingredient、filters、空结果、未知食材、返回值隔离。
- Nutrition：ingredient/recipe 基础事实、未知项、无 amount/unit 换算。
- Price：single、batch、missing price、返回值隔离。
- Schedule：规划窗口查询、超范围语义、嵌套返回值隔离。
- Factory：五个 Local Provider 创建与未知 Provider fail fast。

## Tool Contract Regression

结果：**PASS**。

- TypeScript：PASS。
- Oxlint：PASS。
- Provider tests：11 / 11 PASS。
- Domain Solver/Validator tests：6 / 6 PASS。
- DSH Registry/Profile tests：5 / 5 PASS。
- 五个数据 Tool contract fingerprints：5 / 5 PASS。
- 既有数据 Tool error semantics：4 / 4 PASS。
- 七 Tool 确定性规划与验证 flow：PASS。

## Adapter Swap Probe

结果：**PASS**。

Probe 使用同一个 `createGetPricesTool`：

```text
get_prices + LocalPriceProvider -> V1 Fixture price
get_prices + FakePriceProvider  -> deterministic fake price (CNY 99)
```

两种实例的 Tool name、parameters 与 output schema 完全一致。Fake Provider 未注册到 Registry；Runtime、Registry、Agent、Solver、Validator 及 Tool 实现均未修改。

## TC-01 ~ TC-10 Regression

2026-10-04 使用现有 DSH Agent runner 重新执行并覆盖生成 `traces/step5_2/` 证据，随后由 v0.2 assessment script 判定：**10 / 10 PASS**。

| Case | 结果 | 关键验收 |
|---|---|---|
| TC-01 | PASS | 仅调用 `get_inventory` |
| TC-02 | PASS | 仅调用 `get_prices` |
| TC-03 | PASS | Tool 返回 300 g 鸡胸肉的 93 g 蛋白质 |
| TC-04 | PASS | 仅调用 `search_recipes`，返回两项 |
| TC-05 | PASS | 五类数据 Tool -> Solver -> Validator，结果 verified |
| TC-06 | PASS | Solver -> Validator，CNY 45 方案在 CNY 60 预算下 verified |
| TC-07 | PASS | `existing_plan + REMOVE_MEAL` 后 Solver -> Validator，结果 verified |
| TC-08 | PASS | Solver 返回 `NO_FEASIBLE_PLAN`，未生成可信 Plan |
| TC-09 | PASS | 缺鸡胸肉价格映射为 `PRICE_NOT_FOUND`，Solver/Validator 未调用 |
| TC-10 | PASS | Validator 直接拒绝人工非法 Plan，并返回 violations |

TC-09 仍有 Agent 重复拆分价格查询的效率问题，但没有越过缺价阻断语义。

## Known Limitations

- 按 Step 6 边界，Solver 的输入防伪比较与 Validator 的事实来源仍直接绑定本地 Fixture；后续应作为独立的 Domain Fact Source Refactor 处理。
- 当前 Factory 只支持 `local`，未实现真实 API、数据库或自动 fallback。
- Provider trace 字段属于建议项，本阶段未增加 Agent-facing 输出或新的 Runtime trace 基础设施。
- TC-07 的独立 setup 会受模型采样影响产生冗余调用；正式 TC-07 的 Solver/Validator 路径与结果已通过验收。

## Final Decision

**PASS**

最终架构验收问题：如果把 `LocalPriceProvider` 换成另一个符合 `PriceProvider` Contract 的实现，是否可以保持 `get_prices` Tool Contract、DSH Runtime、Agent、Solver、Validator 不变？

**YES。** Adapter Swap Probe 已证明只替换 Provider 实例即可完成切换。
