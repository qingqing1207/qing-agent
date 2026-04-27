# Step 3：把工具接口、Read 工具和工具调用循环设计进正式项目

`learn/step3.js` 是学习样例，它证明了工具层的最小组成：

1. 工具对象要同时包含 API 描述和本地执行函数。
2. 工具需要集中注册。
3. 发给 Anthropic 的工具定义只包含 `name`、`description`、`input_schema`。
4. 模型返回 `tool_use` 后，项目必须在本地执行工具。
5. 工具结果要以 `tool_result` block 的形式作为下一条 `user` message 回传模型。

正式项目里不要只把 `readTool` 复制到 `src/`。Step 3 应该补上一个清晰的工具系统，并把它接入当前 Step 1/Step 2 已完成的 streaming client 和 REPL。

## 目标

本阶段实现“最小可用工具调用循环”。

要完成的能力：

- 项目有统一的工具契约类型。
- 项目内置一个 `Read` 工具，可以读取 workspace 内文本文件并带行号返回。
- `Read` 工具只能读取 workspace 内路径，不能逃出当前项目根目录。
- `streamMessage()` 调用时可以带上已启用工具的 Anthropic API 参数。
- 当模型返回 `tool_use` 时，项目能找到本地工具并执行。
- 工具执行结果能转换成 Anthropic `tool_result` content block。
- agent 可以在一轮用户输入内完成“模型请求工具 -> 执行工具 -> 回传结果 -> 模型继续回答”的循环。
- REPL 可以使用工具循环，而不是只打印 `[tool: name]`。
- 单元测试不访问真实 API，也不依赖真实终端。

暂不做的能力：

- 不做写文件、改文件、执行 shell 等有副作用工具。
- 不做权限确认 UI。
- 不做 MCP。
- 不接 Anthropic server tools。
- 不做工具并发优化。
- 不做文件索引、搜索、长期记忆。
- 不做复杂会话持久化。

## 从 learn 到 src 的设计映射

| `learn/step3.js` 中的能力 | 正式项目模块 | 说明 |
| --- | --- | --- |
| 工具对象约定 | `src/tools/types.ts` | 定义工具契约、上下文、结果类型 |
| `resolveWorkspacePath()` | `src/tools/read/workspace-path.ts` | Read 工具自己的路径安全逻辑 |
| `addLineNumbers()` | `src/tools/read/line-numbers.ts` | Read 工具自己的输出格式化逻辑 |
| `readTool` | `src/tools/read/index.ts` | 第一个内置只读工具 |
| `allTools` | `src/tools/registry.ts` | 集中注册工具 |
| `findToolByName()` | `src/tools/registry.ts` | 根据 `tool_use.name` 查找本地工具 |
| `getToolsApiParams()` | `src/tools/anthropic-tools.ts` 或 `registry.ts` | 转换成 Anthropic `tools` 参数 |
| 工具结果回传 | `src/agent/tool-results.ts` | 创建 `tool_result` content block |
| 工具调用循环 | `src/agent/agent-loop.ts` | 串起模型调用、工具执行和再次调用模型 |
| REPL 使用工具 | `src/cli/repl.ts` | 从单次 assistant turn 切换到 agent turn |

推荐先把 `anthropic-tools.ts` 合进 `registry.ts`，等工具数量变多再拆。当前阶段减少文件数量更重要。

工具目录不要围绕 `Read` 这个具体工具铺开。顶层 `src/tools/` 只放所有工具共享的框架代码；具体工具放进自己的子目录。这样后续增加 `Search`、`Grep`、`Edit`、`Bash` 时，每个工具都能把自己的 schema、校验、执行逻辑和测试收在一起。

## 推荐文件结构

```text
src/
  agent/
    agent-loop.ts
    tool-results.ts
  tools/
    registry.ts
    types.ts
    read/
      index.ts
      line-numbers.ts
      workspace-path.ts
  chat/
    chat-session.ts
  cli/
    repl.ts
  llm/
    stream-message.ts
    types.ts

test/
  agent/
    agent-loop.test.ts
    tool-results.test.ts
  tools/
    registry.test.ts
    read/
      index.test.ts
      line-numbers.test.ts
      workspace-path.test.ts
  cli/
    repl.test.ts
```

这个结构的原则是：

- `src/tools/types.ts`：所有工具共同遵守的接口。
- `src/tools/registry.ts`：工具注册表和 Anthropic API 参数转换。
- `src/tools/read/`：只放 `Read` 这个工具自己的实现细节。

如果后续某个能力真的被多个工具复用，再提升到共享目录。例如路径安全如果以后被 `Read`、`Edit`、`Write` 同时复用，可以从 `src/tools/read/workspace-path.ts` 移到 `src/tools/workspace-path.ts` 或 `src/workspace/paths.ts`。在只有 `Read` 使用时，先留在 `read/` 内部更清楚。

## 类型设计

### 工具契约

建议在 `src/tools/types.ts` 定义内部工具类型：

```ts
export type JsonObject = Record<string, unknown>

export type ToolInputSchema = {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export type ToolContext = {
  cwd: string
}

export type ToolCallResult = {
  content: string
  isError?: boolean
}

export type AgentTool = {
  name: string
  description: string
  inputSchema: ToolInputSchema
  isReadOnly(): boolean
  isEnabled(context?: ToolContext): boolean
  call(input: JsonObject, context: ToolContext): Promise<ToolCallResult>
}
```

内部类型保留 camelCase，例如 `inputSchema`、`isError`。只有在和 Anthropic API 交界时再映射成 snake_case，例如 `input_schema`、`is_error`。

### Anthropic 工具参数

当前 `src/llm/types.ts` 已经让 `StreamMessageInput.tools` 使用 SDK 的 `ToolUnion[]`。对自定义工具来说，转换函数可以返回 SDK 的 `Tool[]` 或 `ToolUnion[]`：

```ts
import type { Tool } from '@anthropic-ai/sdk/resources/messages'
import type { AgentTool } from './types.js'

export function getToolsApiParams(tools: AgentTool[]): Tool[] {
  return tools
    .filter((tool) => tool.isEnabled())
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }))
}
```

这个转换函数是工具系统和 Anthropic SDK 之间的边界。

### 工具结果 block

Anthropic 的工具结果类型是 `ToolResultBlockParam`。建议单独封装：

```ts
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { ToolCallResult } from '../tools/types.js'

export function createToolResultBlock(
  toolUseId: string,
  result: ToolCallResult
): ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: result.content,
    ...(result.isError ? { is_error: true } : {})
  }
}
```

注意这里必须用 `tool_use_id` 和 `is_error`，不能沿用内部的 `toolUseId`、`isError`。

## `Read` 工具设计

### API schema

正式项目建议比学习样例更严格：

```ts
export const readToolInputSchema = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'Workspace-relative path of the text file to read.'
    },
    offset: {
      type: 'integer',
      minimum: 1,
      description: '1-based line number to start reading from.'
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 2000,
      description: 'Maximum number of lines to return.'
    }
  },
  required: ['file_path'],
  additionalProperties: false
} satisfies ToolInputSchema
```

这里用 `integer` 而不是 `number`，因为行号不应该是小数。

### 运行时校验

JSON Schema 是给模型看的，不等于运行时安全校验。正式项目应该用 Zod 或手写校验再次验证：

```ts
const readInputSchema = z
  .object({
    file_path: z.string().min(1),
    offset: z.number().int().min(1).optional().default(1),
    limit: z.number().int().min(1).max(2000).optional()
  })
  .strict()
```

原因：

- 模型可能生成不符合 schema 的参数。
- 兼容服务也可能不严格校验工具输入。
- 本地工具是安全边界，必须自己验证。

校验失败不要让 agent loop 崩掉，应该返回：

```ts
{
  content: 'Error: invalid Read input: ...',
  isError: true
}
```

### 路径安全

`learn/step3.js` 的 `path.relative()` 防护是好的起点，但正式项目建议：

1. 把 `cwd` 解析成真实路径。
2. 把候选文件解析成真实路径。
3. 确认真实文件路径仍在真实 workspace 根目录下。

这样可以防止符号链接逃逸：

```text
workspace/link -> /Users/name/.ssh
Read({ file_path: 'link/id_rsa' })
```

对于 `Read` 工具，文件必须已经存在，所以 `fs.realpath()` 可以直接使用。后续如果做写文件工具，目标文件可能不存在，路径策略要重新设计。

### 输出格式

建议输出使用 workspace 相对路径，减少本机绝对路径噪音：

```text
File: src/index.ts
Lines: 1-3 / 3
1	import { runRepl } from './cli/repl.js'
2	
3	await runRepl()
```

如果读取失败：

```text
Error reading file: src/missing.ts does not exist
```

错误也要回传给模型，不能只打印给用户。

## Agent loop 设计

当前 `src/cli/repl.ts` 的核心是 `renderAssistantTurn()`：调用一次 `streamMessage()`，渲染文本，然后返回最终 assistant message。

Step 3 需要新增一层 `agent-loop`，把“可能多次调用模型”封装起来。

完整流程：

```text
用户输入
  |
  v
ChatSession.addUserMessage()
  |
  v
runAgentTurn({ messages, tools, cwd })
  |
  | 第 1 次 streamMessage({ messages, tools })
  v
assistant 返回 text/tool_use
  |
  | 如果 stopReason 不是 tool_use，结束
  |
  | 如果有 tool_use：
  v
保存 assistant message
执行本地工具
生成 user tool_result message
  |
  | 第 2 次 streamMessage({ messages + assistant + tool_result, tools })
  v
assistant 基于工具结果继续回答
```

建议实现成 async generator，保留 streaming 渲染体验：

```ts
export type AgentTurnEvent =
  | StreamMessageEvent
  | { type: 'tool_result'; toolUseId: string; toolName: string; isError: boolean }

export type AgentTurnResult = {
  messagesToAppend: MessageParam[]
  finalAssistantMessage: StreamMessageResult['assistantMessage']
  usage: Usage
  stopReason: string
}

export async function* runAgentTurn(
  input: AgentTurnInput
): AsyncGenerator<AgentTurnEvent, AgentTurnResult> {
  // loop until end_turn or maxToolRounds reached
}
```

`messagesToAppend` 很重要。一次用户输入可能产生多条需要写入历史的消息：

1. assistant message，里面有 `tool_use`。
2. user message，里面有 `tool_result`。
3. 最终 assistant message。

如果 REPL 只保存最后一条 assistant message，下一轮模型就不知道之前的工具调用发生过。

## Agent loop 的停止条件

必须设置停止条件，避免模型反复调用工具导致无限循环。

建议：

```ts
const DEFAULT_MAX_TOOL_ROUNDS = 8
```

停止规则：

- 如果 `stopReason !== 'tool_use'`，结束。
- 如果 assistant message 里没有 `tool_use` block，结束。
- 如果工具轮数超过 `maxToolRounds`，返回错误或抛出清晰错误。

超过轮数时，推荐把错误作为最终异常交给 REPL 渲染：

```text
[error] Tool loop exceeded max rounds: 8
```

这个阶段不需要让模型继续处理这个错误，因为它通常表示 loop 控制问题。

## 多个工具调用的处理

即使 Step 3 只有一个 `Read` 工具，也要按“可能多个 tool_use”来设计。

如果 assistant message 内容是：

```ts
[
  { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'src/a.ts' } },
  { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: 'src/b.ts' } }
]
```

应该执行两个工具，并生成一条 user message：

```ts
{
  role: 'user',
  content: [
    { type: 'tool_result', tool_use_id: 'toolu_1', content: '...' },
    { type: 'tool_result', tool_use_id: 'toolu_2', content: '...' }
  ]
}
```

这个阶段可以先串行执行，简单、可测试。以后如果工具都是只读，再考虑并行执行。

## 未知工具和工具异常

模型可能返回不存在的工具名：

```ts
{ type: 'tool_use', id: 'toolu_x', name: 'Write', input: {} }
```

不要直接崩溃。应该生成错误工具结果：

```ts
{
  type: 'tool_result',
  tool_use_id: 'toolu_x',
  content: 'Error: unknown tool Write',
  is_error: true
}
```

工具执行时抛异常，也应该被 agent loop 捕获并转换为 `tool_result`：

```ts
{
  content: 'Error running tool Read: permission denied',
  isError: true
}
```

这样模型还能基于错误信息改正路径或向用户解释。

## ChatSession 调整

当前 `ChatSession` 支持：

```ts
addUserMessage(content: string): void
addAssistantMessage(result: StreamMessageResult): void
```

Step 3 需要能追加任意 Anthropic message，因为工具循环会产生 `tool_result` user message。

建议新增：

```ts
addMessage(message: MessageParam): void

addMessages(messages: MessageParam[]): void {
  for (const message of messages) {
    this.addMessage(message)
  }
}
```

保留原有 `addUserMessage()`，因为 REPL 普通用户输入仍然常用。

REPL 流程变成：

```ts
session.addUserMessage(command.text)

const result = await renderAgentTurn({
  messages: session.getMessages(),
  cwd: process.cwd(),
  runAgentTurn
})

session.addMessages(result.messagesToAppend)
```

这里不要再只调用 `session.addAssistantMessage(result)`。

## REPL 渲染调整

Step 2 中遇到 `tool_use_start` 只是打印：

```text
[tool: Read]
```

Step 3 可以继续保留这个提示，但还应该在工具执行完成后打印结果摘要：

```text
assistant: 我先读取入口文件。

[tool: Read]
[tool result: Read ok]
assistant: 这个项目入口调用了 runRepl()...
```

不要默认把完整文件内容全部打印给用户。完整内容已经发给模型，CLI 只需要给用户一个工具执行状态。否则读取大文件时终端会很吵。

建议渲染规则：

- `text`：照常 streaming 输出。
- `tool_use_start`：换行显示 `[tool: Read]`。
- `tool_result`：显示 `[tool result: Read ok]` 或 `[tool result: Read error]`。
- 每次新的 assistant streaming 文本开始时，如果前面刚输出过工具状态，补一个 `assistant: ` 前缀。

渲染细节可以先保持简单，先保证消息历史和工具回传正确。

## 测试计划

### `tools/read/workspace-path.test.ts`

覆盖：

- `src/index.ts` 可以解析。
- `./src/index.ts` 可以解析。
- `../outside.txt` 被拒绝。
- 绝对路径指向 workspace 外被拒绝。
- 符号链接指向 workspace 外被拒绝。

### `tools/read/line-numbers.test.ts`

覆盖：

- 默认从 1 开始。
- 可以从指定行号开始。
- Windows 换行 `\r\n` 可以处理。
- 多位数行号右对齐。

### `tools/read/index.test.ts`

覆盖：

- 读取完整文件。
- `offset` 从 1 开始。
- `limit` 限制行数。
- 缺少 `file_path` 返回 `isError`。
- 无效 input 返回 `isError`。
- 文件不存在返回 `isError`。
- workspace 外路径返回 `isError`。

### `registry.test.ts`

覆盖：

- `findToolByName('Read')` 找到工具。
- 未知工具返回 `undefined`。
- disabled 工具不会出现在 API params。
- API params 使用 `input_schema`，不包含 `call`、`isReadOnly`、`isEnabled`。

### `tool-results.test.ts`

覆盖：

- 成功结果映射成 `tool_result`。
- 错误结果包含 `is_error: true`。
- 空内容仍然是合法字符串。

### `agent-loop.test.ts`

用 fake `sendMessage` 和 fake tools，不访问网络。

覆盖：

- 没有 `tool_use` 时只调用一次模型。
- 有 `tool_use` 时执行工具并再次调用模型。
- `messagesToAppend` 包含 assistant `tool_use` message、user `tool_result` message、最终 assistant message。
- 未知工具会生成 error `tool_result`。
- 工具抛异常会生成 error `tool_result`。
- 多个 `tool_use` 会生成多个 `tool_result`。
- 超过 `maxToolRounds` 会失败。

### `repl.test.ts`

更新现有测试：

- 普通文本仍然能渲染。
- 当 fake agent turn 产生 tool events 时，REPL 渲染工具状态。
- REPL 会把 agent turn 返回的多条消息追加到历史。
- `/clear` 仍然清空完整历史。

## 建议实施顺序

1. 新增 `src/tools/types.ts`，先稳定内部工具契约。
2. 新增 `src/tools/read/line-numbers.ts` 和 `src/tools/read/workspace-path.ts`，写纯函数测试。
3. 新增 `src/tools/read/index.ts`，用 Zod 做运行时输入校验。
4. 新增 `registry.ts`，实现 `allTools`、`findToolByName()`、`getToolsApiParams()`。
5. 新增 `tool-results.ts`，实现 Anthropic `tool_result` 映射。
6. 新增 `agent-loop.ts`，用 fake stream 和 fake tool 测试工具调用循环。
7. 调整 `ChatSession`，支持追加多条 `MessageParam`。
8. 调整 `repl.ts`，把单次 `streamMessage()` 渲染替换成 `runAgentTurn()` 渲染。
9. 运行 `npm run check`。
10. 手动用 `npm run repl` 验证模型可以读取项目文件。

## 验收标准

完成 Step 3 后，应该能在 REPL 中输入类似：

```text
请读取 src/index.ts 并解释入口做了什么
```

预期行为：

1. 模型返回 `tool_use`，工具名是 `Read`。
2. 项目执行 `Read`，读取 workspace 内文件。
3. 项目把 `tool_result` 回传模型。
4. 模型基于文件内容给出解释。
5. 下一轮对话历史包含用户消息、assistant tool_use message、user tool_result message、最终 assistant message。

工程验收：

- `npm run typecheck` 通过。
- `npm run lint` 通过。
- `npm run test` 通过。
- 工具测试不访问真实 API。
- agent loop 测试不访问真实 API。

## 当前阶段需要特别守住的边界

只做 `Read`。

不要顺手做 `Write`、`Edit`、`Bash`。这些工具会引入权限确认、撤销策略、路径写入安全、命令超时、进程管理等新问题。Step 3 的目标是先把 Anthropic 工具调用协议和本地工具执行闭环打通。

也不要把工具执行塞进 `streamMessage()`。`streamMessage()` 的职责仍然是“单次模型调用 + stream 解析”。工具执行属于 agent 层。如果把两者混在一起，后续测试、重试、UI 渲染和多工具策略都会变复杂。
