# Step 3：数据流层级说明

本文按从小到大的顺序梳理当前项目里的数据层级：

```text
模型原始 stream event
  -> assistant content block
  -> 一次模型调用的完整 assistant message
  -> 一次模型调用结果 StreamMessageResult
  -> 一次 agent turn 内部工具循环
  -> 一次 agent turn 产生的 messagesToAppend
  -> ChatSession 中的完整对话历史
```

这个顺序大体正确，但需要补充两点：

1. 不是所有模型 event 都会组成 block。有些 event 只更新 `usage`、`stopReason` 或通知一段 block 结束。
2. 完整历史不是 `runAgentTurn()` 长期持有的。`runAgentTurn()` 只处理“一次用户输入”内部产生的新消息，长期历史由 `ChatSession` 保存。

## 总览

当前项目分三层：

```text
src/llm/stream-message.ts
  负责：一次模型调用的 streaming 解析
  输入：MessageParam[]
  输出：StreamMessageEvent 流 + StreamMessageResult

src/agent/agent-loop.ts
  负责：一次用户输入内的工具调用循环
  输入：已有 messages + cwd + tools
  输出：AgentTurnEvent 流 + AgentTurnResult

src/chat/chat-session.ts
  负责：长期保存完整对话历史
  输入：本轮新增 messagesToAppend
  输出：下一轮要传给 agent loop 的 MessageParam[]
```

## 第 1 层：模型原始 Stream Event

来源：

```ts
client.messages.stream(...)
```

当前代码里的类型是 SDK 的：

```ts
MessageStreamEvent
```

它是模型服务端按流式返回的原始事件。

典型事件包括：

```ts
message_start
content_block_start
content_block_delta
content_block_stop
message_delta
message_stop
```

### `message_start`

表示一次 assistant message 开始。

当前代码使用：

```ts
event.message.id
event.message.usage.input_tokens
```

项目会转成 UI 可见的内部事件：

```ts
{ type: 'message_start', messageId: string }
```

并记录输入 token：

```ts
usage.inputTokens = event.message.usage.input_tokens ?? 0
```

### `content_block_start`

表示一个 content block 开始。

关键属性：

```ts
event.index
event.content_block
```

`event.index` 是这个 block 在 assistant message 的 `content[]` 里的位置。

例如模型返回：

```text
content[0] = thinking
content[1] = tool_use
content[2] = text
```

那么后续 delta 事件会用同一个 `index` 指向对应 block。

当前项目支持这些 block：

```ts
text
tool_use
thinking
redacted_thinking
```

### `content_block_delta`

表示某个 block 的内容增量。

关键属性：

```ts
event.index
event.delta
```

当前项目处理这些 delta：

```ts
text_delta
input_json_delta
thinking_delta
signature_delta
```

不同 delta 的去向不同：

```text
text_delta
  -> 追加到 TextBlock.text
  -> 同时 yield 给 REPL 渲染

input_json_delta
  -> 暂存在 pendingToolJsonByIndex
  -> 等 content_block_stop 后 JSON.parse 成 ToolUseBlock.input

thinking_delta
  -> 追加到 ThinkingBlock.thinking
  -> 不 yield 给 REPL

signature_delta
  -> 写入 ThinkingBlock.signature
  -> 不 yield 给 REPL
```

### `content_block_stop`

表示某个 content block 结束。

对 `text` 来说，它只是结束信号。

对 `tool_use` 来说，它很关键：工具参数 JSON 是通过多个 `input_json_delta` 分片返回的，只有 block 结束后才能解析完整 JSON。

当前逻辑：

```ts
const pendingToolJson = pendingToolJsonByIndex.get(event.index)

if (pendingToolJson) {
  block.input = parseToolInput(pendingToolJson, block)
}
```

### `message_delta`

表示 assistant message 级别的增量。

当前主要使用：

```ts
event.delta.stop_reason
event.usage.output_tokens
```

项目会更新：

```ts
stopReason
usage.outputTokens
```

它不会组成 content block。

### `message_stop`

表示这一次 assistant message 流式返回结束。

项目会 yield：

```ts
{
  type: 'message_done',
  stopReason,
  usage
}
```

随后 `streamMessage()` 会 `return StreamMessageResult`。

## 第 2 层：Assistant Content Block

原始 event 会被组装成项目内部的：

```ts
AssistantContentBlock
```

定义在：

```text
src/llm/types.ts
```

当前结构：

```ts
export type AssistantContentBlock =
  | TextBlock
  | ToolUseBlock
  | ThinkingBlock
  | RedactedThinkingBlock
```

### `TextBlock`

```ts
export type TextBlock = {
  type: 'text'
  text: string
}
```

含义：

```text
assistant 最终要展示给用户的文字内容。
```

属性：

```text
type
  固定为 'text'

text
  模型输出的文本。streaming 时由多个 text_delta 逐步拼接。
```

示例：

```ts
{
  type: 'text',
  text: 'src/index.ts 调用了 runRepl()。'
}
```

### `ToolUseBlock`

```ts
export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
```

含义：

```text
模型请求本地执行一个工具。
```

属性：

```text
type
  固定为 'tool_use'

id
  这次工具调用的唯一 ID。后续 tool_result 必须用它关联。

name
  工具名称，例如 'Read'。

input
  工具入参对象，例如 { file_path: 'src/index.ts' }。
```

示例：

```ts
{
  type: 'tool_use',
  id: 'toolu_1',
  name: 'Read',
  input: { file_path: 'src/index.ts' }
}
```

### `ThinkingBlock`

```ts
export type ThinkingBlock = {
  type: 'thinking'
  thinking: string
  signature: string
}
```

含义：

```text
模型的 thinking/reasoning 协议内容。
```

它不是普通回答文本，不应该默认展示给用户，但必须保存在 assistant message 历史里并原样回传给模型。

属性：

```text
type
  固定为 'thinking'

thinking
  模型返回的 thinking 内容，由 thinking_delta 拼接。

signature
  服务端返回的签名，由 signature_delta 或 content_block_start 提供。
  后续请求必须原样回传。
```

示例：

```ts
{
  type: 'thinking',
  thinking: 'Need to inspect the file.',
  signature: 'sig_1'
}
```

### `RedactedThinkingBlock`

```ts
export type RedactedThinkingBlock = {
  type: 'redacted_thinking'
  data: string
}
```

含义：

```text
服务端隐藏 thinking 明文时返回的占位 block。
```

它也必须原样保存和回传。

属性：

```text
type
  固定为 'redacted_thinking'

data
  服务端返回的 redacted payload。
```

示例：

```ts
{
  type: 'redacted_thinking',
  data: 'redacted_payload'
}
```

## 第 3 层：一次模型调用中的 `content[]`

`streamMessage()` 内部维护：

```ts
const content: AssistantContentBlock[] = []
```

这个数组就是正在组装的 assistant message 的 `content`。

它按 `event.index` 放置 block：

```ts
content[event.index] = createTextBlock('')
content[event.index] = createToolUseBlock(...)
content[event.index] = createThinkingBlock(...)
```

例子：

```ts
[
  {
    type: 'thinking',
    thinking: 'Need to inspect the file.',
    signature: 'sig_1'
  },
  {
    type: 'tool_use',
    id: 'toolu_1',
    name: 'Read',
    input: { file_path: 'src/index.ts' }
  }
]
```

这里要注意：

```text
content[] 是一次模型调用返回的 assistant message 内容。
它不是完整对话历史。
它也不是 agent turn 的全部消息。
```

## 第 4 层：一次模型调用的 UI Stream Event

`streamMessage()` 对外 yield 的不是原始 SDK event，而是项目内部的：

```ts
StreamMessageEvent
```

定义：

```ts
export type StreamMessageEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'message_done'; stopReason: string; usage: Usage }
```

它主要服务于 UI/CLI 渲染。

### `message_start`

```ts
{ type: 'message_start'; messageId: string }
```

含义：

```text
一次 assistant message 开始。
```

当前 REPL 没有特别渲染它。

### `text`

```ts
{ type: 'text'; text: string }
```

含义：

```text
一段可以直接显示给用户的 assistant 文本增量。
```

REPL 收到后会打印：

```text
assistant: ...
```

### `tool_use_start`

```ts
{ type: 'tool_use_start'; id: string; name: string }
```

含义：

```text
模型开始请求调用某个工具。
```

REPL 收到后会打印：

```text
[tool: Read]
```

### `message_done`

```ts
{ type: 'message_done'; stopReason: string; usage: Usage }
```

含义：

```text
一次模型调用的 assistant message 已经流完。
```

注意：

```text
StreamMessageEvent 是给界面看的流式事件。
AssistantContentBlock 是要保存进历史、回传给模型的数据。
```

这两个不是一回事。

例如 `thinking` 会进入 `AssistantContentBlock`，但不会变成 `StreamMessageEvent`。

## 第 5 层：一次模型调用的完整结果 `StreamMessageResult`

`streamMessage()` 是一个 async generator：

```ts
export async function* streamMessage(
  input: StreamMessageInput
): AsyncGenerator<StreamMessageEvent, StreamMessageResult>
```

它一边 yield：

```ts
StreamMessageEvent
```

一边在结束时 return：

```ts
StreamMessageResult
```

结构：

```ts
export type StreamMessageResult = {
  assistantMessage: {
    role: 'assistant'
    content: AssistantContentBlock[]
  }
  usage: Usage
  stopReason: string
}
```

属性含义：

```text
assistantMessage
  本次模型调用最终组装好的完整 assistant message。
  这条消息应该进入对话历史。

assistantMessage.role
  固定为 'assistant'。

assistantMessage.content
  本次 assistant message 的所有 content block。
  包括 text、tool_use、thinking、redacted_thinking。

usage
  本次模型调用的 token 使用量。

stopReason
  模型停止原因，例如 'end_turn' 或 'tool_use'。
```

示例：

```ts
{
  assistantMessage: {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'Read',
        input: { file_path: 'src/index.ts' }
      }
    ]
  },
  usage: { inputTokens: 20, outputTokens: 8 },
  stopReason: 'tool_use'
}
```

如果 `stopReason === 'tool_use'`，说明这次 assistant message 不是最终回答，而是要求本地执行工具。

## 第 6 层：一次模型调用的输入 `StreamMessageInput`

调用模型时传入：

```ts
export type StreamMessageInput = {
  messages: MessageParam[]
  model?: Model
  system?: string
  tools?: ToolUnion[]
}
```

属性含义：

```text
messages
  发给模型的完整上下文。
  它必须符合 Anthropic message 协议。

model
  模型名称。未传时使用 env.ANTHROPIC_MODEL。

system
  system prompt。

tools
  暴露给模型的工具 schema。
```

这里的 `messages` 是 SDK 类型：

```ts
MessageParam[]
```

每一条消息大致是：

```ts
{
  role: 'user' | 'assistant',
  content: string | ContentBlockParam[]
}
```

普通用户输入可以是字符串：

```ts
{ role: 'user', content: '请读取 src/index.ts' }
```

工具结果必须是 content block 数组：

```ts
{
  role: 'user',
  content: [
    {
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: 'File: src/index.ts\n...'
    }
  ]
}
```

## 第 7 层：一次 Agent Turn 的事件 `AgentTurnEvent`

`runAgentTurn()` 处理的是“一次用户输入内可能发生的多次模型调用”。

它对外 yield：

```ts
export type AgentTurnEvent =
  | StreamMessageEvent
  | { type: 'tool_result'; toolUseId: string; toolName: string; isError: boolean }
```

它包含两类事件：

```text
StreamMessageEvent
  来自 streamMessage()。
  例如 text、tool_use_start、message_done。

tool_result
  agent loop 自己新增的事件。
  表示本地工具已经执行完。
```

### `tool_result` event

```ts
{
  type: 'tool_result'
  toolUseId: string
  toolName: string
  isError: boolean
}
```

属性含义：

```text
toolUseId
  对应 ToolUseBlock.id。

toolName
  工具名称，例如 'Read'。

isError
  本地工具执行是否失败。
```

它是给 REPL 渲染状态用的：

```text
[tool result: Read ok]
[tool result: Read error]
```

注意：

```text
AgentTurnEvent 里的 tool_result 不是发给模型的 tool_result block。
它只是 UI 事件。
```

真正发给模型的 tool result block 是：

```ts
{
  type: 'tool_result',
  tool_use_id: 'toolu_1',
  content: '...'
}
```

由 `createToolResultBlock()` 创建。

## 第 8 层：一次 Agent Turn 的内部 Loop

核心函数：

```ts
export async function* runAgentTurn(
  input: AgentTurnInput
): AsyncGenerator<AgentTurnEvent, AgentTurnResult>
```

输入：

```ts
export type AgentTurnInput = {
  messages: MessageParam[]
  cwd: string
  model?: StreamMessageInput['model']
  system?: string
  tools?: AgentTool[]
  maxToolRounds?: number
  sendMessage?: SendMessage
}
```

属性含义：

```text
messages
  进入本轮 agent turn 时已有的完整上下文。
  在 REPL 中，它已经包含本轮用户刚输入的 message。

cwd
  工具执行的 workspace 根目录。

model
  可选模型名称。

system
  可选 system prompt。

tools
  当前可用的本地工具列表。

maxToolRounds
  最多允许几轮工具调用，防止无限循环。

sendMessage
  模型调用函数，默认是 streamMessage。
  测试里可以注入 fake。
```

内部关键变量：

```ts
const messagesToAppend: MessageParam[] = []
const currentMessages = [...input.messages]
const totalUsage: Usage = { inputTokens: 0, outputTokens: 0 }
let toolRounds = 0
```

### `currentMessages`

含义：

```text
本轮 agent loop 内部继续调用模型时使用的完整上下文工作副本。
```

它一开始等于传入的 `input.messages`：

```text
历史消息 + 本轮用户消息
```

如果模型要求工具，它会继续增长：

```text
历史消息
本轮用户消息
assistant tool_use message
user tool_result message
```

第二次模型调用就用这个数组。

### `messagesToAppend`

含义：

```text
本轮 agent turn 新产生、结束后要追加回 ChatSession 的消息。
```

它不包含本轮用户消息，因为用户消息在进入 `runAgentTurn()` 前已经被 REPL 加进 `ChatSession`。

它可能包含：

```text
assistant tool_use message
user tool_result message
assistant final answer message
```

## 第 9 层：一次 Agent Turn 的结果 `AgentTurnResult`

`runAgentTurn()` 最终 return：

```ts
export type AgentTurnResult = {
  messagesToAppend: MessageParam[]
  finalAssistantMessage: StreamMessageResult['assistantMessage']
  usage: Usage
  stopReason: string
}
```

属性含义：

```text
messagesToAppend
  本轮新增、需要追加到 ChatSession 的消息。

finalAssistantMessage
  本轮最终 assistant message。
  如果中间调用过工具，它通常是工具结果之后的最终回答。

usage
  本轮 agent turn 内所有模型调用的 token 总和。

stopReason
  最后一次模型调用的停止原因。
```

示例：

```ts
{
  messagesToAppend: [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Read',
          input: { file_path: 'src/index.ts' }
        }
      ]
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'File: src/index.ts\n...'
        }
      ]
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: '这个入口文件启动了 REPL。'
        }
      ]
    }
  ],
  finalAssistantMessage: {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: '这个入口文件启动了 REPL。'
      }
    ]
  },
  usage: { inputTokens: 100, outputTokens: 50 },
  stopReason: 'end_turn'
}
```

## 第 10 层：ChatSession 中的完整对话历史

长期历史在：

```text
src/chat/chat-session.ts
```

核心字段：

```ts
private readonly messages: MessageParam[] = []
```

它提供：

```ts
addUserMessage(content: string): void
addAssistantMessage(result: StreamMessageResult): void
addMessage(message: MessageParam): void
addMessages(messages: MessageParam[]): void
clear(): void
getMessages(): MessageParam[]
```

REPL 每轮流程：

```ts
session.addUserMessage(command.text)

const result = await renderAgentTurn({
  messages: session.getMessages(),
  ...
})

session.addMessages(result.messagesToAppend)
```

所以一轮用户输入结束后，完整历史会变成：

```text
之前的历史
本轮 user message
本轮 assistant tool_use message
本轮 user tool_result message
本轮 assistant final message
```

下一轮用户输入时，REPL 会再次调用：

```ts
session.getMessages()
```

然后把完整历史传给 `runAgentTurn()`。

## 一次带工具调用的完整数据流

假设用户输入：

```text
请读取 src/index.ts 并解释入口做了什么
```

### 1. REPL 先写入用户消息

```ts
session.addUserMessage('请读取 src/index.ts 并解释入口做了什么')
```

此时历史：

```ts
[
  {
    role: 'user',
    content: '请读取 src/index.ts 并解释入口做了什么'
  }
]
```

### 2. REPL 调用 agent loop

```ts
runAgentTurn({
  messages: session.getMessages(),
  cwd: process.cwd()
})
```

进入 `runAgentTurn()` 后：

```ts
currentMessages = [
  { role: 'user', content: '请读取 src/index.ts 并解释入口做了什么' }
]

messagesToAppend = []
```

### 3. 第一次模型调用返回 tool_use

`streamMessage()` 先接收原始 event：

```text
message_start
content_block_start(tool_use)
content_block_delta(input_json_delta)
content_block_stop
message_delta(stop_reason = tool_use)
message_stop
```

然后组装成：

```ts
{
  assistantMessage: {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'Read',
        input: { file_path: 'src/index.ts' }
      }
    ]
  },
  usage: { inputTokens: 20, outputTokens: 8 },
  stopReason: 'tool_use'
}
```

agent loop 把它追加到：

```ts
messagesToAppend.push(result.assistantMessage)
currentMessages.push(result.assistantMessage)
```

### 4. agent loop 执行本地工具

从 assistant message 中筛出：

```ts
{
  type: 'tool_use',
  id: 'toolu_1',
  name: 'Read',
  input: { file_path: 'src/index.ts' }
}
```

执行本地 `Read` 工具，得到内部结果：

```ts
{
  content: 'File: src/index.ts\nLines: 1-3 / 3\n...',
  isError: false
}
```

转换成发给模型的 block：

```ts
{
  type: 'tool_result',
  tool_use_id: 'toolu_1',
  content: 'File: src/index.ts\nLines: 1-3 / 3\n...'
}
```

再包成一条 user message：

```ts
{
  role: 'user',
  content: [
    {
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: 'File: src/index.ts\nLines: 1-3 / 3\n...'
    }
  ]
}
```

agent loop 同时：

```ts
messagesToAppend.push(toolResultMessage)
currentMessages.push(toolResultMessage)
```

### 5. 第二次模型调用生成最终回答

这次传给模型的 `currentMessages` 是：

```ts
[
  {
    role: 'user',
    content: '请读取 src/index.ts 并解释入口做了什么'
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'Read',
        input: { file_path: 'src/index.ts' }
      }
    ]
  },
  {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: 'File: src/index.ts\nLines: 1-3 / 3\n...'
      }
    ]
  }
]
```

模型返回：

```ts
{
  assistantMessage: {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'src/index.ts 的入口调用了 runRepl()。'
      }
    ]
  },
  usage: { inputTokens: 80, outputTokens: 20 },
  stopReason: 'end_turn'
}
```

agent loop 发现：

```ts
stopReason !== 'tool_use'
```

于是结束本轮，并 return：

```ts
{
  messagesToAppend: [
    assistantToolUseMessage,
    userToolResultMessage,
    finalAssistantMessage
  ],
  finalAssistantMessage,
  usage: {
    inputTokens: 100,
    outputTokens: 28
  },
  stopReason: 'end_turn'
}
```

### 6. REPL 写回长期历史

REPL 拿到结果后：

```ts
session.addMessages(result.messagesToAppend)
```

最终 `ChatSession` 历史是：

```ts
[
  userOriginalMessage,
  assistantToolUseMessage,
  userToolResultMessage,
  finalAssistantMessage
]
```

下一轮对话会基于这份完整历史继续。

## 带 thinking 的工具调用流

如果模型第一次返回：

```ts
{
  role: 'assistant',
  content: [
    {
      type: 'thinking',
      thinking: 'Need to inspect the file.',
      signature: 'sig_1'
    },
    {
      type: 'tool_use',
      id: 'toolu_1',
      name: 'Read',
      input: { file_path: 'src/index.ts' }
    }
  ]
}
```

那么 `thinking` 必须保存在：

```ts
messagesToAppend
currentMessages
ChatSession.messages
```

它不会显示到 REPL，但第二次请求模型时必须原样带上：

```ts
[
  userMessage,
  {
    role: 'assistant',
    content: [
      {
        type: 'thinking',
        thinking: 'Need to inspect the file.',
        signature: 'sig_1'
      },
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'Read',
        input: { file_path: 'src/index.ts' }
      }
    ]
  },
  toolResultMessage
]
```

否则兼容 Anthropic 协议的服务端可能报错：

```text
The `content[].thinking` in the thinking mode must be passed back to the API.
```

## 最容易混淆的几组数据

### `MessageStreamEvent` vs `StreamMessageEvent`

```text
MessageStreamEvent
  SDK 原始 stream event。
  来自模型服务端。
  粒度更底层。

StreamMessageEvent
  项目内部 stream event。
  给 REPL 渲染用。
  已经隐藏了大部分协议细节。
```

### `AssistantContentBlock` vs `StreamMessageEvent`

```text
AssistantContentBlock
  要保存到 assistant message 历史里的内容。
  例如 text、tool_use、thinking。

StreamMessageEvent
  渲染过程中的事件。
  例如 text 增量、tool_use_start。
```

同一个模型输出可能同时影响两边。

例如：

```text
text_delta
  -> 追加到 TextBlock.text
  -> yield { type: 'text', text }
```

但：

```text
thinking_delta
  -> 追加到 ThinkingBlock.thinking
  -> 不 yield 给 REPL
```

### `tool_result` UI event vs `tool_result` content block

UI event：

```ts
{
  type: 'tool_result',
  toolUseId: 'toolu_1',
  toolName: 'Read',
  isError: false
}
```

用途：

```text
告诉 REPL 工具执行完了。
```

发给模型的 content block：

```ts
{
  type: 'tool_result',
  tool_use_id: 'toolu_1',
  content: '...'
}
```

用途：

```text
把工具结果回传给模型。
```

名字相似，但不是同一个类型。

### `currentMessages` vs `messagesToAppend`

```text
currentMessages
  本轮 agent loop 内部发给模型的完整上下文工作副本。
  会随着本轮工具调用继续增长。

messagesToAppend
  本轮结束后要追加回 ChatSession 的新增消息。
  不包含本轮用户消息。
```

### `finalAssistantMessage` vs `messagesToAppend`

```text
finalAssistantMessage
  本轮最后一条 assistant message。

messagesToAppend
  本轮新增的所有协议消息。
  可能包含中间 assistant tool_use、user tool_result、最终 assistant text。
```

REPL 保存历史时必须用：

```ts
session.addMessages(result.messagesToAppend)
```

不能只保存：

```ts
result.finalAssistantMessage
```

否则下一轮模型会丢失工具调用历史。

