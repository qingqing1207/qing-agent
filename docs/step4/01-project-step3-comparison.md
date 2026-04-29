# Step 4：正式项目与 `learn/step4.js` 对照

结论先说：

```text
learn/step4.js 里的最小 agentic loop，正式项目 Step 3 已经基本完成。
```

正式项目不是直接复制 `learn/step4.js`，而是把它拆成了更清晰的生产代码结构：

```text
src/llm/
  单次模型调用和 stream 解析

src/tools/
  工具契约、工具注册、Read 工具

src/agent/
  agent loop、tool_result 转换

src/chat/
  长期会话历史

src/cli/
  REPL 渲染和用户输入
```

## 功能对照表

| `learn/step4.js` | 正式项目 | 状态 |
| --- | --- | --- |
| `streamMessage()` | `src/llm/stream-message.ts` | 已完成 |
| `getToolsApiParams()` | `src/tools/registry.ts` | 已完成 |
| `findToolByName()` | `src/tools/registry.ts` | 已完成 |
| `runTools()` | `src/agent/agent-loop.ts` 的 `runToolUse()` + `src/agent/tool-results.ts` | 已完成 |
| `query()` | `src/agent/agent-loop.ts` 的 `runAgentTurn()` | 已完成 |
| `state.messages` | `runAgentTurn()` 的 `currentMessages` | 已完成 |
| `state.turnCount` | `toolRounds` | 已完成 |
| `maxTurns = 8` | `DEFAULT_MAX_TOOL_ROUNDS = 8` | 已完成 |
| 低层 stream event 转发 | `yield* runModelTurn(...)` | 已完成 |
| `assistant_message` event | 无独立事件 | 未照搬，设计上不需要 |
| `tool_result_message` event | `{ type: 'tool_result', toolUseId, toolName, isError }` | 部分采用，结构更适合 CLI |
| 返回 `{ state, usage, reason }` | 返回 `AgentTurnResult` | 已完成，但结构不同 |

## 正式项目如何完成 Step 4 核心闭环

`learn/step4.js` 的核心闭环是：

```text
模型调用
  -> assistant tool_use
  -> 执行工具
  -> user tool_result
  -> 再次模型调用
  -> 最终 assistant answer
```

正式项目对应代码在：

```text
src/agent/agent-loop.ts
```

核心函数：

```ts
export async function* runAgentTurn(
  input: AgentTurnInput
): AsyncGenerator<AgentTurnEvent, AgentTurnResult>
```

它每轮调用模型：

```ts
const result = yield* runModelTurn(...)
```

保存 assistant message：

```ts
messagesToAppend.push(result.assistantMessage)
currentMessages.push(result.assistantMessage)
```

检查工具调用：

```ts
const toolUses = getToolUseBlocks(result.assistantMessage.content)
```

如果不是工具调用，结束本轮：

```ts
if (result.stopReason !== 'tool_use' || toolUses.length === 0) {
  return {
    messagesToAppend,
    finalAssistantMessage: result.assistantMessage,
    usage: totalUsage,
    stopReason: result.stopReason
  }
}
```

如果有工具调用，执行工具并生成 tool result message：

```ts
const toolResult = await runToolUse(toolUse, tools, context)
toolResultBlocks.push(createToolResultBlock(toolUse.id, toolResult))
```

再追加到下一次模型调用上下文：

```ts
messagesToAppend.push(toolResultMessage)
currentMessages.push(toolResultMessage)
```

这已经完整覆盖 `learn/step4.js` 的 `query()` 流程。

## 正式项目比 `learn/step4.js` 更完整的地方

### 1. 工具结果转换被单独封装

学习版直接在 `runTools()` 里写：

```js
{
  type: 'tool_result',
  tool_use_id: block.id,
  content: result.content,
  ...(result.isError ? { is_error: true } : {})
}
```

正式项目拆成：

```text
src/agent/tool-results.ts
```

```ts
export function createToolResultBlock(
  toolUseId: string,
  result: ToolCallResult
): ToolResultBlockParam
```

好处：

```text
agent loop 不需要关心 snake_case 协议细节。
tool_result 映射可以单独测试。
后续如果支持更多 tool result 内容形态，可以集中修改。
```

### 2. 工具系统有正式内部契约

学习版依赖 Step 3 的工具对象，但没有类型约束。

正式项目有：

```text
src/tools/types.ts
```

```ts
export type AgentTool = {
  name: string
  description: string
  inputSchema: ToolInputSchema
  isReadOnly(): boolean
  isEnabled(context?: ToolContext): boolean
  call(input: JsonObject, context: ToolContext): Promise<ToolCallResult>
}
```

好处：

```text
所有工具有统一接口。
后续新增 Search、Edit、Bash 时不会散落不同约定。
测试可以 fake AgentTool。
```

### 3. `Read` 工具更安全

学习样例只演示 agent loop，不负责强化工具安全。

正式项目的 `Read` 工具包含：

```text
Zod 运行时输入校验
workspace realpath 校验
symlink 逃逸防护
offset / limit
行号格式化
```

对应文件：

```text
src/tools/read/index.ts
src/tools/read/workspace-path.ts
src/tools/read/line-numbers.ts
```

### 4. REPL 已经接入 agent loop

学习版只提供 `query()`，没有正式 UI 集成。

正式项目已经在：

```text
src/cli/repl.ts
```

接入：

```ts
const result = await renderAgentTurn(...)
session.addMessages(result.messagesToAppend)
```

这意味着用户在 REPL 输入：

```text
请读取 src/index.ts 并解释入口做了什么
```

模型可以实际调用 `Read`，再基于工具结果回答。

### 5. 支持 thinking block 回传

学习版没有处理 thinking/reasoning block。

正式项目已经在：

```text
src/llm/stream-message.ts
src/llm/types.ts
```

保留：

```ts
thinking
redacted_thinking
```

这是 DeepSeek Anthropic 兼容接口下避免 400 的必要修复。

## 没有照搬的部分

### 1. 没有 `assistant_message` 事件

学习版有：

```js
yield { type: 'assistant_message', message: result.assistantMessage }
```

正式项目没有这个事件。

当前正式项目只 yield：

```ts
StreamMessageEvent
{ type: 'tool_result'; toolUseId; toolName; isError }
```

原因：

```text
REPL 当前不需要在每次模型调用结束时拿完整 assistant message 来渲染。
完整 assistant message 会进入 AgentTurnResult.messagesToAppend。
如果额外 yield assistant_message，会让 UI 事件和历史持久化数据产生重复职责。
```

所以这不是缺失，而是设计取舍。

### 2. 没有 `tool_result_message` 事件

学习版有：

```js
yield { type: 'tool_result_message', message: toolResultMessage }
```

正式项目使用更轻量的 UI 事件：

```ts
{
  type: 'tool_result',
  toolUseId: string,
  toolName: string,
  isError: boolean
}
```

原因：

```text
REPL 只需要显示 [tool result: Read ok]。
不应该默认把完整文件内容输出到终端。
完整 tool_result message 已经在 messagesToAppend 里返回给 ChatSession。
```

这个设计比学习版更适合真实 CLI。

### 3. 没有返回完整 `state`

学习版返回：

```js
return { state, usage: result.usage, reason: 'completed' }
```

正式项目返回：

```ts
export type AgentTurnResult = {
  messagesToAppend: MessageParam[]
  finalAssistantMessage: StreamMessageResult['assistantMessage']
  usage: Usage
  stopReason: string
}
```

原因：

```text
长期历史归 ChatSession 管。
runAgentTurn() 只负责一次用户输入产生的新消息。
返回完整 state 会模糊 agent loop 和 session 的职责边界。
```

所以正式项目只返回：

```text
messagesToAppend
```

由 REPL 写回：

```ts
session.addMessages(result.messagesToAppend)
```

### 4. 没有 `reason: 'completed' | 'max_turns'`

学习版返回：

```js
reason: 'completed'
reason: 'max_turns'
```

正式项目使用：

```ts
stopReason: string
```

并且超出工具轮数时抛错：

```ts
throw new Error(`Tool loop exceeded max rounds: ${maxToolRounds}`)
```

这也是设计差异。

学习版把 max turns 当成一种返回结果。

正式项目把它当成异常，因为工具循环超限通常代表控制流程或模型行为异常，应该由 REPL 显示错误：

```text
[error] Tool loop exceeded max rounds: 8
```

## 单以 `step4.js` 为参考，正式项目还可以优化什么

当前没有必须补齐的功能。

但如果只以 `step4.js` 为参考，有几个可选优化点。

## 可选优化 1：增加高层调试事件

### 背景

学习版会 yield：

```js
{ type: 'assistant_message', message: result.assistantMessage }
{ type: 'tool_result_message', message: toolResultMessage }
```

正式项目没有这些事件。

当前 REPL 不需要，但调试、日志、测试工具可能会需要。

### 是否建议现在做

不建议现在做成默认 UI 行为。

可以考虑增加只供调试使用的高层事件：

```ts
export type AgentTurnEvent =
  | StreamMessageEvent
  | { type: 'tool_result'; toolUseId: string; toolName: string; isError: boolean }
  | { type: 'assistant_message'; message: StreamMessageResult['assistantMessage'] }
  | { type: 'tool_result_message'; message: MessageParam }
```

然后在 `runAgentTurn()` 中：

```ts
messagesToAppend.push(result.assistantMessage)
currentMessages.push(result.assistantMessage)
yield { type: 'assistant_message', message: result.assistantMessage }
```

工具结果后：

```ts
messagesToAppend.push(toolResultMessage)
currentMessages.push(toolResultMessage)
yield { type: 'tool_result_message', message: toolResultMessage }
```

### 集成注意点

REPL 应该默认忽略这两个事件，避免打印完整 tool result 内容。

```ts
if (event.type === 'assistant_message') {
  return needsAssistantPrefix
}

if (event.type === 'tool_result_message') {
  return needsAssistantPrefix
}
```

测试需要补：

```text
agent-loop.test.ts
  - assistant_message event 在每次模型调用完成后出现
  - tool_result_message event 在工具结果生成后出现

repl.test.ts
  - REPL 不打印完整 tool_result_message.content
```

### 结论

这是调试增强，不是 Step 4 必需功能。

当前可以暂不做。

## 可选优化 2：返回更明确的完成原因

### 背景

学习版返回：

```js
reason: 'completed'
reason: 'max_turns'
```

正式项目返回：

```ts
stopReason: string
```

并且 max tool rounds 直接抛错。

### 可选设计

如果希望调用方不用 try/catch 区分 max rounds，可以改成：

```ts
export type AgentTurnResult = {
  messagesToAppend: MessageParam[]
  finalAssistantMessage?: StreamMessageResult['assistantMessage']
  usage: Usage
  stopReason: string
  reason: 'completed' | 'max_tool_rounds'
}
```

超限时 return：

```ts
return {
  messagesToAppend,
  usage: totalUsage,
  stopReason: 'tool_use',
  reason: 'max_tool_rounds'
}
```

### 为什么不建议现在做

当前 REPL 的错误处理已经清晰：

```ts
catch (error) {
  renderer.line(`[error] ${formatError(error)}`)
}
```

工具循环超限不是正常业务分支，抛错更直接。

### 结论

保持当前实现即可。

## 可选优化 3：累计 usage 的语义文档化

### 背景

学习版只返回最后一次模型调用的 usage：

```js
return { state, usage: result.usage, reason: 'completed' }
```

正式项目累计了所有模型调用：

```ts
totalUsage.inputTokens += result.usage.inputTokens
totalUsage.outputTokens += result.usage.outputTokens
```

这比学习版更适合真实 agent turn。

### 可选优化

可以在 `AgentTurnResult` 注释或文档里明确：

```text
usage 是本次 agent turn 内所有模型调用的 token 总和。
```

### 集成方式

只需补充文档或类型注释。

如果要更细，可以未来扩展：

```ts
usageByModelTurn: Usage[]
```

但现在没有必要。

## 可选优化 4：把 `runToolUse()` 拆成可导出的 `runTools()`

### 背景

学习版有独立导出：

```js
export async function runTools(contentBlocks, toolContext)
```

正式项目的工具执行逻辑在 `agent-loop.ts` 内部：

```ts
async function runToolUse(...)
```

### 是否需要

当前不需要。

因为正式项目外部没有单独执行 assistant content blocks 的需求。

如果后续需要在测试工具、调试命令、非 REPL UI 中复用，可以新增：

```text
src/agent/run-tools.ts
```

设计：

```ts
export async function runTools(
  contentBlocks: AssistantContentBlock[],
  tools: AgentTool[],
  context: ToolContext
): Promise<{
  message: MessageParam
  events: AgentTurnEvent[]
}>
```

然后 `agent-loop.ts` 调用它。

### 集成步骤

1. 新增 `src/agent/run-tools.ts`。
2. 把 `getToolUseBlocks()` 和 `runToolUse()` 移进去。
3. 返回 `{ message, events }`。
4. `agent-loop.ts` 中替换 for-loop。
5. 迁移或新增测试。

### 为什么暂不建议做

当前只有 `runAgentTurn()` 使用这段逻辑。

过早拆文件会增加跳转成本。

## 可选优化 5：空 tool_result message 防御

### 背景

学习版 `runTools()` 如果没有任何 `tool_use`，会返回：

```js
{ role: 'user', content: [] }
```

正式项目避免了这个情况：

```ts
const toolUses = getToolUseBlocks(result.assistantMessage.content)

if (result.stopReason !== 'tool_use' || toolUses.length === 0) {
  return ...
}
```

只有 `toolUses.length > 0` 才会创建 tool result message。

### 结论

正式项目已经比学习版更稳，不需要改。

## 当前建议

以 `learn/step4.js` 为参考，正式项目目前不需要新增功能。

最值得做的是文档层面的确认：

```text
Step 4 学习样例的核心能力已在 Step 3 正式实现中完成。
```

如果后续要继续推进，建议不要围绕 `learn/step4.js` 重复实现，而是进入新的能力边界，例如：

```text
更多工具
权限确认
写文件/Edit 工具
Bash 工具
更完整的会话持久化
工具并发或调度策略
```

但这些都已经超出 `learn/step4.js` 的范围。

