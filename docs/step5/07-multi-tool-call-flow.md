# Step 5：多工具调用链路解释

本文用一次真实 REPL 调用解释：

```text
Read -> Edit -> Read
```

这类多工具调用在项目里是怎么流转的。

示例用户输入：

```text
把 tmp/edit-smoke.ts 文件里的 const value = "old" 替换成 const value = "new"
```

实际输出里出现了三次工具调用：

```text
[tool: Read]
[tool result: Read ok]

assistant: 好的，文件存在，现在执行替换操作。
[tool: Edit]
[tool result: Edit ok]

assistant: 替换完成！文件 `tmp/edit-smoke.ts` 中的 ...
[tool: Read]
[tool result: Read ok]

assistant: 现在文件内容如下：
...
```

## 核心结论

这里不是三个工具同时执行。

它是多轮顺序工具调用：

```text
第 1 次模型调用
  assistant 返回 tool_use(Read)

本地执行 Read
  user 回传 tool_result(Read)

第 2 次模型调用
  assistant 返回 text + tool_use(Edit)

本地执行 Edit
  user 回传 tool_result(Edit)

第 3 次模型调用
  assistant 返回 text + tool_use(Read)

本地执行 Read
  user 回传 tool_result(Read)

第 4 次模型调用
  assistant 返回最终 text
```

当前 agent loop 没有并发执行工具。

即使同一条 assistant message 里包含多个 `tool_use` block，代码也是串行执行：

```ts
for (const toolUse of toolUses) {
  const toolResult = await runToolUse(toolUse, tools, context)
  // ...
}
```

## 一次模型调用会返回什么

一次模型调用最终返回一个 assistant message。

这个 message 的 `content` 是数组，里面可以有多个 block：

```ts
{
  role: 'assistant',
  content: [
    {
      type: 'text',
      text: '好的，文件存在，现在执行替换操作。'
    },
    {
      type: 'tool_use',
      id: 'toolu_x',
      name: 'Edit',
      input: {
        file_path: 'tmp/edit-smoke.ts',
        old_string: 'const value = "old"',
        new_string: 'const value = "new"'
      }
    }
  ]
}
```

所以这句：

```text
assistant: 好的，文件存在，现在执行替换操作。
```

不是工具结果。

它是第二次模型调用返回的 assistant message 里的 `text` content block。

后面的：

```text
[tool: Edit]
```

来自同一个 assistant message 里的 `tool_use` content block。

## Stream 不是一次性返回整个 message

虽然最终 assistant message 是：

```ts
content: [textBlock, toolUseBlock]
```

但 `streamMessage()` 里拿到的是流式事件：

```ts
for await (const event of stream) {
  // ...
}
```

模型不会一次性给项目一个完整数组。

它会按流式事件逐步返回，形式类似：

```text
message_start

content_block_start(text)
content_block_delta(text_delta: "好的，")
content_block_delta(text_delta: "文件存在，")
content_block_delta(text_delta: "现在执行替换操作。")
content_block_stop

content_block_start(tool_use: Edit)
content_block_delta(input_json_delta: '{"file_path":"tmp/edit-smoke.ts",')
content_block_delta(input_json_delta: '"old_string":"const value = ...",')
content_block_delta(input_json_delta: '"new_string":"const value = ..."}')
content_block_stop

message_delta(stop_reason: "tool_use")
message_stop
```

项目把这些底层 stream event 转换成自己的事件。

## `text_delta` 如何变成 REPL 输出

在 `src/llm/stream-message.ts` 中：

```ts
if (event.delta.type === 'text_delta') {
  const block = getTextBlock(content, event.index)
  block.text += event.delta.text
  yield { type: 'text', text: event.delta.text }
}
```

这做了两件事：

```text
1. 把 delta 追加到当前 text block。
2. 立刻 yield 一个 { type: 'text' } 事件给外层。
```

REPL 收到 `text` event 后：

```ts
if (event.type === 'text') {
  if (needsAssistantPrefix) {
    renderer.write('assistant: ')
  }

  renderer.write(event.text)
  return false
}
```

所以终端打印：

```text
assistant: 好的，文件存在，现在执行替换操作。
```

## `tool_use` 如何变成 `[tool: Edit]`

在 `src/llm/stream-message.ts` 中：

```ts
if (event.content_block.type === 'tool_use') {
  content[event.index] = createToolUseBlock(
    event.content_block.id,
    event.content_block.name
  )
  pendingToolJsonByIndex.set(event.index, '')
  yield {
    type: 'tool_use_start',
    id: event.content_block.id,
    name: event.content_block.name
  }
}
```

这时工具参数 JSON 还没有收完。

所以项目先 yield：

```ts
{ type: 'tool_use_start', id: 'toolu_x', name: 'Edit' }
```

REPL 收到后打印：

```text
[tool: Edit]
```

工具输入参数来自后续的 `input_json_delta`：

```ts
if (event.delta.type === 'input_json_delta') {
  const currentJson = pendingToolJsonByIndex.get(event.index)
  pendingToolJsonByIndex.set(event.index, currentJson + event.delta.partial_json)
}
```

等 `content_block_stop` 时再解析完整 JSON：

```ts
if (block?.type === 'tool_use') {
  const pendingToolJson = pendingToolJsonByIndex.get(event.index)
  if (pendingToolJson) {
    block.input = parseToolInput(pendingToolJson, block)
  }
  pendingToolJsonByIndex.delete(event.index)
}
```

这就是为什么 `[tool: Edit]` 可以先显示，而 `[tool input: ...]` 要到工具执行完成时才显示。

## `stopReason: "tool_use"` 的作用

在 stream 中：

```ts
case 'message_delta': {
  usage.outputTokens = event.usage.output_tokens ?? usage.outputTokens
  stopReason = event.delta.stop_reason ?? stopReason
  break
}
```

当模型决定调用工具时，最终 stop reason 通常是：

```text
tool_use
```

`streamMessage()` 最后 return：

```ts
return {
  assistantMessage: { role: 'assistant', content: compactContent(content) },
  usage,
  stopReason
}
```

`agent-loop` 根据它决定是否继续工具循环：

```ts
const toolUses = getToolUseBlocks(result.assistantMessage.content)

if (result.stopReason !== 'tool_use' || toolUses.length === 0) {
  return {
    messagesToAppend,
    finalAssistantMessage: result.assistantMessage,
    usage: totalUsage,
    stopReason: result.stopReason
  }
}
```

含义：

```text
stopReason 不是 tool_use
  本轮 agent turn 结束。

stopReason 是 tool_use 且 content 里有 tool_use block
  本地执行工具，然后把 tool_result 回传给模型。
```

## 工具执行和 tool_result

当 agent loop 发现 assistant message 里有 `tool_use`：

```ts
for (const toolUse of toolUses) {
  const toolResult = await runToolUse(toolUse, tools, context)

  toolResultBlocks.push(createToolResultBlock(toolUse.id, toolResult))

  yield {
    type: 'tool_result',
    toolUseId: toolUse.id,
    toolName: toolUse.name,
    input: toolUse.input,
    content: toolResult.content,
    isError: Boolean(toolResult.isError)
  }
}
```

这里发生三件事：

```text
1. 找到本地工具并执行。
2. 把结果转换成 Anthropic 需要的 tool_result block。
3. yield 一个项目内部的 tool_result event 给 REPL 显示。
```

REPL 收到内部 `tool_result` event 后打印：

```text
[tool result: Edit ok]
[tool input: {"file_path":"tmp/edit-smoke.ts", ...}]
Edited tmp/edit-smoke.ts
...
```

注意：

```text
[tool result: Edit ok]
```

不是模型说的。

这是项目本地执行工具后，REPL 自己渲染出来的状态。

## tool_result 会作为 user message 回传

工具结果不是 assistant message。

Anthropic 协议要求工具结果由下一条 `user` message 回传。

agent loop 里：

```ts
const toolResultMessage: MessageParam = {
  role: 'user',
  content: toolResultBlocks
}

messagesToAppend.push(toolResultMessage)
currentMessages.push(toolResultMessage)
```

所以第二次模型调用之后，消息历史大致变成：

```ts
[
  {
    role: 'user',
    content: '把 tmp/edit-smoke.ts 文件里的 const value = "old" 替换成 const value = "new"'
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_read_1',
        name: 'Read',
        input: { file_path: 'tmp/edit-smoke.ts' }
      }
    ]
  },
  {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_read_1',
        content: 'File: tmp/edit-smoke.ts\nLines: ...'
      }
    ]
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: '好的，文件存在，现在执行替换操作。'
      },
      {
        type: 'tool_use',
        id: 'toolu_edit_1',
        name: 'Edit',
        input: {
          file_path: 'tmp/edit-smoke.ts',
          old_string: 'const value = "old"',
          new_string: 'const value = "new"'
        }
      }
    ]
  },
  {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_edit_1',
        content: 'Edited tmp/edit-smoke.ts\n\nIndex: ...'
      }
    ]
  }
]
```

然后模型基于这个新的历史继续下一轮。

## 你的例子逐轮拆解

### 第 1 轮：模型请求 Read

用户输入：

```text
把 tmp/edit-smoke.ts 文件里的 const value = "old" 替换成 const value = "new"
```

模型返回：

```ts
{
  role: 'assistant',
  content: [
    {
      type: 'tool_use',
      name: 'Read',
      input: {
        file_path: 'tmp/edit-smoke.ts'
      }
    }
  ]
}
```

stop reason：

```text
tool_use
```

本地执行 Read，REPL 打印：

```text
[tool: Read]
[tool result: Read ok]
[tool input: {"file_path":"tmp/edit-smoke.ts"}]
File: tmp/edit-smoke.ts
Lines: 1-3 / 3
1       const value = "old"
2       console.log(value)
3
```

### 第 2 轮：模型返回 text + Edit

模型看到了 Read 的 tool_result。

然后返回：

```ts
{
  role: 'assistant',
  content: [
    {
      type: 'text',
      text: '好的，文件存在，现在执行替换操作。'
    },
    {
      type: 'tool_use',
      name: 'Edit',
      input: {
        file_path: 'tmp/edit-smoke.ts',
        old_string: 'const value = "old"',
        new_string: 'const value = "new"'
      }
    }
  ]
}
```

REPL 先打印 text：

```text
assistant: 好的，文件存在，现在执行替换操作。
```

然后同一次模型返回里又开始 tool block：

```text
[tool: Edit]
```

本地执行 Edit 后打印：

```text
[tool result: Edit ok]
[tool input: {"file_path":"tmp/edit-smoke.ts","old_string":"const value = \"old\"","new_string":"const value = \"new\""}]
Edited tmp/edit-smoke.ts
...
```

### 第 3 轮：模型返回 text + Read

模型看到了 Edit 的 tool_result。

它决定再读一次文件确认结果。

所以返回：

```ts
{
  role: 'assistant',
  content: [
    {
      type: 'text',
      text: '替换完成！文件 `tmp/edit-smoke.ts` 中的 ... 验证一下：'
    },
    {
      type: 'tool_use',
      name: 'Read',
      input: {
        file_path: 'tmp/edit-smoke.ts'
      }
    }
  ]
}
```

本地执行 Read 后，模型进入下一轮。

### 第 4 轮：模型最终回答

这次模型没有继续请求工具。

assistant message 只有 text：

```ts
{
  role: 'assistant',
  content: [
    {
      type: 'text',
      text: '现在文件内容如下：... 替换已成功完成。'
    }
  ]
}
```

stop reason 不是：

```text
tool_use
```

所以 agent loop 结束本轮用户输入。

## 多工具调用的两种情况

### 情况一：多轮顺序工具调用

你的例子属于这种：

```text
模型调用 Read
工具执行 Read
模型调用 Edit
工具执行 Edit
模型调用 Read
工具执行 Read
模型最终回答
```

每次工具结果都会回传给模型。

模型看完结果后，再决定下一步是否继续调用工具。

### 情况二：同一轮 assistant message 里有多个 tool_use

模型也可能一次返回多个 tool use：

```ts
content: [
  { type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } },
  { type: 'tool_use', name: 'Read', input: { file_path: 'src/b.ts' } }
]
```

当前 agent loop 会按顺序执行：

```text
执行第一个 Read
执行第二个 Read
生成一条 user tool_result message，里面包含两个 tool_result block
继续调用模型
```

当前没有并发执行。

## 为什么要保存每条 assistant 和 tool_result

agent loop 每轮都会追加：

```ts
messagesToAppend.push(result.assistantMessage)
currentMessages.push(result.assistantMessage)
```

工具执行后又追加：

```ts
messagesToAppend.push(toolResultMessage)
currentMessages.push(toolResultMessage)
```

原因是下一次模型调用必须看到完整历史：

```text
assistant 请求了哪个 tool_use
本地返回了哪个 tool_result
tool_result 对应哪个 tool_use_id
```

如果只保存最终文本，不保存中间 tool_use 和 tool_result，下一轮模型就无法正确理解工具链路。

## 小结

你的例子里：

```text
assistant: 好的，文件存在，现在执行替换操作。
```

是第二次模型调用里的 `text` block。

它和：

```text
[tool: Edit]
```

属于同一次 assistant message。

一次模型调用可以有多个 content block。

stream 会把这些 block 拆成多个事件逐步吐出。

agent loop 看到 `stopReason === 'tool_use'` 后，执行工具、生成 `tool_result` user message，然后继续下一次模型调用。
