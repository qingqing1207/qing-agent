# 00：解读 learn/step2.js 的设计、流程和原理

这份文档只解读 `learn/step2.js`。它的重点不是正式工程结构，而是解释 Step 2 想讲清楚的核心流程：如何把 Step 1 的流式模型调用，放进一个可以持续对话的终端 REPL 里。

## 1. Step 2 要解决什么问题

Step 1 已经完成了“调用一次模型并流式输出”的能力。

Step 2 在此基础上增加一层交互：

1. 终端里等待用户输入。
2. 用户输入一条消息。
3. 把用户消息追加到 `messages` 历史。
4. 调用 `streamMessage()` 让模型回复。
5. 实时打印模型输出。
6. 模型结束后，把 assistant message 也追加到 `messages` 历史。
7. 回到第 1 步，继续下一轮对话。

这就是最小多轮聊天。

它还不是完整 agent。它不执行工具，也不做复杂 UI，只是证明“对话历史 + streaming 输出 + 终端输入”这条链路能跑通。

## 2. 什么是 REPL

REPL 是 Read-Eval-Print Loop 的缩写：

- Read：读取输入。
- Eval：处理输入。
- Print：输出结果。
- Loop：继续下一轮。

`learn/step2.js` 中的 REPL 大致是：

```text
while (true)
  读取用户输入
  如果是命令，处理命令
  如果是普通文本，调用模型
  打印模型输出
  保存对话历史
```

这里的 Eval 不是执行代码，而是“把用户消息交给 LLM 处理”。

## 3. 文件顶部注释的定位

代码开头：

```js
/**
 * Step 2 - Minimal interactive REPL
 *
 * Goal:
 * - show how multi-turn chat works in the terminal
 * - keep state in memory
 * - print streaming text incrementally
 *
 * This version uses Node readline for teaching simplicity.
 * The real project uses React/Ink for a richer terminal UI.
 */
```

这段注释说明了 Step 2 的边界：

- `multi-turn chat`：重点是多轮对话。
- `keep state in memory`：历史只保存在内存里，不落库、不持久化。
- `print streaming text incrementally`：模型输出要实时打印，不等完整回复结束。
- `readline for teaching simplicity`：这里用 Node 原生 readline，是为了教学简单；正式项目可以换成 React/Ink、Commander、Inquirer 或其他 CLI UI。

所以 Step 2 的价值不是 readline 本身，而是 REPL 的状态流转。

## 4. 依赖导入

代码：

```js
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { streamMessage } from './step1.js'
```

### `node:readline/promises`

`readline` 是 Node.js 内置模块，用于从终端读取用户输入。

这里引入的是 promise 版本，所以可以这样写：

```js
const text = await rl.question('> ')
```

如果使用非 promise 版本，需要写 callback 或事件监听，教学上更绕。

### `stdin` 和 `stdout`

```js
import { stdin as input, stdout as output } from 'node:process'
```

- `stdin`：标准输入，用户在终端敲的内容来自这里。
- `stdout`：标准输出，程序打印到终端的内容写到这里。

这里用 `as input`、`as output` 是给变量起更贴近 readline API 的名字。

### `streamMessage`

```js
import { streamMessage } from './step1.js'
```

Step 2 不重新实现模型调用，而是复用 Step 1。

这点很重要：Step 2 的职责是交互和历史管理，模型 streaming 的细节仍然由 Step 1 负责。

## 5. `runRepl()` 是 Step 2 的入口

代码：

```js
export async function runRepl({ model, system } = {}) {
  // ...
}
```

它导出一个异步函数，允许调用方传入：

- `model`：指定模型。
- `system`：指定系统提示词。

默认参数：

```js
{ model, system } = {}
```

意思是调用方可以不传参数：

```js
await runRepl()
```

也可以传：

```js
await runRepl({
  model: 'deepseek-v4-flash',
  system: '你是一个简洁的 CLI assistant'
})
```

## 6. 创建 readline interface

代码：

```js
const rl = readline.createInterface({ input, output })
```

`rl` 是终端交互对象。

它负责：

- 显示 prompt。
- 等待用户输入。
- 用户按 Enter 后返回输入内容。
- 最后关闭输入输出资源。

后面读取用户输入靠它：

```js
await rl.question('> ')
```

## 7. `messages` 是多轮对话的核心状态

代码：

```js
const messages = []
```

`messages` 保存整个对话历史。

每一轮用户输入后：

```js
messages.push({ role: 'user', content: text })
```

模型回复结束后：

```js
messages.push(finalResult.assistantMessage)
```

下一轮调用模型时，会把完整 `messages` 再传给 `streamMessage()`：

```js
const stream = streamMessage({ messages, model, system })
```

这就是多轮对话的原理：模型本身不记得上一轮内容，调用方必须把历史消息再次传入。

## 8. 启动提示

代码：

```js
console.log('Easy Agent REPL')
console.log('Type /exit to quit, /clear to clear history.')
```

作用：

- 告诉用户进入了 REPL。
- 告诉用户支持两个命令。

这属于最小 CLI 体验。正式项目里可以把这些文本做成更清晰的欢迎页，但 Step 2 只保留必要提示。

## 9. 主循环：`while (true)`

代码：

```js
while (true) {
  const text = (await rl.question('> ')).trim()
  if (!text) continue

  // ...
}
```

`while (true)` 表示 REPL 会一直运行，直到用户输入 `/exit`。

读取输入：

```js
const text = (await rl.question('> ')).trim()
```

含义：

- 显示 `> ` 作为输入提示。
- 等待用户输入。
- 用户按 Enter 后返回字符串。
- `.trim()` 去掉前后空白。

空输入处理：

```js
if (!text) continue
```

如果用户直接按 Enter，就跳过本轮，重新等待输入。

## 10. 命令处理：`/exit` 和 `/clear`

代码：

```js
if (text === '/exit') break
```

`/exit` 直接跳出主循环，后面会执行 `rl.close()`。

代码：

```js
if (text === '/clear') {
  messages.length = 0
  console.log('(history cleared)')
  continue
}
```

`/clear` 清空对话历史。

这里用：

```js
messages.length = 0
```

而不是：

```js
messages = []
```

因为 `messages` 是 `const` 声明，不能重新赋值，但数组内容可以被修改。设置 `length = 0` 是清空数组的常见写法。

清空后 `continue`，表示不调用模型，直接进入下一轮输入。

## 11. 普通输入：追加 user message

代码：

```js
messages.push({ role: 'user', content: text })
```

当用户输入不是命令时，就把它当作普通 user message。

Anthropic Messages API 的最小消息格式是：

```js
{
  role: 'user',
  content: '...'
}
```

这一步必须在调用模型之前完成，否则模型看不到当前用户问题。

## 12. 调用 Step 1 的 streaming client

代码：

```js
const stream = streamMessage({ messages, model, system })
let finalResult = null
```

`streamMessage()` 返回的是 async generator。

它会不断 `yield` 实时事件：

- `text`
- `tool_use_start`
- `message_done`

最后还会通过 `return` 返回：

- `assistantMessage`
- `usage`
- `stopReason`

这里初始化 `finalResult = null`，是为了等 stream 完全结束后保存最终结果。

## 13. 为什么这里不用 `for await...of`

代码用了手动 `next()`：

```js
while (true) {
  const { value, done } = await stream.next()
  if (done) {
    finalResult = value
    break
  }

  // handle event
}
```

这是一个很重要的设计点。

如果写成：

```js
for await (const event of stream) {
  // handle event
}
```

可以拿到所有 `yield` 出来的事件，但拿不到 async generator 最后的 `return` 值。

Step 2 需要最终的 `assistantMessage`，因为要把它追加到 `messages` 历史：

```js
messages.push(finalResult.assistantMessage)
```

所以这里必须手动调用 `stream.next()`，在 `done === true` 时拿到 `value`，也就是最终 return 值。

## 14. 实时打印 assistant 文本

代码：

```js
process.stdout.write('assistant: ')
```

先打印 assistant 前缀。

然后处理 `text` 事件：

```js
if (value.type === 'text') {
  process.stdout.write(value.text)
}
```

这里不用 `console.log()`，因为 `console.log()` 每次都会换行。

streaming 文本要像打字一样连续显示，所以用：

```js
process.stdout.write(...)
```

## 15. 工具调用提示

代码：

```js
if (value.type === 'tool_use_start') {
  process.stdout.write('\n[tool: ' + value.name + ']\n')
}
```

Step 2 不执行工具。

它只是告诉用户：模型想调用某个工具。

这给 Step 3 留出了扩展点：后续可以在这里进入工具执行流程，然后把工具结果追加回 messages。

## 16. 保存 assistant message

stream 结束后：

```js
messages.push(finalResult.assistantMessage)
```

这是多轮对话能成立的关键。

如果只保存 user message，不保存 assistant message，下一轮模型看到的历史会不完整。

完整历史应该像这样：

```js
;[
  { role: 'user', content: '你好' },
  { role: 'assistant', content: [{ type: 'text', text: '你好，有什么可以帮你？' }] },
  { role: 'user', content: '继续解释 agent' }
]
```

下一次调用模型时，它会根据完整上下文继续回答。

## 17. 打印 token 统计

代码：

```js
console.log(
  '(tokens in/out: ' + finalResult.usage.input_tokens + '/' + finalResult.usage.output_tokens + ')'
)
```

作用：

- 打印本轮输入 token 和输出 token。
- 方便观察每轮对话历史变长后，输入 token 如何增加。

注意：`learn/step2.js` 复用的是 `learn/step1.js`，所以 `usage` 字段是 snake_case：

```js
input_tokens
output_tokens
```

正式项目中当前 `src/llm/types.ts` 已经改成 camelCase：

```ts
inputTokens
outputTokens
```

所以正式实现时不能直接复制这段打印逻辑，要按项目内部类型读取。

## 18. 关闭 readline

代码：

```js
rl.close()
```

当用户输入 `/exit` 后，主循环结束，必须关闭 readline interface。

否则终端输入资源可能保持打开，程序不一定能正常退出。

正式项目里还要考虑：

- `try/finally` 保证异常时也关闭。
- `Ctrl+C` 退出。
- 网络请求失败后继续 REPL。
- 流式请求中断。

## 19. Step 2 的设计价值

`learn/step2.js` 其实讲了四件事：

1. REPL 的基础结构：读取、处理、打印、循环。
2. 多轮对话历史：每轮追加 user 和 assistant message。
3. streaming 渲染：边收到 text 事件边写 stdout。
4. generator return 值：用手动 `next()` 拿最终 assistant message。

这四点是后续正式 CLI 的基础。

## 20. 学习样例的工程缺口

作为学习样例，它保持了足够简单。但正式项目需要补齐：

- 类型：`messages`、`finalResult`、command、REPL 配置都要有明确类型。
- 错误处理：模型调用失败时不能让 REPL 直接崩掉。
- 资源释放：使用 `try/finally` 确保 `rl.close()`。
- 测试注入：readline 和 streamMessage 都要可注入，才能单元测试。
- 命令解析：`/exit`、`/clear` 不应该散在主循环里。
- 输出渲染：后续可以从直接 `process.stdout.write` 抽成 renderer。
- 历史策略：长对话会导致 token 不断增加，后续要考虑压缩或裁剪。

## 21. 一句话总结

`learn/step2.js` 的核心思想是：在终端 REPL 中维护一份内存对话历史，每轮把用户输入追加到 history，调用 Step 1 的 streaming client 实时打印 assistant 输出，最后把完整 assistant message 追加回 history，从而形成最小多轮聊天。
