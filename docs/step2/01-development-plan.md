# Step 2：把最小交互式 REPL 集成进正式项目

`learn/step2.js` 是学习样例，它证明了最小多轮终端聊天需要哪些核心能力：

1. 读取用户输入。
2. 识别 `/exit`、`/clear` 等命令。
3. 维护内存中的 `messages` 历史。
4. 调用 Step 1 的 `streamMessage()`。
5. 实时渲染 streaming text。
6. 把最终 assistant message 写回历史。

正式项目不要直接复制 `learn/step2.js`。应该把“REPL 控制流”和“终端 IO / 模型调用 / 渲染”拆开，这样后续才能测试、扩展和替换 UI。

## 目标

本阶段实现一个正式项目中的最小 CLI REPL。

要完成的能力：

- `npm run repl` 可以启动终端聊天。
- 用户输入普通文本时，调用 `src/llm/stream-message.ts`。
- 模型文本可以实时打印到终端。
- 每轮对话保存 user message 和 assistant message。
- 支持 `/exit` 退出。
- 支持 `/clear` 清空历史。
- 单元测试不依赖真实终端输入，也不访问真实 API。

暂不做的能力：

- 不执行工具调用。
- 不做 React/Ink UI。
- 不做消息持久化。
- 不做 history 压缩。
- 不做多会话管理。

## 从 learn 到 src 的设计映射

| `learn/step2.js` 中的能力    | 正式项目模块                         | 说明                         |
| ---------------------------- | ------------------------------------ | ---------------------------- |
| `runRepl()`                  | `src/cli/repl.ts`                    | REPL 主流程                  |
| `readline.createInterface()` | `src/cli/readline-prompt.ts`         | 终端输入读取适配器           |
| `/exit`、`/clear` 判断       | `src/cli/commands.ts`                | 命令解析                     |
| `messages = []`              | `src/chat/chat-session.ts`           | 内存对话历史                 |
| `streamMessage()` 调用       | `src/cli/repl.ts` 注入 `sendMessage` | 方便单元测试替换 fake stream |
| `process.stdout.write()`     | `src/cli/console-renderer.ts`        | 输出渲染适配器               |
| token 打印                   | `src/cli/repl.ts` 通过 renderer 输出 | 每轮结束后打印 usage         |

建议先做小模块，不要一次性引入 React/Ink。等 REPL 主流程稳定，再替换 UI 层。

## 推荐文件结构

```text
src/
  chat/
    chat-session.ts
  cli/
    commands.ts
    console-renderer.ts
    readline-prompt.ts
    repl.ts
    types.ts
  llm/
    stream-message.ts
    types.ts
  index.ts

test/
  chat/
    chat-session.test.ts
  cli/
    commands.test.ts
    repl.test.ts
```

如果想保持更轻量，也可以先只创建：

```text
src/
  cli/
    repl.ts
    commands.ts
```

等测试和行为稳定后再拆 renderer 和 input reader。

## 类型设计

### REPL 输入输出依赖

为了让 REPL 可测试，正式实现不要在 `runRepl()` 内部直接绑定真实 readline 和 stdout。建议定义接口：

```ts
export type InputReader = {
  question(label: string): Promise<string>
  close(): void
}

export type Renderer = {
  line(text?: string): void
  write(text: string): void
}
```

真实环境中：

- `InputReader` 由 Node readline 实现。
- `Renderer` 由 `console.log` / `process.stdout.write` 实现。

测试环境中：

- `InputReader` 用预设输入数组实现。
- `Renderer` 把输出收集到数组里断言。

### REPL 配置

```ts
import type { Model } from '@anthropic-ai/sdk/resources/messages'
import type { StreamMessageEvent, StreamMessageInput, StreamMessageResult } from '../llm/types.js'

type SendMessage = (
  input: StreamMessageInput
) => AsyncGenerator<StreamMessageEvent, StreamMessageResult>

export type ReplOptions = {
  model?: Model
  system?: string
  inputReader?: InputReader
  renderer?: Renderer
  sendMessage?: SendMessage
}
```

`sendMessage` 可注入，是为了测试时不用访问真实 API。

### 命令解析结果

```ts
export type ReplCommand =
  | { type: 'exit' }
  | { type: 'clear' }
  | { type: 'message'; text: string }
  | { type: 'empty' }
```

用一个函数集中解析：

```ts
export function parseReplInput(input: string): ReplCommand {
  const text = input.trim()

  if (!text) return { type: 'empty' }
  if (text === '/exit') return { type: 'exit' }
  if (text === '/clear') return { type: 'clear' }

  return { type: 'message', text }
}
```

这样主循环不会堆满字符串判断，命令也容易单测。

## 模块职责

### `src/chat/chat-session.ts`

只管理内存消息历史。

建议接口：

```ts
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import type { StreamMessageResult } from '../llm/types.js'

export class ChatSession {
  private readonly messages: MessageParam[] = []

  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content })
  }

  addAssistantMessage(result: StreamMessageResult): void {
    this.messages.push(result.assistantMessage)
  }

  clear(): void {
    this.messages.length = 0
  }

  getMessages(): MessageParam[] {
    return [...this.messages]
  }
}
```

注意：当前 `StreamMessageResult.assistantMessage` 的 content 类型是项目内部类型，和 Anthropic SDK 的 `MessageParam` 基本兼容。正式实现时如果 TypeScript 提示不兼容，需要增加一个 mapper，把内部 `assistantMessage` 转成 SDK `MessageParam`。

### `src/cli/commands.ts`

只做输入解析，不依赖 readline，不调用模型。

单元测试覆盖：

- 空字符串 -> `empty`
- 全空白 -> `empty`
- `/exit` -> `exit`
- `/clear` -> `clear`
- 普通文本 -> `message`

### `src/cli/readline-prompt.ts`

只负责把 Node readline 包装成 `InputReader`。

示例：

```ts
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { InputReader } from './types.js'

export function createReadlineInputReader(): InputReader {
  return readline.createInterface({ input, output })
}
```

### `src/cli/console-renderer.ts`

只负责输出。

```ts
import type { Renderer } from './types.js'

export const consoleRenderer: Renderer = {
  line(text = '') {
    console.log(text)
  },
  write(text) {
    process.stdout.write(text)
  }
}
```

### `src/cli/repl.ts`

负责主流程：

1. 创建或接收 `InputReader`。
2. 创建 `ChatSession`。
3. 打印欢迎信息。
4. 进入循环。
5. 解析命令。
6. 普通消息进入 `streamMessage()`。
7. 渲染 streaming events。
8. 保存最终 assistant message。
9. 打印 usage。
10. 退出时关闭 input reader。

伪代码：

```ts
export async function runRepl(options: ReplOptions = {}): Promise<void> {
  const inputReader = options.inputReader ?? createReadlineInputReader()
  const renderer = options.renderer ?? consoleRenderer
  const sendMessage = options.sendMessage ?? streamMessage
  const session = new ChatSession()

  renderer.line('Qing Agent REPL')
  renderer.line('Type /exit to quit, /clear to clear history.')

  try {
    while (true) {
      const command = parseReplInput(await inputReader.question('> '))

      if (command.type === 'empty') continue
      if (command.type === 'exit') break

      if (command.type === 'clear') {
        session.clear()
        renderer.line('(history cleared)')
        continue
      }

      session.addUserMessage(command.text)

      try {
        const result = await renderAssistantTurn({
          messages: session.getMessages(),
          sendMessage,
          renderer,
          ...(options.model !== undefined ? { model: options.model } : {}),
          ...(options.system !== undefined ? { system: options.system } : {})
        })

        session.addAssistantMessage(result)
        renderer.line(`(tokens in/out: ${result.usage.inputTokens}/${result.usage.outputTokens})`)
      } catch (error) {
        renderer.line()
        renderer.line(`[error] ${formatError(error)}`)
      }
    }
  } finally {
    inputReader.close()
  }
}
```

`renderAssistantTurn()` 可以从 `runRepl()` 中拆出来，便于单测。

## 为什么仍然要手动 `next()`

Step 2 需要拿到 `streamMessage()` 的最终 `return` 值，因为要保存：

```ts
session.addAssistantMessage(result)
```

所以不能只用：

```ts
for await (const event of stream) {
}
```

`for await...of` 拿不到 async generator 最后的 return value。

正式实现仍建议使用手动 `next()`：

```ts
const stream = sendMessage({ messages, model, system })

while (true) {
  const next = await stream.next()

  if (next.done) {
    return next.value
  }

  renderEvent(next.value)
}
```

这是 Step 2 的关键点。

实际实现中还要注意 `exactOptionalPropertyTypes`：如果 `model` 或 `system` 没有值，不要传 `model: undefined` 或 `system: undefined`，而是只在有值时展开字段。

## 错误处理设计

学习样例没有错误处理。正式实现至少要考虑：

- 模型请求失败：打印错误，但 REPL 不直接退出。
- stream 中途报错：保留当前历史，不追加 assistant message。
- 用户 `Ctrl+C`：关闭 readline。
- `inputReader.close()` 必须放在 `finally`。

建议主循环中每轮消息单独 try/catch：

```ts
try {
  const result = await renderAssistantTurn(...)
  session.addAssistantMessage(result)
} catch (error) {
  renderer.line()
  renderer.line(`[error] ${formatError(error)}`)
}
```

## 单元测试设计

### `commands.test.ts`

测试命令解析即可，不需要 mock 模型。

覆盖：

- `''`
- `'   '`
- `'/exit'`
- `'/clear'`
- `'hello'`

### `repl.test.ts`

不要使用真实 readline。

构造 fake input reader：

```ts
class FakeInputReader {
  constructor(private readonly inputs: string[]) {}

  async question() {
    const value = this.inputs.shift()
    if (value === undefined) return '/exit'
    return value
  }

  close() {}
}
```

构造 fake renderer：

```ts
const output: string[] = []
const renderer = {
  line(text = '') {
    output.push(text + '\n')
  },
  write(text) {
    output.push(text)
  }
}
```

构造 fake `sendMessage`：

```ts
async function* fakeSendMessage() {
  yield { type: 'text', text: 'hello' }
  yield {
    type: 'message_done',
    stopReason: 'end_turn',
    usage: { inputTokens: 1, outputTokens: 1 }
  }
  return {
    assistantMessage: {
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }]
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'end_turn'
  }
}
```

建议覆盖：

- 普通输入会调用 `sendMessage`。
- assistant 文本会写到 renderer。
- assistant message 会进入下一轮 history。
- `/clear` 会清空 history。
- `/exit` 会关闭 input reader。
- 模型错误会被打印，并且 REPL 继续下一轮。

## Smoke 测试设计

真实 REPL 需要人工输入，不适合自动 smoke 脚本。当前实现采用 npm script 手动验证：

```json
{
  "scripts": {
    "repl": "tsx src/index.ts"
  }
}
```

然后 `src/index.ts`：

```ts
import { runRepl } from './cli/repl.js'

await runRepl()
```

手动验证：

```powershell
npm run repl
```

验收流程：

1. 输入 `你好`，能看到 assistant 流式回复。
2. 继续输入 `刚才我问了什么？`，模型能利用上一轮历史。
3. 输入 `/clear`，显示 `(history cleared)`。
4. 再问 `刚才我问了什么？`，模型不应该知道清空前的问题。
5. 输入 `/exit`，进程正常退出。

## 开发顺序

建议按这个顺序实现：

1. `src/cli/commands.ts`：先实现 `parseReplInput()`。
2. `test/cli/commands.test.ts`：先把命令解析测稳。
3. `src/chat/chat-session.ts`：实现内存历史管理。
4. `test/chat/chat-session.test.ts`：验证历史追加、清空和数组拷贝。
5. `src/cli/types.ts`：定义 `InputReader` 和 `Renderer`。
6. `src/cli/console-renderer.ts`：实现终端输出适配器。
7. `src/cli/readline-prompt.ts`：实现 readline input reader 适配器。
8. `src/cli/repl.ts`：实现主循环。
9. `test/cli/repl.test.ts`：用 fake input reader、fake renderer、fake stream 测主流程。
10. `src/index.ts`：接入 `runRepl()`。
11. `package.json`：增加 `"repl": "tsx src/index.ts"`。
12. 手动运行 `npm run repl` 做真实 API 验证。

## 验收清单

实现完成后，至少通过：

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

手动验证：

```powershell
npm run repl
```

阶段完成标准：

- `learn/step2.js` 仍然只是学习参考。
- 正式 REPL 入口放在 `src/cli/repl.ts`。
- REPL 可以多轮对话。
- `/exit` 和 `/clear` 工作正常。
- 单元测试不依赖真实终端输入和真实 API。
- 后续 Step 3 可以在此基础上接入工具执行。
