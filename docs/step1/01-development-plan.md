# Step 1：把最小 LLM Streaming Client 写进正式项目

`learn/step1.js` 是学习样例，它的价值是把最小链路讲清楚：

1. 从环境变量创建 Anthropic 兼容客户端。
2. 定义最基础的 content block：`text` 和 `tool_use`。
3. 调用 `client.messages.stream()` 发起一次 assistant turn。
4. 消费 streaming events，把文本增量、工具调用开始、结束事件转换成内部事件。
5. 组装最终的 assistant message、usage 和 stop reason。

正式项目里不要把它逐行翻译成 TypeScript。应该把这些核心步骤拆成可维护、可测试、可扩展的模块。

## 目标

本阶段只实现“单轮 LLM streaming client”，不做完整 agent loop。

要完成的能力：

- 可以从 `src/index.ts` 或测试脚本单独调用一次模型。
- 可以实时拿到文本增量事件，用于后续 CLI/UI 渲染。
- 可以识别工具调用开始事件，并在最终 assistant message 中保留完整 `tool_use` block。
- 可以返回一次请求的 `usage` 和 `stopReason`。
- 核心 stream 解析逻辑可以用 mock event 单独测试，不依赖真实 API。

暂不做的能力：

- 不执行工具调用。
- 不把 tool result 回传给模型。
- 不实现多轮 agent loop。
- 不做对话历史压缩、重试、限流、缓存。

## 从 learn 到 src 的设计映射

| `learn/step1.js` 中的能力              | 正式项目模块                                         | 说明                                        |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `DEFAULT_MODEL` / `DEFAULT_MAX_TOKENS` | `src/config/env.ts` / `src/llm/constants.ts`         | 环境变量和默认常量分开管理                  |
| `getClient()`                          | `src/llm/anthropic-client.ts`                        | 只负责创建 SDK client                       |
| `textBlock()` / `toolUseBlock()`       | `src/llm/content-blocks.ts`                          | 只负责构造标准 content block                |
| `streamMessage()` 参数类型             | `src/llm/types.ts`                                   | 明确定义项目自己的输入、输出、事件类型      |
| SDK event switch                       | `src/llm/stream-message.ts`                          | 核心逻辑，负责把 SDK stream 转成内部 stream |
| 手动调用验证                           | `src/index.ts` 或 `test/smoke/step1-stream-smoke.ts` | 用真实 API 做 smoke test                    |
| mock event 验证                        | `test/llm/stream-message.test.ts`                    | 不访问网络，验证解析逻辑                    |

建议先保持 `src/llm/` 小而清晰，不要提前抽象 provider。等第二个模型供应商或第二种协议真的出现，再考虑 provider interface。

## 推荐文件结构

```text
src/
  config/
    env.ts
  llm/
    anthropic-client.ts
    constants.ts
    content-blocks.ts
    stream-message.ts
    types.ts
  index.ts

test/
  llm/
    stream-message.test.ts
  smoke/
    step1-stream-smoke.ts
```

`test/llm/` 放单元测试，必须可重复、快速、不访问真实 API。

`test/smoke/` 放真实 API 验证，需要 `.env` 中有有效配置，不默认放进 `check`。

## 类型设计

项目内部不要直接把 SDK 类型散落到业务代码里。建议先定义一层最小内部类型。

```ts
export type TextBlock = {
  type: 'text'
  text: string
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type AssistantContentBlock = TextBlock | ToolUseBlock

export type Usage = {
  inputTokens: number
  outputTokens: number
}

export type StreamMessageInput = {
  messages: unknown[]
  model?: string
  system?: string
  tools?: unknown[]
}

export type StreamMessageEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'message_done'; stopReason: string; usage: Usage }

export type StreamMessageResult = {
  assistantMessage: {
    role: 'assistant'
    content: AssistantContentBlock[]
  }
  usage: Usage
  stopReason: string
}
```

这里的 `messages` 和 `tools` 可以先用 `unknown[]` 起步，等实现和测试跑通后，再收紧到 Anthropic SDK 的具体类型。这样能先把项目边界搭出来，再逐步提高类型精度。

## 模块职责

### `src/llm/constants.ts`

只放 LLM 默认值：

```ts
export const DEFAULT_MAX_TOKENS = 4096
```

模型名称优先从 `env.ANTHROPIC_MODEL` 读取，不建议在多个文件里写默认模型字符串。

### `src/llm/anthropic-client.ts`

只负责创建 SDK client：

```ts
import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'

export function createAnthropicClient() {
  return new Anthropic({
    apiKey: env.ANTHROPIC_AUTH_TOKEN,
    baseURL: env.ANTHROPIC_BASE_URL
  })
}
```

不要在这个文件里写 stream 解析逻辑。这样后面测试 `stream-message.ts` 时可以注入假 stream，而不需要 mock SDK 构造函数。

### `src/llm/content-blocks.ts`

只负责构造 content block：

```ts
import type { TextBlock, ToolUseBlock } from './types.js'

export function createTextBlock(text = ''): TextBlock {
  return { type: 'text', text }
}

export function createToolUseBlock(
  id: string,
  name: string,
  input: Record<string, unknown> = {}
): ToolUseBlock {
  return { type: 'tool_use', id, name, input }
}
```

这两个函数很小，但它们能让 stream 解析代码更清楚，也方便后续统一 content block 的结构。

### `src/llm/stream-message.ts`

核心职责：

- 接收 `messages`、`system`、`tools`、`model`。
- 创建或接收一个 stream source。
- 遍历 SDK streaming events。
- 对外 `yield` 内部事件。
- 最后 `return` 完整 assistant message。

为了方便测试，建议把 stream source 做成可注入：

```ts
type CreateMessageStream = (input: StreamMessageInput) => AsyncIterable<unknown>

export async function* streamMessage(
  input: StreamMessageInput,
  options?: { createStream?: CreateMessageStream }
): AsyncGenerator<StreamMessageEvent, StreamMessageResult> {
  // options.createStream 存在时用于测试
  // 不存在时调用真实 Anthropic SDK
}
```

这样单元测试可以直接传入 fake stream events，不需要真实网络，也不需要 API key。

## 事件解析规则

先回答一个关键问题：`event.type` 是不是固定的？

对当前项目使用的 `@anthropic-ai/sdk@0.91.1` 来说，`client.messages.stream()` 作为 `AsyncIterable<MessageStreamEvent>` 暴露出来的主流程事件类型是固定的一组：

- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `message_delta`
- `message_stop`

Anthropic 官方文档描述的标准 stream flow 也是这组主流程事件：先 `message_start`，然后是一个或多个 content block，每个 block 都由 `content_block_start`、一个或多个 `content_block_delta`、`content_block_stop` 组成，接着是 `message_delta`，最后是 `message_stop`。

但要注意两个边界：

- 直接处理 HTTP SSE 时，流里还可能有 `ping` 和 `error` 事件。
- 官方文档说明未来可能新增事件类型，所以代码里保留 `default` 分支是合理的。

当前 `stream-message.ts` 是基于 SDK 的 typed stream 写的，不是直接解析原始 HTTP SSE。因此主流程先处理上面 6 类事件即可。

### `message_start`

含义：一次 assistant message 开始了。

典型数据：

```ts
{
  type: 'message_start',
  message: {
    id: 'msg_xxx',
    role: 'assistant',
    content: [],
    usage: { input_tokens: 25, output_tokens: 1 }
  }
}
```

在 Step 1 中的作用：

- 记录 `input_tokens`，用于后续统计本次调用成本。
- 向外 `yield { type: 'message_start', messageId }`，让调用方知道模型已经开始响应。

为什么这里 `content` 还是空的：stream 刚开始时，模型还没有输出具体内容。后续内容会通过 content block 事件逐步到达。

### `content_block_start`

含义：一个新的 content block 开始了。

content block 是 assistant message 的内容单元。一个 assistant message 不一定只是纯文本，也可能包含工具调用。

常见 block 类型：

- `text`：普通文本内容。
- `tool_use`：模型发起工具调用。
- `thinking`：开启 extended thinking 时的思考块，当前 Step 1 暂不处理。
- 其他服务端工具或特殊 block：当前 Step 1 暂不处理。

典型文本 block：

```ts
{
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: '' }
}
```

典型工具调用 block：

```ts
{
  type: 'content_block_start',
  index: 1,
  content_block: {
    type: 'tool_use',
    id: 'toolu_xxx',
    name: 'get_weather',
    input: {}
  }
}
```

在 Step 1 中的作用：

- 如果是 `text`，在 `content[index]` 初始化一个空 text block。
- 如果是 `tool_use`，在 `content[index]` 初始化一个 tool use block，并向外 `yield { type: 'tool_use_start', id, name }`。

为什么要用 `index`：最终 assistant message 的 `content` 是数组，`index` 表示这个 block 在最终数组中的位置。正式实现中按 `index` 写入，比简单 `push` 更贴近协议。

### `content_block_delta`

含义：当前 content block 出现了一段增量更新。

这是 streaming 中最核心的事件。模型不是一次性给完整内容，而是一小段一小段给。`delta` 表示“从上一次事件到这一次事件新增的部分”。

`content_block_delta` 的外层结构固定类似：

```ts
{
  type: 'content_block_delta',
  index: 0,
  delta: {
    type: 'text_delta',
    text: 'Hello'
  }
}
```

这里要区分两层类型：

- `event.type` 是 `content_block_delta`。
- `event.delta.type` 才表示这次增量的具体内容类型。

Step 1 当前处理两种 `delta.type`：

#### `text_delta`

含义：文本 block 新增了一段文本。

```ts
{
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'text_delta', text: '你好' }
}
```

在 Step 1 中的作用：

- 把 `delta.text` 追加到 `content[index].text`，用于组装最终 assistant message。
- 同时向外 `yield { type: 'text', text: delta.text }`，用于实时渲染。

#### `input_json_delta`

含义：工具调用 block 的 `input` 字段新增了一段 JSON 字符串。

```ts
{
  type: 'content_block_delta',
  index: 1,
  delta: {
    type: 'input_json_delta',
    partial_json: '{"location": "San Fra'
  }
}
```

在 Step 1 中的作用：

- 把 `partial_json` 先累积到 `pendingToolJsonByIndex`。
- 不立即 `JSON.parse`，因为单个 `partial_json` 往往不是完整 JSON。
- 等 `content_block_stop` 到来时，再一次性解析完整 JSON。

官方文档还列出了 `thinking_delta`、`signature_delta` 等 delta 类型。当前 Step 1 不开启 extended thinking，也不处理这些类型；后续如果支持 thinking，再扩展 `content_block_delta` 分支。

### `content_block_stop`

含义：当前 content block 结束了。

典型数据：

```ts
{
  type: 'content_block_stop',
  index: 1
}
```

在 Step 1 中的作用：

- 如果 `content[index]` 是 text block，通常不需要额外处理，因为文本已经在 `text_delta` 中持续追加完成。
- 如果 `content[index]` 是 tool use block，说明工具参数 JSON 已经到齐，可以把累积的 `partial_json` 做 `JSON.parse`，写入 `block.input`。

为什么在这里解析工具 input：`input_json_delta` 是增量片段，中途可能不是合法 JSON；`content_block_stop` 才是“这个工具调用 block 的参数已经结束”的信号。

### `message_delta`

含义：assistant message 顶层字段发生了变化。

典型数据：

```ts
{
  type: 'message_delta',
  delta: {
    stop_reason: 'end_turn',
    stop_sequence: null
  },
  usage: {
    output_tokens: 15
  }
}
```

在 Step 1 中的作用：

- 更新 `usage.outputTokens`。
- 更新 `stopReason`。

常见 `stopReason`：

- `end_turn`：模型自然结束本轮回答。
- `tool_use`：模型希望调用工具。
- `max_tokens`：达到最大输出 token 限制。
- `stop_sequence`：命中了自定义停止序列。
- `refusal`：模型拒绝回答。
- `pause_turn`：模型暂停本轮，需要后续恢复或继续处理。

为什么这个事件很重要：后续 agent loop 会根据 `stopReason` 决定下一步。如果是 `tool_use`，通常要执行工具；如果是 `end_turn`，通常可以结束。

### `message_stop`

含义：本次 assistant message 的 stream 结束。

典型数据：

```ts
{
  type: 'message_stop'
}
```

在 Step 1 中的作用：

- 向外 `yield { type: 'message_done', stopReason, usage }`。
- 通知调用方关闭 loading、打印 token 使用量，或者进入下一步 agent loop。

注意：`message_stop` 只是流结束事件。完整的 `assistantMessage` 是我们在前面多个 content block 事件中逐步组装出来的，并在 async generator 最后的 `return` 中返回。

正式实现中建议补两个保护：

- `JSON.parse(pendingToolJson)` 失败时抛出带上下文的错误，例如 tool id、tool name、原始 partial JSON。
- 如果收到 `text_delta` 但对应 index 没有初始化 text block，应抛出协议错误，而不是静默失败。
- 如果后续不用 SDK 而是直接解析 HTTP SSE，需要显式处理 `ping`、`error` 和未知事件类型。

## 单独测试验证设计

### 1. 安装测试工具

建议用 Vitest。它对 TypeScript、ESM 和 watch 模式支持简单，适合这个项目当前阶段。

```powershell
npm install -D vitest
```

给 `package.json` 增加：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "smoke:step1": "tsx test/smoke/step1-stream-smoke.ts",
    "check": "npm run typecheck && npm run lint && npm run test"
  }
}
```

`test` 是单元测试，应该稳定进入 `check`。

`smoke:step1` 会访问真实模型，不放进 `check`，需要手动运行。

### 2. 单元测试：不访问真实 API

测试文件：`test/llm/stream-message.test.ts`

建议覆盖：

1. 纯文本流：多个 `text_delta` 能合并成一个 text block。
2. usage：`message_start` 和 `message_delta` 能正确映射到 `inputTokens`、`outputTokens`。
3. stop reason：默认是 `end_turn`，收到 `message_delta.stop_reason` 后更新。
4. tool use：`input_json_delta` 能拼接并解析为 `ToolUseBlock.input`。
5. 异常路径：非法工具 JSON 会抛出明确错误。

fake stream 形态：

```ts
async function* fakeStream(events: unknown[]) {
  for (const event of events) {
    yield event
  }
}
```

测试时调用：

```ts
const iterator = streamMessage(input, {
  createStream: () => fakeStream(events)
})
```

需要注意：`async generator` 的最终 `return` 值不会出现在 `for await...of` 中。测试时如果要拿 `StreamMessageResult`，需要手动调用 `next()` 直到 `done: true`。

### 3. Smoke 测试：访问真实 API

测试文件：`test/smoke/step1-stream-smoke.ts`

职责：

- 从 `.env` 读取配置。
- 构造一个最小 messages。
- 调用正式的 `streamMessage()`。
- 把 `text` 增量打印到控制台。
- 最后打印 usage 和 stop reason。

示例输入：

```ts
const messages = [
  {
    role: 'user',
    content: '用一句话解释什么是 agent。'
  }
]
```

运行：

```powershell
npm run smoke:step1
```

验收标准：

- 控制台能看到模型输出文本。
- 结束时能看到 `message_done`。
- 没有抛出环境变量错误、网络错误或 JSON 解析错误。

## 开发顺序

建议按这个顺序实现：

1. `src/llm/types.ts`：先定义内部类型。
2. `src/llm/constants.ts`：放 `DEFAULT_MAX_TOKENS`。
3. `src/llm/content-blocks.ts`：实现 text/tool use block 构造函数。
4. `src/llm/anthropic-client.ts`：实现 SDK client 创建。
5. `src/llm/stream-message.ts`：实现核心 async generator。
6. `test/llm/stream-message.test.ts`：用 fake stream 验证核心解析逻辑。
7. `test/smoke/step1-stream-smoke.ts`：用真实模型做手动验证。
8. `src/index.ts`：暂时只作为入口示例，后续 agent loop 出现后再扩展。

## 验收清单

实现完成后，至少通过：

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

如果需要真实 API 验证，再运行：

```powershell
npm run smoke:step1
```

阶段完成标准：

- `learn/step1.js` 仍然只是学习参考。
- `src/llm/stream-message.ts` 是正式项目实现。
- 单元测试不依赖网络和 API key。
- smoke 测试可以独立验证真实模型链路。
- 后续 Step 2 可以在这个基础上增加 tool execution，而不是重写 Step 1。
