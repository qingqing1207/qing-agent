# Step 6 文档索引

Step 6 的目标是理解 `learn/step6.js` 中的动态 system prompt 组装模式，并将其集成到正式项目中，让模型在每次对话时都能看到运行时环境信息和项目记忆。

## 文档列表

- [00-learn-step6-explained.md](./00-learn-step6-explained.md)：详细解读 `learn/step6.js` 的 `readAgentMd`、`getGitSection`、`buildSystemPrompt` 三个函数，说明静态角色定义和动态运行时上下文的拆分设计。
- [01-development-plan.md](./01-development-plan.md)：正式集成计划，将系统 prompt 拆为 `git-info`、`agent-md`、`build-system-prompt` 三个模块，在 REPL 层注入 system 参数，包含测试覆盖和验收标准。

## 当前边界

- `learn/step6.js` 只作为动态 system prompt 组装的学习参考，正式项目不直接复制。
- 正式项目新增 `src/prompt/` 模块，在 REPL 层构建 system prompt 后传入已有链路。
- system 参数的传递链路（REPL -> agent loop -> LLM -> API）已在前序步骤完成，Step 6 只负责构建内容。
- 不做 prompt 缓存、AGENT.md 长度截断、多记忆文件支持、自定义角色定义等后续优化。
