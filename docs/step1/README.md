# Step 1 文档索引

Step 1 的目标是把 `learn/step1.js` 中的最小 LLM streaming client 核心流程，设计成正式项目中的可维护模块，并能单独测试验证。

## 文档列表

- [00-learn-step1-explained.md](./00-learn-step1-explained.md)：详细解读 `learn/step1.js` 的设计、事件流程、每一步作用和关键语法。
- [01-development-plan.md](./01-development-plan.md)：开发规划、模块拆分、类型设计、测试验证方式和验收标准。

## 当前边界

- `learn/step1.js` 只作为学习参考。
- 正式实现放在 `src/llm/`。
- 单元测试不依赖真实 API。
- smoke 测试用于手动验证真实模型链路。
