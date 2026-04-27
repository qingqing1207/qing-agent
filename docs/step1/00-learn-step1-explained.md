# 00：解读 learn/step1.js 的设计、流程和语法

这份文档的核心是解释 `learn/step1.js` 为什么这样写：每一段代码承担什么职责，背后的设计原理是什么，以及它如何构成一个最小的 LLM streaming client。

`async function*`、`for await...of`、`yield` 是理解这个文件的关键语法，所以会单独讲，但它们是服务于 Step 1 设计的工具，不是这份文档的唯一重点。

## 1. Step 1 要解决什么问题

`learn/step1.js` 解决的是 agent 项目里的第一层基础能力：和模型进行一次“流式 assistant turn”。

它还不是完整 agent。完整 agent 至少还需要工具执行、工具结果回传、多轮循环、任务停止条件等能力。Step 1 只负责模型这一侧的最小闭环：

1. 准备模型客户端。
2. 发送用户消息。
3. 接收模型流式事件。
4. 把文本增量实时交给调用方。
5. 识别模型是否发起工具调用。
6. 组装最终 assistant message。
7. 返回 usage 和 stop reason。

从职责上看，它是后续 agent loop 的底层 LLM client。

## 2. 整体数据流

可以把这个文件理解成三层：

```text
调用方
  |
  | 调用 streamMessage({ messages, system, tools })
  v
learn/step1.js
  |
  | 调用 Anthropic SDK
  v
client.messages.stream(...)
  |
  | 返回 streaming events
  v
for await (const event of stream)
  |
  | 解析 SDK event
  v
yield 内部事件 + 组装最终 assistant message
```

这个设计有两个输出方向：

- 实时输出：通过 `yield` 交出 `text`、`tool_use_start`、`message_done` 等事件。
- 最终结果：通过函数末尾的 `return` 返回完整 `assistantMessage`、`usage`、`stopReason`。

实时输出适合 CLI、Web UI、日志渲染。最终结果适合保存到对话历史，作为下一轮模型调用的上下文。

## 3. 文件顶部注释的设计定位

文件开头写得很明确：

```js
/**
 * Step 1 - Minimal LLM streaming client
 *
 * Goal:
 * - show the smallest useful Anthropic client wrapper
 * - stream text and tool-use events
 * - keep the code in one file for teaching purposes
 */
```

这里有三个重要信号：

1. `Minimal`：只保留最小可用链路，不做完整工程拆分。
2. `stream text and tool-use events`：不只是流文本，还要能看到工具调用事件。
3. `one file for teaching purposes`：这是学习样例，不是正式项目代码结构。

所以后续写进 `src/` 时，要保留核心流程，但要重新做模块拆分、类型设计和测试注入。

## 4. 默认配置：模型名和 max tokens

代码：

```js
export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'
export const DEFAULT_MAX_TOKENS = 4096
```

作用：

- `DEFAULT_MODEL` 决定默认使用哪个模型。
- `DEFAULT_MAX_TOKENS` 限制本轮 assistant 最多输出多少 token。

设计原理：

- 模型名适合从环境变量读取，因为不同环境可能使用不同模型。
- `max_tokens` 是调用模型时必须明确控制的成本和输出边界。

学习样例里直接读 `process.env` 是为了简洁。正式项目里不建议到处直接读环境变量，应该统一放在 `src/config/env.ts` 中校验和导出。

正式项目中的对应设计：

```text
src/config/env.ts       # 读取并校验 ANTHROPIC_MODEL
src/llm/constants.ts    # 放 DEFAULT_MAX_TOKENS
```

## 5. `getClient()`：创建模型客户端

代码：

```js
export function getClient() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
    baseURL: process.env.ANTHROPIC_BASE_URL
  })
}
```

作用：

- 创建 Anthropic SDK client。
- 使用 `ANTHROPIC_AUTH_TOKEN` 作为鉴权信息。
- 使用 `ANTHROPIC_BASE_URL` 支持兼容 Anthropic 协议的服务。

设计原理：

- 模型调用细节不应该散落在业务代码里。
- 调用方只需要关心“发送 messages，接收 events”，不应该关心 SDK 怎么初始化。

这个函数在学习样例里每次调用都会创建一个新 client。注释写的是 “Create one shared SDK client”，但实际代码没有缓存共享 client。

正式项目里有两种选择：

- 简单方案：保留 `createAnthropicClient()`，每次需要时创建。
- 共享方案：在模块内部缓存一个 client，避免重复创建。

当前阶段推荐简单方案，先让核心链路清楚。等出现连接复用、代理配置、超时配置、测试替换需求时，再考虑共享或依赖注入。

## 6. content block：为什么要有 `textBlock` 和 `toolUseBlock`

代码：

```js
export function textBlock(text = '') {
  return { type: 'text', text }
}

export function toolUseBlock(id, name, input = {}) {
  return { type: 'tool_use', id, name, input }
}
```

作用：

- `textBlock` 创建文本内容块。
- `toolUseBlock` 创建工具调用内容块。

模型返回的 assistant message 不是一个简单字符串，而是 content block 数组。一个 assistant message 里可能既有文本，也有工具调用：

```js
{
  role: 'assistant',
  content: [
    { type: 'text', text: '我需要读取文件。' },
    { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/index.ts' } }
  ]
}
```

设计原理：

- 文本和工具调用都属于 assistant 的输出内容。
- 后续 agent loop 需要把这个 assistant message 保存到历史里。
- 如果模型发起工具调用，下一步要根据 `tool_use` block 执行工具，并把 tool result 回传给模型。

所以 Step 1 虽然不执行工具，但必须保留 `tool_use` block。否则 Step 2 没法继续。

## 7. `streamMessage()` 是这个文件的核心

代码：

```js
export async function* streamMessage({ messages, model = DEFAULT_MODEL, system, tools }) {
  const client = getClient()
  const stream = client.messages.stream({
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages,
    stream: true,
    ...(system ? { system } : {}),
    ...(tools?.length ? { tools } : {})
  })

  // 处理 stream events
}
```

这个函数的职责是把 SDK 的原始 streaming events 包装成项目更好用的事件流。

输入：

- `messages`：对话历史，至少包含 user message。
- `model`：可选，默认用环境变量里的模型。
- `system`：可选，系统提示词。
- `tools`：可选，模型可调用的工具定义。

输出：

- 通过 `yield` 输出实时事件。
- 通过 `return` 输出最终结果。

设计原理：

- SDK event 通常比较细，调用方不应该直接依赖 SDK 的所有事件类型。
- 项目应该定义自己的内部事件，比如 `text`、`tool_use_start`、`message_done`。
- 这样以后换 SDK 或兼容不同 provider 时，上层调用方不用大改。

## 8. 请求参数里的条件展开

这两行语法很实用：

```js
...(system ? { system } : {}),
...(tools?.length ? { tools } : {})
```

作用是按条件追加对象字段。

如果有 `system`，请求对象里就包含：

```js
{
  system: '...'
}
```

如果没有，就展开空对象：

```js
{
}
```

`tools?.length` 使用了可选链：

- `tools` 是 `undefined` 时，不会报错。
- `tools` 是数组且长度大于 0 时，才传给模型。

设计原理：

- 不要把 `undefined` 或空数组随意传给 SDK。
- 请求对象只包含本次真正需要的参数。

## 9. 内部状态：为什么要维护 content、usage、stopReason、pendingToolJson

进入事件循环前，代码初始化了几个状态：

```js
const content = []
const usage = { input_tokens: 0, output_tokens: 0 }
let stopReason = 'end_turn'
let pendingToolJson = ''
```

它们各自的职责：

| 状态              | 作用                                   |
| ----------------- | -------------------------------------- |
| `content`         | 组装最终 assistant message 的内容块    |
| `usage`           | 记录输入和输出 token 数                |
| `stopReason`      | 记录模型停止原因                       |
| `pendingToolJson` | 暂存工具调用参数的 JSON 字符串增量片段 |

设计原理：

- streaming event 是分散到达的，最终 assistant message 需要边接收边组装。
- 文本可以一边到达一边追加。
- 工具参数不是一次性完整对象，而是 `partial_json` 片段，所以要先拼接字符串。
- usage 和 stop reason 可能在不同事件里出现，所以要单独保存。

这其实是一个小型状态机：每收到一个 event，就根据 event 类型更新内部状态，并在需要时 `yield` 对外事件。

## 10. 事件循环：`for await (const event of stream)`

代码：

```js
for await (const event of stream) {
  switch (
    event.type
    // ...
  ) {
  }
}
```

作用：

- 持续等待模型返回的下一个 streaming event。
- 每来一个 event，就进入 `switch` 分支处理。
- 直到模型 stream 结束，循环退出。

设计原理：

- LLM streaming 是异步数据流，不是一次性数组。
- 下一个 event 什么时候到达取决于网络和模型生成速度。
- `for await...of` 正适合消费这种异步可迭代对象。

如果用普通 `await`，只能等最终结果。如果用普通 `for...of`，又无法等待异步 event。这里必须用 `for await...of`。

## 11. 事件处理总览

`switch (event.type)` 是整个解析逻辑的主干。

一次纯文本响应可能长这样：

```text
message_start
content_block_start(text)
content_block_delta(text_delta)
content_block_delta(text_delta)
content_block_stop
message_delta
message_stop
```

一次包含工具调用的响应可能长这样：

```text
message_start
content_block_start(text)
content_block_delta(text_delta)
content_block_stop
content_block_start(tool_use)
content_block_delta(input_json_delta)
content_block_delta(input_json_delta)
content_block_stop
message_delta
message_stop
```

Step 1 的核心就是把这些事件翻译成项目关心的事情：

- 开始了。
- 输出了一段文本。
- 准备调用工具。
- 工具参数完整了。
- 结束了。

## 12. `message_start`：记录输入 token，通知开始

代码：

```js
case 'message_start': {
  usage.input_tokens = event.message.usage?.input_tokens || 0
  yield { type: 'message_start', messageId: event.message.id }
  break
}
```

作用：

- 从 SDK event 中取出 message id。
- 记录输入 token 数。
- 向调用方发出 `message_start` 事件。

设计原理：

- message id 适合用于日志、调试和追踪。
- input tokens 是本次调用成本的一部分。
- `yield message_start` 可以让 UI 或 CLI 知道模型已经开始响应。

## 13. `content_block_start`：初始化内容块

代码里分两种 block。

文本块：

```js
if (event.content_block.type === 'text') {
  content[event.index] = textBlock('')
}
```

工具调用块：

```js
if (event.content_block.type === 'tool_use') {
  content[event.index] = toolUseBlock(event.content_block.id, event.content_block.name, {})
  pendingToolJson = ''
  yield {
    type: 'tool_use_start',
    id: event.content_block.id,
    name: event.content_block.name
  }
}
```

作用：

- 根据 SDK 给出的 `index`，在 `content` 数组对应位置初始化 block。
- 如果是工具调用，额外通知调用方工具调用开始。

设计原理：

- `index` 很重要，因为 assistant message 可能有多个 content block。
- 不能简单 `push`，否则如果 SDK event 带有明确 index，就可能破坏原始顺序。
- 工具调用开始时，还拿不到完整 input，只能先创建空对象，等后续 JSON delta 拼完。

正式项目里建议增强：

- 如果同一个 `index` 被重复初始化，要抛出协议错误。
- 如果工具调用可能并发交错，`pendingToolJson` 应改成按 `index` 存储的 map。

## 14. `content_block_delta`：处理文本增量和工具参数增量

文本增量：

```js
if (event.delta.type === 'text_delta') {
  content[event.index].text += event.delta.text
  yield { type: 'text', text: event.delta.text }
}
```

作用：

- 把文本片段追加到最终 content block。
- 同时通过 `yield` 把这个片段实时交给调用方。

设计原理：

- 最终消息需要完整文本，所以要累积。
- 用户界面需要实时显示，所以要立刻 `yield`。
- 同一个 delta 同时服务“最终存档”和“实时渲染”两个目标。

工具参数增量：

```js
if (event.delta.type === 'input_json_delta') {
  pendingToolJson += event.delta.partial_json
}
```

作用：

- 把工具调用参数的 JSON 片段先拼起来。

设计原理：

- 工具 input 是 JSON 对象，但 streaming 时可能被切成多个字符串片段。
- 片段到达时通常不是合法 JSON，不能每次 delta 都 parse。
- 必须等 block 结束后再 parse。

## 15. `content_block_stop`：完成工具参数解析

代码：

```js
case 'content_block_stop': {
  const block = content[event.index]
  if (block?.type === 'tool_use' && pendingToolJson) {
    block.input = JSON.parse(pendingToolJson)
    pendingToolJson = ''
  }
  break
}
```

作用：

- 当前 content block 结束。
- 如果这个 block 是工具调用，就把累积的 JSON 字符串解析成对象。
- 把解析结果写回 `tool_use` block 的 `input`。

设计原理：

- 工具调用必须保留完整 input，否则后续 agent loop 无法执行工具。
- `content_block_stop` 是一个合理的解析时机，因为这时 input_json_delta 已经收完。

正式项目里必须补错误处理：

```js
try {
  block.input = JSON.parse(pendingToolJson)
} catch (error) {
  throw new Error(`Invalid tool input JSON: ${pendingToolJson}`)
}
```

学习样例省略了这部分，是为了突出主流程。

## 16. `message_delta`：更新输出 token 和停止原因

代码：

```js
case 'message_delta': {
  usage.output_tokens = event.usage?.output_tokens || usage.output_tokens
  stopReason = event.delta.stop_reason || stopReason
  break
}
```

作用：

- 更新输出 token 数。
- 更新模型停止原因。

常见 stop reason：

- `end_turn`：模型自然完成本轮回答。
- `tool_use`：模型希望调用工具。
- `max_tokens`：达到最大输出 token 限制。

设计原理：

- stop reason 决定下一步 agent 应该做什么。
- 如果是 `end_turn`，通常可以结束。
- 如果是 `tool_use`，下一步要执行工具。
- 如果是 `max_tokens`，可能要提示截断或继续生成。

Step 1 不做下一步决策，但必须把 stop reason 保留下来。

## 17. `message_stop`：通知本轮结束

代码：

```js
case 'message_stop': {
  yield { type: 'message_done', stopReason, usage: { ...usage } }
  break
}
```

作用：

- 向调用方发出结束事件。
- 把 stop reason 和 usage 一起交出去。

`{ ...usage }` 是浅拷贝。它避免调用方拿到内部 `usage` 对象引用后，意外影响内部状态。

设计原理：

- UI 可以在 `message_done` 时关闭 loading 状态。
- CLI 可以在 `message_done` 时换行并打印 token 使用量。
- agent loop 可以根据 stop reason 决定下一步。

## 18. 函数末尾的 `return`：返回完整 assistant message

代码：

```js
return {
  assistantMessage: { role: 'assistant', content },
  usage,
  stopReason
}
```

作用：

- 返回完整的 assistant message。
- 返回最终 usage。
- 返回最终 stop reason。

设计原理：

- `yield` 负责实时事件。
- `return` 负责最终结果。

这个 assistant message 后续应该被追加到 messages 历史里。完整 agent loop 下一步会根据是否有 `tool_use` block 来决定是否执行工具。

需要注意：如果调用方使用 `for await...of`，默认只能消费 `yield` 出来的事件，不能直接拿到这个 `return` 值。测试或底层封装如果要拿最终结果，需要手动调用 iterator 的 `next()` 直到 `done: true`。

## 19. 语法支撑：为什么这里需要 `async function*`

`streamMessage` 的定义是：

```js
export async function* streamMessage(...) {
  // ...
}
```

它同时需要两种能力：

- `async`：内部要等待异步 stream event。
- `function*`：执行过程中要多次产出中间事件。

普通 `async function` 只能最终 `return` 一个 Promise 结果，不适合实时输出文本。

普通 `function*` 不能自然等待网络异步事件，不适合消费 LLM stream。

所以 LLM streaming client 很适合用 `async function*`：

```js
async function* demo() {
  yield '第一段'
  await new Promise((resolve) => setTimeout(resolve, 100))
  yield '第二段'
}
```

调用方式：

```js
for await (const text of demo()) {
  console.log(text)
}
```

这就是 Step 1 的语法基础。

## 20. 语法支撑：`for await...of`

`for await...of` 用来遍历异步可迭代对象。

普通数组可以用：

```js
for (const item of [1, 2, 3]) {
  console.log(item)
}
```

LLM stream 不能这样处理，因为下一个 event 还没到，需要等待：

```js
for await (const event of stream) {
  console.log(event)
}
```

可以近似理解成：

```js
while (true) {
  const result = await iterator.next()
  if (result.done) break
  const event = result.value
  // 处理 event
}
```

使用场景：

- LLM streaming。
- 文件流。
- WebSocket 消息。
- 消息队列。
- 分页接口。
- 日志流。

## 21. 语法支撑：`yield`

`yield` 表示“产出一个值，然后暂停函数”。

在这个文件里，`yield` 的作用不是返回最终答案，而是把中间事件实时交给调用方：

```js
yield { type: 'text', text: event.delta.text }
```

调用方可以这样消费：

```js
for await (const event of streamMessage({ messages })) {
  if (event.type === 'text') {
    process.stdout.write(event.text)
  }
}
```

`yield` 和 `return` 的区别：

| 语法     | 作用             | 函数是否结束 |
| -------- | ---------------- | ------------ |
| `yield`  | 产出一个中间结果 | 不结束       |
| `return` | 返回最终结果     | 结束         |

这正好对应 Step 1 的两个目标：

- 模型正在输出时，用 `yield` 实时通知。
- 模型结束后，用 `return` 给出完整结果。

## 22. 最小消费示例

伪代码：

```js
import { streamMessage } from './learn/step1.js'

const iterator = streamMessage({
  messages: [{ role: 'user', content: '用一句话解释什么是 agent。' }]
})

for await (const event of iterator) {
  if (event.type === 'message_start') {
    console.log('message id:', event.messageId)
  }

  if (event.type === 'text') {
    process.stdout.write(event.text)
  }

  if (event.type === 'tool_use_start') {
    console.log('tool:', event.name)
  }

  if (event.type === 'message_done') {
    console.log('\nusage:', event.usage)
    console.log('stop reason:', event.stopReason)
  }
}
```

这个示例展示了 Step 1 对调用方的价值：调用方不需要理解 SDK 的所有底层 event，只需要处理项目包装后的少量事件。

## 23. 这个学习样例的工程缺口

作为学习样例，它已经把核心原理讲清楚。但正式项目中需要补齐这些能力：

- 类型：`messages`、`tools`、SDK event、内部 event、content block 都要有明确类型。
- 环境变量：统一从 `src/config/env.ts` 读取，避免散落 `process.env`。
- 错误处理：工具 JSON 解析失败时要抛出带上下文的错误。
- 协议保护：收到异常事件顺序时要尽早失败。
- 测试注入：stream source 要可注入，方便用 fake events 单独测试。
- 多工具块处理：`pendingToolJson` 最好按 content block index 存储。
- 日志和调试：message id、stop reason、usage 应该方便观测。

后续正式实现要保留 Step 1 的核心流程，但不能照搬这个单文件结构。

## 24. 一句话总结

`learn/step1.js` 的设计核心是：把模型 SDK 的原始异步事件流，转换成项目自己的可消费事件流；一边用 `yield` 输出实时事件，一边在内部维护状态并组装最终 assistant message。`async function*`、`for await...of` 和 `yield` 是实现这个设计最自然的语法组合。
