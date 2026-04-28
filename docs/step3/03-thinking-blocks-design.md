# Step 3：Thinking Blocks 长期修复设计

## 背景

在接入 Step 3 工具循环后，使用当前 `.env` 配置：

```text
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_MODEL=deepseek-v4-flash
```

REPL 里可能出现 400 错误：

```text
The `content[].thinking` in the thinking mode must be passed back to the API.
```

这个错误不是 `Read` 工具本身的问题，也不是 agent loop 主流程的问题。

根因是：模型返回了 `thinking` content block，但当前 `streamMessage()` 没有把它保存进 assistant message 历史。下一次请求模型时，历史消息缺少这个 `thinking` block，于是兼容 Anthropic 协议的服务端拒绝请求。

## 为什么 Step 3 更容易触发

Step 1/Step 2 时，REPL 通常是一轮用户输入对应一次模型调用：

```text
user -> model -> assistant
```

Step 3 加入工具后，一轮用户输入可能包含多次模型调用：

```text
user
  -> model 返回 assistant tool_use
  -> 本地执行工具
  -> user tool_result
  -> model 返回 final assistant
```

如果第一次模型调用返回的 assistant message 里包含：

```ts
[
  { type: 'thinking', thinking: '...', signature: '...' },
  { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'src/index.ts' } }
]
```

那么第二次请求模型时，必须把这条 assistant message 原样放进 `messages`。

但当前代码只保存了：

```ts
[
  { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'src/index.ts' } }
]
```

`thinking` 被丢掉了，所以服务端报错。

## 当前代码的问题

当前类型只允许 assistant message 保存两类 block：

```ts
export type AssistantContentBlock = TextBlock | ToolUseBlock
```

当前 stream 解析也只处理：

```ts
text
tool_use
```

最后 `compactContent()` 会过滤掉其他 block：

```ts
function isAssistantContentBlock(value: unknown): value is AssistantContentBlock {
  return isRecord(value) && (value.type === 'text' || value.type === 'tool_use')
}
```

这意味着即使上游 stream 返回了 `thinking` / `redacted_thinking`，当前项目也会在组装 `StreamMessageResult.assistantMessage` 时丢弃它。

## 修复目标

长期正确修复不是“忽略 thinking”，也不是“在 agent loop 里特殊处理 DeepSeek”。

正确目标是：

1. `streamMessage()` 能完整保留模型返回的 assistant content blocks。
2. UI 仍然只渲染需要给用户看的内容，例如 `text`、`tool_use_start`。
3. 聊天历史回传给模型时，不丢失协议要求必须保留的 block。
4. agent loop 不需要知道 thinking 的细节，只继续追加完整 assistant message。

核心原则：

```text
stream 事件可以选择性渲染；
assistant message 历史必须协议完整。
```

## 需要支持的 block

Anthropic SDK 中相关类型包括：

```ts
ThinkingBlockParam
RedactedThinkingBlockParam
ToolUseBlockParam
TextBlockParam
```

对当前项目来说，至少需要支持：

```ts
type ThinkingBlock = {
  type: 'thinking'
  thinking: string
  signature: string
}

type RedactedThinkingBlock = {
  type: 'redacted_thinking'
  data: string
}
```

其中：

- `thinking` 是模型返回的思考内容。
- `signature` 是服务端用于多轮连续性的签名，必须原样回传。
- `redacted_thinking` 是服务端隐藏思考内容时返回的 block，也必须原样回传。

## 设计方案

### 1. 扩展 `src/llm/types.ts`

当前：

```ts
export type AssistantContentBlock = TextBlock | ToolUseBlock
```

改成：

```ts
export type ThinkingBlock = {
  type: 'thinking'
  thinking: string
  signature: string
}

export type RedactedThinkingBlock = {
  type: 'redacted_thinking'
  data: string
}

export type AssistantContentBlock =
  | TextBlock
  | ToolUseBlock
  | ThinkingBlock
  | RedactedThinkingBlock
```

说明：

这里继续使用项目内部类型，而不是直接把 `AssistantContentBlock` 改成 SDK 的 `ContentBlockParam`，是为了保持当前 LLM 层的边界清晰。

后续如果需要支持更多 block，再逐步加入。

### 2. 扩展 `content-blocks.ts`

新增构造函数：

```ts
export function createThinkingBlock(thinking = '', signature = ''): ThinkingBlock {
  return { type: 'thinking', thinking, signature }
}

export function createRedactedThinkingBlock(data: string): RedactedThinkingBlock {
  return { type: 'redacted_thinking', data }
}
```

### 3. 扩展 `stream-message.ts` 的 `content_block_start`

当前只处理：

```ts
if (event.content_block.type === 'text') { ... }
if (event.content_block.type === 'tool_use') { ... }
```

需要新增：

```ts
if (event.content_block.type === 'thinking') {
  content[event.index] = createThinkingBlock(
    event.content_block.thinking,
    event.content_block.signature
  )
}

if (event.content_block.type === 'redacted_thinking') {
  content[event.index] = createRedactedThinkingBlock(event.content_block.data)
}
```

注意：是否渲染 thinking 是 UI 决策，不是 stream 组装决策。

当前 `StreamMessageEvent` 不需要新增 `thinking` 事件。也就是说，thinking block 可以保存进历史，但不显示给用户。

### 4. 扩展 `content_block_delta`

streaming 过程中，thinking 内容可能通过 delta 返回：

```ts
event.delta.type === 'thinking_delta'
```

签名可能通过：

```ts
event.delta.type === 'signature_delta'
```

需要处理：

```ts
if (event.delta.type === 'thinking_delta') {
  const block = getThinkingBlock(content, event.index)
  block.thinking += event.delta.thinking
}

if (event.delta.type === 'signature_delta') {
  const block = getThinkingBlock(content, event.index)
  block.signature = event.delta.signature
}
```

这里不 `yield` UI 事件，因为默认不向终端展示 thinking。

### 5. 扩展 `compactContent()`

当前：

```ts
return isRecord(value) && (value.type === 'text' || value.type === 'tool_use')
```

应该改成：

```ts
return (
  isRecord(value) &&
  (value.type === 'text' ||
    value.type === 'tool_use' ||
    value.type === 'thinking' ||
    value.type === 'redacted_thinking')
)
```

这样 assistant message 里不会丢掉 thinking block。

### 6. agent loop 不需要特殊修改

`runAgentTurn()` 当前是把完整 assistant message 加入：

```ts
messagesToAppend.push(result.assistantMessage)
currentMessages.push(result.assistantMessage)
```

只要 `StreamMessageResult.assistantMessage.content` 已经包含 thinking block，agent loop 就会自然把它带入下一次模型调用。

所以修复点应该放在 LLM stream 层，而不是 agent 层。

## 测试设计

### 1. `stream-message.test.ts` 增加 thinking block 测试

覆盖：

```text
content_block_start thinking
thinking_delta
signature_delta
content_block_stop
message_stop
```

断言最终结果包含：

```ts
{
  type: 'thinking',
  thinking: '...',
  signature: '...'
}
```

同时断言 events 不包含 thinking 内容，避免终端泄露或刷屏。

### 2. 增加 redacted thinking 测试

覆盖：

```text
content_block_start redacted_thinking
message_stop
```

断言最终 assistant message 保留：

```ts
{
  type: 'redacted_thinking',
  data: '...'
}
```

### 3. agent loop 可补一条回归测试

构造第一次模型返回：

```ts
assistant.content = [
  { type: 'thinking', thinking: '...', signature: 'sig' },
  { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }
]
```

断言第二次 `sendMessage()` 收到的 messages 包含完整 thinking block。

不过这条测试不是必须的，因为只要 stream layer 保留了 block，agent loop 当前逻辑天然会带过去。

## 为什么不在 REPL 里解决

REPL 只负责渲染用户可见输出和维护 session。

它不应该理解：

```text
thinking
signature
redacted_thinking
```

这些属于 LLM 协议层。

如果在 REPL 里修，会导致：

1. API 协议细节泄漏到 CLI 层。
2. 其他调用 `streamMessage()` 的地方仍然会丢 block。
3. 后续接入非 REPL UI 时还会重复踩坑。

所以正确修复位置是 `src/llm/stream-message.ts` 和 `src/llm/types.ts`。

## 为什么不在 agent loop 里解决

agent loop 的职责是：

```text
模型调用 -> 工具执行 -> 工具结果回传 -> 再次模型调用
```

它应该把 assistant message 当成一个完整对象传递，而不是理解每一种 content block。

如果在 agent loop 里特殊处理 thinking，会让 agent 层和具体模型协议耦合。

更好的边界是：

```text
streamMessage()
  负责把服务端 stream 组装成协议完整的 assistant message

runAgentTurn()
  负责把完整 assistant message 放入下一次请求
```

## 风险和注意点

### 不要把 thinking 当普通 text 渲染

`thinking` 不是 assistant 最终回答。

默认应该保存但不展示。

### signature 必须原样保存

不要修改、截断或重新生成 `signature`。

### redacted thinking 也不能丢

即使没有明文 thinking，只要服务端返回了 `redacted_thinking`，也应该原样保留。

### 后续可能还有更多 block

Anthropic 协议里还有 citation、server tool、web search 等 block。

本次只修当前真实触发的问题，不一次性扩大范围。

## 最终效果

修复后，第一次模型调用如果返回：

```ts
[
  { type: 'thinking', thinking: '...', signature: 'sig_1' },
  { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'src/index.ts' } }
]
```

agent loop 第二次请求模型时会带上：

```ts
[
  userMessage,
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '...', signature: 'sig_1' },
      { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'src/index.ts' } }
    ]
  },
  toolResultMessage
]
```

服务端就不会再因为缺少 `content[].thinking` 报 400。

