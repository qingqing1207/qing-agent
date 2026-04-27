# Step 3 文档索引

Step 3 的目标是理解 `learn/step3.js` 中的最小工具接口和第一个 `Read` 工具，并规划如何把 Anthropic 工具调用协议接入正式项目。

## 文档列表

- [00-learn-step3-explained.md](./00-learn-step3-explained.md)：详细解读 `learn/step3.js` 的工具契约、`Read` 工具、工具注册方式，以及 Anthropic `tools`、`tool_use`、`tool_result` 的调用规则。
- [01-development-plan.md](./01-development-plan.md)：规划如何把 Step 3 集成进正式项目，包括工具模块拆分、Read 工具实现、agent loop、REPL 集成、测试方式和验收标准。

## 当前边界

- `learn/step3.js` 只作为工具接口和 Read 工具的学习参考。
- 正式实现不直接复制 `learn/step3.js`，而是基于它设计 `src/tools/` 和 `src/agent/`。
- Step 3 只实现只读 `Read` 工具和最小工具调用循环。
- 不做写文件、编辑文件、执行 shell、MCP 或权限确认 UI。
- `streamMessage()` 仍然只负责单次模型调用和 stream 解析，工具执行放在 agent 层。
