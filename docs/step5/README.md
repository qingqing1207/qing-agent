# Step 5 文档索引

Step 5 的目标是理解 `learn/step5.js` 中 6 个核心工具的最小实现，并规划如何将它们分阶段集成到正式项目。

## 文档列表

- [00-learn-step5-explained.md](./00-learn-step5-explained.md)：详细解读 `learn/step5.js` 的 6 个工具（Read / Write / Edit / Grep / Glob / Bash），包括工具契约、路径安全、共享函数和各工具的风险分析。
- [01-development-plan.md](./01-development-plan.md)：正式集成计划，按风险从低到高分阶段实现：Glob -> Grep -> Edit -> Write -> Bash，包含模块设计、路径安全策略和测试覆盖。
- [02-glob-tool-code-explained.md](./02-glob-tool-code-explained.md)：正式项目 Glob 工具实现解读。
- [03-grep-tool-code-explained.md](./03-grep-tool-code-explained.md)：正式项目 Grep 工具实现解读。
- [04-edit-tool-code-explained.md](./04-edit-tool-code-explained.md)：正式项目 Edit 工具实现解读。
- [05-write-tool-code-explained.md](./05-write-tool-code-explained.md)：正式项目 Write 工具实现解读。
- [06-bash-tool-code-explained.md](./06-bash-tool-code-explained.md)：正式项目 Bash 工具实现解读。
- [07-multi-tool-call-flow.md](./07-multi-tool-call-flow.md)：多工具并行调用的完整流程分析。

## 当前边界

- `learn/step5.js` 只作为工具最小实现的学习参考，正式项目不直接照搬。
- 只读工具（Glob / Grep）风险低，优先集成。
- 副作用工具（Edit / Write / Bash）需要权限确认和安全策略，分阶段集成。
- 路径安全函数提升为共享模块 `src/tools/workspace-path.ts`。
