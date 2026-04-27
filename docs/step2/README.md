# Step 2 文档索引

Step 2 的目标是理解 `learn/step2.js` 中的最小交互式 REPL，并把它设计成正式项目里的 CLI 对话入口。

## 文档列表

- [00-learn-step2-explained.md](./00-learn-step2-explained.md)：详细解读 `learn/step2.js` 的流程、状态管理、命令处理、stream 消费方式和 REPL 原理。
- [01-development-plan.md](./01-development-plan.md)：规划如何把 Step 2 集成进正式项目，包括模块拆分、测试方式、命令脚本和验收标准。

## 当前边界

- `learn/step2.js` 只作为最小 REPL 学习参考。
- 正式实现不直接复制 `learn/step2.js`，而是基于它的核心流程设计 CLI 模块。
- Step 2 只做多轮对话和历史维护，不执行工具。
- 工具调用只打印提示，真正执行工具留给后续步骤。
