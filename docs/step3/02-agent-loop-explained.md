# Step 3：`agent-loop.ts` 解释

本文专门解释 `src/agent/agent-loop.ts`。

这个文件是 Step 3 的核心：它把“一次用户输入”扩展成一个完整 agent turn。

普通模型调用只做一件事：

```text
user message -> streamMessage() -> assistant message
```

agent loop 多做了一层控制：

```text
user message
  -> streamMessage()
  -> assistant message 里可能包含 tool_use
  -> 本地执行工具
  -> 生成 user tool_result message
  -> 再次 streamMessage()
  -> 最终 assistant message
```

## 文件职责

`agent-loop.ts` 不直接解析 Anthropic 的原始 stream event。

原始 stream event 已经由 `src/llm/stream-message.ts` 处理成项目内部的：

```ts
StreamMessageEvent
StreamMessageResult
```

所以 agent loop 只关心更高一层的流程控制：

1. 调用一次 `streamMessage()`。
2. 把 stream 事件继续 yield 给 REPL 渲染。
3. 等这次模型调用结束，拿到完整 assistant message。
4. 如果没有 `tool_use`，结束本轮。
5. 如果有 `tool_use`，执行本地工具。
6. 把工具结果包装成 `tool_result` message。
7. 追加到临时消息历史里，再调用下一次模型。
8. 重复，直到模型不再要求工具，或者超过 `maxToolRounds`。

## 主要类型

### `AgentTurnEvent`

```ts
export type AgentTurnEvent =
  | StreamMessageEvent
  | { type: 'tool_result'; toolUseId: string; toolName: string; isError: boolean }
```

这是 agent loop 对外流式产出的事件。

它包含两类事件：

1. `StreamMessageEvent`：来自 `streamMessage()`，例如 `text`、`tool_use_start`。
2. `tool_result`：agent loop 自己新增的事件，表示本地工具已经执行完。

REPL 后续会消费这些事件：

```text
assistant: ...
[tool: Read]
[tool result: Read ok]
assistant: ...
```

### `AgentTurnResult`

```ts
export type AgentTurnResult = {
  messagesToAppend: MessageParam[]
  finalAssistantMessage: StreamMessageResult['assistantMessage']
  usage: Usage
  stopReason: string
}
```

这是 agent loop 最终 return 的结果。

重点是 `messagesToAppend`。

一次用户输入可能产生多条历史消息：

```text
assistant tool_use message
user tool_result message
assistant final answer message
```

这些消息都必须加入聊天历史。否则下一轮模型不知道上一轮调用过工具，也不知道工具返回过什么。

## `runAgentTurn()` 的整体结构

核心函数是：

```ts
export async function* runAgentTurn(
  input: AgentTurnInput
): AsyncGenerator<AgentTurnEvent, AgentTurnResult> {
  // ...
}
```

它是一个 `async function*`，也就是异步生成器。

这个函数有两种输出：

1. 中间过程通过 `yield` 产出 `AgentTurnEvent`。
2. 最终结束时通过 `return` 返回 `AgentTurnResult`。

调用方如果手动消费它，会看到类似结构：

```ts
const stream = runAgentTurn(input)

while (true) {
  const next = await stream.next()

  if (next.done) {
    const result = next.value // AgentTurnResult
    break
  }

  const event = next.value // AgentTurnEvent
}
```

## 为什么要有 `currentMessages`

函数内部有两个消息数组：

```ts
const messagesToAppend: MessageParam[] = []
const currentMessages = [...input.messages]
```

它们用途不同。

`currentMessages` 是本轮 agent loop 内部用于继续调用模型的完整上下文。

例如第一轮模型返回了 `tool_use`，agent loop 会把这条 assistant message 追加进去：

```ts
currentMessages.push(result.assistantMessage)
```

执行工具后，再把 `tool_result` user message 追加进去：

```ts
currentMessages.push(toolResultMessage)
```

这样下一次模型调用时，模型才能看到：

```text
用户问题
assistant: 我要调用 Read
user: Read 的结果是 ...
```

`messagesToAppend` 则是函数最终告诉 `ChatSession`：“这几条新消息需要写入长期历史”。

## 主循环逻辑

`runAgentTurn()` 里有一个 `while (true)`：

```ts
while (true) {
  const result = yield* runModelTurn(...)

  messagesToAppend.push(result.assistantMessage)
  currentMessages.push(result.assistantMessage)

  const toolUses = getToolUseBlocks(result.assistantMessage.content)

  if (result.stopReason !== 'tool_use' || toolUses.length === 0) {
    return {
      messagesToAppend,
      finalAssistantMessage: result.assistantMessage,
      usage: totalUsage,
      stopReason: result.stopReason
    }
  }

  // 执行工具，构造 tool_result message，然后继续下一轮
}
```

每一次循环代表一次模型调用。

如果模型没有要求工具，就 `return` 结束。

如果模型要求工具，就执行工具，然后继续下一轮。

## `yield*` 是什么

代码里最关键的一行是：

```ts
const result = yield* runModelTurn(...)
```

这里的 `runModelTurn(...)` 本身也是一个 async generator。

它会：

1. 调用 `sendMessage()`。
2. 不断拿到 `StreamMessageEvent`。
3. 把这些事件继续 `yield` 出去。
4. 最后 `return StreamMessageResult`。

如果不用 `yield*`，要手写成这样：

```ts
const modelTurn = runModelTurn(...)

while (true) {
  const next = await modelTurn.next()

  if (next.done) {
    const result = next.value
    break
  }

  yield next.value
}
```

`yield*` 就是这个转发逻辑的简写。

它做两件事：

1. 把内部 generator yield 出来的每一个事件，继续 yield 给外层调用方。
2. 等内部 generator return 后，把 return 值赋给左边变量。

所以：

```ts
const result = yield* runModelTurn(...)
```

可以理解成：

```text
把 runModelTurn 产生的所有事件原样转发出去；
等 runModelTurn 结束后，把它的最终 return 值保存到 result。
```

这也是为什么 `result` 的类型是：

```ts
StreamMessageResult
```

而不是：

```ts
StreamMessageEvent
```

因为 `yield*` 表达式本身的值，是被委托 generator 的最终 `return` 值。

## `runModelTurn()` 的职责

`runModelTurn()` 是一个小封装：

```ts
async function* runModelTurn(
  input: RunModelTurnInput
): AsyncGenerator<AgentTurnEvent, StreamMessageResult> {
  const stream = input.sendMessage({
    messages: input.messages,
    tools: getToolsApiParams(input.tools, input.context),
    ...
  })

  while (true) {
    const next = await stream.next()

    if (next.done) {
      return next.value
    }

    yield next.value
  }
}
```

它把工具定义传给模型：

```ts
tools: getToolsApiParams(input.tools, input.context)
```

然后消费 `sendMessage()` 的 stream。

模型 streaming 过程中的事件会被继续 yield：

```ts
yield next.value
```

模型调用结束时，返回完整结果：

```ts
return next.value
```

所以 `runModelTurn()` 是“一次模型调用”的包装，而 `runAgentTurn()` 是“可能包含多次模型调用的一整轮 agent turn”。

## 工具执行逻辑

当 assistant message 里有 `tool_use` 时：

```ts
const toolUses = getToolUseBlocks(result.assistantMessage.content)
```

会筛出所有工具调用：

```ts
function getToolUseBlocks(content: AssistantContentBlock[]): ToolUseBlock[] {
  return content.filter((block): block is ToolUseBlock => block.type === 'tool_use')
}
```

然后逐个执行：

```ts
for (const toolUse of toolUses) {
  const toolResult = await runToolUse(toolUse, tools, context)

  toolResultBlocks.push(createToolResultBlock(toolUse.id, toolResult))

  yield {
    type: 'tool_result',
    toolUseId: toolUse.id,
    toolName: toolUse.name,
    isError: Boolean(toolResult.isError)
  }
}
```

注意这里有两个输出方向。

第一，工具结果要发回模型：

```ts
toolResultBlocks.push(createToolResultBlock(toolUse.id, toolResult))
```

第二，工具执行状态要发给 REPL 渲染：

```ts
yield {
  type: 'tool_result',
  ...
}
```

这两个不是同一件事。

`toolResultBlocks` 是给模型看的。

`yield { type: 'tool_result' }` 是给用户界面看的。

## `tool_result` 为什么是 user message

Anthropic 的工具调用协议要求：

```text
assistant message: tool_use
user message: tool_result
assistant message: final answer
```

所以 agent loop 里会构造：

```ts
const toolResultMessage: MessageParam = {
  role: 'user',
  content: toolResultBlocks
}
```

然后同时追加到：

```ts
messagesToAppend.push(toolResultMessage)
currentMessages.push(toolResultMessage)
```

这样下一次模型调用才符合协议。

## 未知工具和工具异常

`runToolUse()` 不让错误直接炸掉整个进程。

如果模型请求了不存在的工具：

```ts
return {
  content: `Error: unknown tool ${toolUse.name}`,
  isError: true
}
```

如果工具执行时抛异常：

```ts
return {
  content: `Error running tool ${toolUse.name}: ${formatError(error)}`,
  isError: true
}
```

这些错误会被包装成：

```ts
{
  type: 'tool_result',
  tool_use_id: '...',
  content: 'Error: ...',
  is_error: true
}
```

也就是说，工具级错误会返回给模型，让模型继续决定如何回复用户。

## 为什么要限制 `maxToolRounds`

模型可能反复要求调用工具：

```text
model -> tool_use
tool_result -> model
model -> tool_use
tool_result -> model
...
```

如果没有上限，agent loop 可能无限循环。

所以代码里有：

```ts
const maxToolRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS
let toolRounds = 0
```

每处理一轮工具调用就加一：

```ts
toolRounds += 1
```

超过限制时抛错：

```ts
throw new Error(`Tool loop exceeded max rounds: ${maxToolRounds}`)
```

这个错误不是给模型处理的，而是给 REPL 或上层 UI 展示的，因为它通常代表 agent 控制流程出了问题。

## 一次完整例子

假设用户问：

```text
请读取 src/index.ts 并解释入口做了什么
```

第一次模型调用返回：

```ts
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
}
```

agent loop 执行本地 `Read`，得到：

```ts
{
  content: 'File: src/index.ts\nLines: 1-3 / 3\n...',
}
```

然后构造：

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

第二次模型调用看到工具结果后，返回最终回答：

```ts
{
  role: 'assistant',
  content: [
    { type: 'text', text: '这个入口文件调用了 runRepl()...' }
  ]
}
```

最终 `messagesToAppend` 会包含三条消息：

```ts
[
  assistantToolUseMessage,
  userToolResultMessage,
  finalAssistantMessage
]
```

这就是 agent loop 的核心价值：它把一次用户输入内发生的所有中间协议消息完整保存下来。

