# Step 4 文档索引

Step 4 的目标是理解 `learn/step4.js` 中的最小 agentic loop，以及正式项目如何把流式模型调用和工具系统串联成完整的 agent 循环。

## 文档列表

- [00-learn-step4-explained.md](./00-learn-step4-explained.md)：详细解读 `learn/step4.js` 的 `runTools` 和 `query` 两个核心函数，说明 tool_use -> tool_result -> 再次调用模型的循环机制。
- [01-project-step3-comparison.md](./01-project-step3-comparison.md)：对照正式项目与 `learn/step4.js` 的实现差异，说明正式项目 Step 3 已经完成了 agentic loop 的核心能力。

## 当前边界

- `learn/step4.js` 只作为最小 agentic loop 的学习参考。
- 正式项目的 agent loop 已在 `src/agent/agent-loop.ts` 中实现，不直接复制 `learn/step4.js`。
- Step 4 只关注 tool_use 循环，不涉及多工具并行调用、工具权限、prompt 组装等。
- 工具系统（Read）已在 Step 3 集成，Step 4 不新增工具。
