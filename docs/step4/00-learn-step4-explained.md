# Step 4：`learn/step4.js` 解读

`learn/step4.js` 是一个最小 agentic loop 学习样例。

它的目标是把 Step 1 的流式模型调用和 Step 3 的工具系统串起来：

```text
模型返回 tool_use
  -> 本地执行工具
  -> 把 tool_result 加回 messages
  -> 再次请求模型
  -> 直到模型完成回答
```

文件里只有两个核心函数：

```js
runTools(contentBlocks, toolContext)
query({ messages, model, systemPrompt, toolContext, maxTurns = 8 })
```

## 依赖关系

```js
import { streamMessage } from './step1.js'
import { findToolByName, getToolsApiParams } from './step3.js'
```

含义：

```text
streamMessage
  来自 Step 1。
  负责一次模型调用和流式事件解析。

findToolByName
  来自 Step 3。
  根据模型返回的 tool_use.name 找到本地工具。

getToolsApiParams
  来自 Step 3。
  把本地工具定义转换成 Anthropic API 的 tools 参数。
```

所以 Step 4 并不重新定义工具，也不重新实现模型流式解析。它只做中间的编排层。

## `runTools()`

源码：

```js
export async function runTools(contentBlocks, toolContext) {
  const results = []

  for (const block of contentBlocks) {
    if (block.type !== 'tool_use') continue

    const tool = findToolByName(block.name)
    if (!tool) {
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Error: unknown tool ${block.name}`,
        is_error: true
      })
      continue
    }

    const result = await tool.call(block.input, toolContext)
    results.push({
      type: 'tool_result',
      tool_use_id: block.id,
      content: result.content,
      ...(result.isError ? { is_error: true } : {})
    })
  }

  return { role: 'user', content: results }
}
```

### 输入：`contentBlocks`

`contentBlocks` 是一次 assistant message 的 content 数组。

例如模型可能返回：

```js
[
  { type: 'text', text: '我先读取文件。' },
  {
    type: 'tool_use',
    id: 'toolu_1',
    name: 'Read',
    input: { file_path: 'src/index.ts' }
  }
]
```

`runTools()` 只处理：

```js
block.type === 'tool_use'
```

其他 block 会被跳过。

### 输入：`toolContext`

`toolContext` 是工具执行上下文。

在当前学习样例里，它通常至少包含：

```js
{
  cwd: process.cwd()
}
```

`Read` 工具需要它判断 workspace 根目录。

### 未知工具处理

如果模型请求了不存在的工具：

```js
const tool = findToolByName(block.name)
if (!tool) {
  results.push({
    type: 'tool_result',
    tool_use_id: block.id,
    content: `Error: unknown tool ${block.name}`,
    is_error: true
  })
  continue
}
```

这点很重要：未知工具不会让 loop 直接崩掉，而是转换成错误 `tool_result` 返回给模型。

这样模型还有机会解释错误，或者尝试别的路径。

### 工具执行结果转换

本地工具返回的是内部格式：

```js
{
  content: 'File: src/index.ts\n...',
  isError: false
}
```

Anthropic 协议需要的是：

```js
{
  type: 'tool_result',
  tool_use_id: 'toolu_1',
  content: 'File: src/index.ts\n...'
}
```

如果失败，还要带：

```js
is_error: true
```

所以代码里有：

```js
results.push({
  type: 'tool_result',
  tool_use_id: block.id,
  content: result.content,
  ...(result.isError ? { is_error: true } : {})
})
```

### 返回值为什么是 user message

`runTools()` 最后返回：

```js
return { role: 'user', content: results }
```

这是 Anthropic 工具协议要求的顺序：

```text
assistant: tool_use
user: tool_result
assistant: final answer
```

所以工具结果虽然来自本地程序执行，但在消息协议里要作为 `user` message 发回模型。

## `query()`

源码：

```js
export async function* query({ messages, model, systemPrompt, toolContext, maxTurns = 8 }) {
  const state = {
    messages: [...messages],
    turnCount: 0
  }

  while (state.turnCount < maxTurns) {
    state.turnCount += 1

    const stream = streamMessage({
      messages: state.messages,
      model,
      system: systemPrompt,
      tools: getToolsApiParams()
    })

    let result
    while (true) {
      const { value, done } = await stream.next()
      if (done) {
        result = value
        break
      }

      yield value
    }

    state.messages.push(result.assistantMessage)
    yield { type: 'assistant_message', message: result.assistantMessage }

    if (result.stopReason !== 'tool_use') {
      return { state, usage: result.usage, reason: 'completed' }
    }

    const toolResultMessage = await runTools(result.assistantMessage.content, toolContext)
    state.messages.push(toolResultMessage)

    yield { type: 'tool_result_message', message: toolResultMessage }
  }

  return {
    state,
    usage: { input_tokens: 0, output_tokens: 0 },
    reason: 'max_turns'
  }
}
```

### 为什么是 `async function*`

`query()` 是异步生成器。

它同时有两种输出：

```text
yield
  把中间事件流式交给 UI。

return
  最终返回本轮 agent loop 的结果。
```

调用方可以边收事件边渲染：

```js
const stream = query(...)

while (true) {
  const { value, done } = await stream.next()

  if (done) {
    console.log('final result:', value)
    break
  }

  console.log('event:', value)
}
```

### `state`

```js
const state = {
  messages: [...messages],
  turnCount: 0
}
```

`state.messages` 是本次 `query()` 内部维护的完整上下文。

一开始它复制外部传入的历史：

```js
messages: [...messages]
```

后续每次模型返回 assistant message，都会追加：

```js
state.messages.push(result.assistantMessage)
```

如果执行了工具，还会追加 tool result message：

```js
state.messages.push(toolResultMessage)
```

所以 `state.messages` 会随着工具循环增长。

### `maxTurns`

```js
while (state.turnCount < maxTurns) {
  state.turnCount += 1
  ...
}
```

这是防止无限工具循环。

如果模型一直返回 `tool_use`，loop 最多跑 `maxTurns` 次。

超过后返回：

```js
{
  state,
  usage: { input_tokens: 0, output_tokens: 0 },
  reason: 'max_turns'
}
```

### 一次模型调用

```js
const stream = streamMessage({
  messages: state.messages,
  model,
  system: systemPrompt,
  tools: getToolsApiParams()
})
```

这里把当前完整 messages 和工具 schema 发给模型。

`tools: getToolsApiParams()` 让模型知道可以调用哪些工具。

### 转发底层 stream event

```js
let result
while (true) {
  const { value, done } = await stream.next()
  if (done) {
    result = value
    break
  }

  yield value
}
```

`streamMessage()` 自己也是 async generator。

它 yield 文本、工具开始等低层事件，最后 return 完整的模型调用结果。

`query()` 手动消费它：

```text
streamMessage yield 的事件
  -> query 再 yield 给 UI

streamMessage return 的 result
  -> query 保存到 result 变量
```

这就是“转发低层 stream event 到 UI 层”。

### 保存 assistant message

```js
state.messages.push(result.assistantMessage)
yield { type: 'assistant_message', message: result.assistantMessage }
```

模型返回的完整 assistant message 必须加入上下文。

如果 assistant message 里有 `tool_use`，下一次请求模型时也必须把它带上，否则工具协议不完整。

`assistant_message` event 是学习版额外 yield 的一个高层事件，让 UI 或调试代码知道完整 assistant message 已经生成。

### 判断是否结束

```js
if (result.stopReason !== 'tool_use') {
  return { state, usage: result.usage, reason: 'completed' }
}
```

如果停止原因不是 `tool_use`，说明模型不需要工具了。

本次 agent loop 结束。

返回：

```js
{
  state,
  usage: result.usage,
  reason: 'completed'
}
```

### 执行工具并继续

如果 `stopReason === 'tool_use'`：

```js
const toolResultMessage = await runTools(result.assistantMessage.content, toolContext)
state.messages.push(toolResultMessage)

yield { type: 'tool_result_message', message: toolResultMessage }
```

流程是：

```text
从 assistantMessage.content 里找 tool_use
执行对应本地工具
生成 user tool_result message
追加到 state.messages
yield 一个 tool_result_message 事件
回到 while 顶部，再次请求模型
```

## 完整数据流示例

初始输入：

```js
messages = [
  { role: 'user', content: '请读取 src/index.ts 并解释入口。' }
]
```

### 第 1 次模型调用

模型返回：

```js
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
  stopReason: 'tool_use',
  usage: { inputTokens: 10, outputTokens: 5 }
}
```

`state.messages` 变成：

```js
[
  { role: 'user', content: '请读取 src/index.ts 并解释入口。' },
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
]
```

### 执行工具

`runTools()` 返回：

```js
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

`state.messages` 变成：

```js
[
  { role: 'user', content: '请读取 src/index.ts 并解释入口。' },
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
  }
]
```

### 第 2 次模型调用

模型基于 tool result 返回最终回答：

```js
{
  assistantMessage: {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'src/index.ts 调用了 runRepl()。'
      }
    ]
  },
  stopReason: 'end_turn',
  usage: { inputTokens: 30, outputTokens: 10 }
}
```

因为 `stopReason !== 'tool_use'`，`query()` 返回：

```js
{
  state,
  usage: { inputTokens: 30, outputTokens: 10 },
  reason: 'completed'
}
```

## `learn/step4.js` 的关键价值

这个文件证明了最小 agentic loop 的闭环：

```text
streamMessage()
  只负责一次模型调用

runTools()
  只负责把 tool_use 转成 tool_result

query()
  负责把多次模型调用和工具执行串起来
```

这个分层很重要。

不要把工具执行塞进 `streamMessage()`，否则 LLM 层会变得难测，也会让 UI、重试、权限控制和多工具策略变复杂。

