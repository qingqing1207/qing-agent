# 00：解读 learn/step3.js 的工具接口和 Anthropic 工具调用规则

这份文档只解读 `learn/step3.js`。重点不是把 Read 工具写得多完整，而是理解一个 agent 项目里“工具”这一层应该由哪些部分组成，以及 Anthropic Messages API 中工具是如何定义、触发、执行和回传结果的。

`learn/step3.js` 还没有实现完整 agent loop。它只先完成三件事：

1. 定义项目内部的最小工具契约。
2. 实现第一个只读工具 `Read`。
3. 把内部工具定义转换成 Anthropic API 需要的 `tools` 参数。

## 1. Step 3 要解决什么问题

Step 1 已经能调用一次模型，并把 streaming 里的 `tool_use` block 解析出来。

Step 2 已经能在终端里持续对话，并维护 `messages` 历史。

Step 3 开始补 agent 的关键能力：让模型不仅能“说”，还能“请求调用本地工具”。

但要注意：模型不会直接执行本地函数。Anthropic 的工具调用流程是：

1. 客户端在请求里告诉模型有哪些工具，也就是传入 `tools`。
2. 模型根据用户问题决定是否返回 `tool_use` content block。
3. 客户端读取 `tool_use.name` 和 `tool_use.input`，在本地执行对应工具。
4. 客户端把执行结果包装成 `tool_result` block。
5. 客户端把 `tool_result` 作为下一条 `user` message 发回模型。
6. 模型基于工具结果继续回答，或者继续请求更多工具。

所以 Step 3 的核心不是“函数调用语法”，而是“模型输出工具请求，客户端负责执行和回传”的协议边界。

## 2. 文件顶部注释的定位

代码开头：

```js
/**
 * Step 3 - Tool interface + first Read tool
 *
 * Goal:
 * - define a tiny tool contract
 * - register tools in one place
 * - implement a readable file reader with line numbers
 */
```

这里有三个设计信号：

- `Tool interface`：项目内部要有自己的工具契约，不要让业务代码直接散落成一堆函数。
- `first Read tool`：先从只读工具开始，风险低，也最符合代码 agent 的第一步需求。
- `register tools in one place`：工具需要集中注册，方便传给模型，也方便根据 `tool_use.name` 找到本地实现。

这份学习代码没有做权限确认、schema 校验、真实 agent loop、并发工具执行、文件大小限制等工程化能力。正式项目里这些要补上。

## 3. Anthropic 的工具定义放在哪里

Anthropic Messages API 中，工具定义放在请求体顶层的 `tools` 数组里。

一个最小工具定义大致是：

```js
{
  name: 'Read',
  description: 'Read a file from the current workspace.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' }
    },
    required: ['file_path']
  }
}
```

注意几个规则：

- `name` 是模型之后在 `tool_use.name` 里返回的名字，必须能和本地工具注册表匹配。
- `description` 是给模型看的，不是给用户看的；它要说明工具做什么、何时使用、参数含义和限制。
- `input_schema` 使用 JSON Schema，描述模型应该生成什么形状的 `input`。
- `input_schema.type` 对普通自定义工具通常是 `'object'`。
- `required` 用来告诉模型哪些字段必须提供。
- Anthropic API 字段名是 `input_schema`，而 `learn/step3.js` 内部用的是 `inputSchema`。这个差异由 `getToolsApiParams()` 做映射。

`learn/step3.js` 的 `readTool.inputSchema` 是内部表示：

```js
inputSchema: {
  type: 'object',
  properties: {
    file_path: { type: 'string' },
    offset: { type: 'number' },
    limit: { type: 'number' }
  },
  required: ['file_path']
}
```

真正传给 Anthropic 时会变成：

```js
{
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema
}
```

这就是 `getToolsApiParams()` 的职责。

## 4. 为什么 API 参数里不包含 `call`

`readTool` 的完整对象是：

```js
export const readTool = {
  name: 'Read',
  description: '...',
  inputSchema: { ... },
  isReadOnly() { ... },
  isEnabled() { ... },
  async call(input, context) { ... }
}
```

但 Anthropic API 只需要知道：

```js
{
  name,
  description,
  input_schema
}
```

原因是模型只负责生成工具调用请求，不会拿到也不会执行本地的 `call()` 函数。

`call()`、`isReadOnly()`、`isEnabled()` 是项目内部运行时需要的字段：

- `call()`：真正执行工具。
- `isReadOnly()`：告诉项目这个工具是否只读，可用于权限策略和 UI 提示。
- `isEnabled()`：决定这个工具当前是否对模型开放。

所以工具对象天然有两层视角：

| 视角 | 需要的字段 | 使用者 |
| --- | --- | --- |
| API 视角 | `name`、`description`、`input_schema` | Anthropic 模型 |
| 本地运行时视角 | `inputSchema`、`call()`、`isReadOnly()`、`isEnabled()` | agent 程序 |

## 5. Anthropic 如何返回工具调用

当请求里带了 `tools` 后，模型如果决定调用工具，assistant message 的 `content` 里会出现 `tool_use` block：

```js
{
  role: 'assistant',
  content: [
    {
      type: 'tool_use',
      id: 'toolu_01...',
      name: 'Read',
      input: {
        file_path: 'src/index.ts',
        offset: 1,
        limit: 80
      }
    }
  ]
}
```

关键字段：

- `id`：本次工具调用的唯一标识。回传结果时必须放进 `tool_result.tool_use_id`。
- `name`：工具名，用它在本地注册表里找到对应工具。
- `input`：模型根据 `input_schema` 生成的参数对象。

如果是 streaming，`tool_use` 的 `input` 不是一开始完整到达的。Step 1 的 `stream-message.ts` 已经处理了这个细节：

1. `content_block_start` 中可以拿到 `tool_use.id` 和 `tool_use.name`。
2. `content_block_delta` 中的 `input_json_delta.partial_json` 会分片到达。
3. `content_block_stop` 时再把累积的 JSON 字符串 `JSON.parse()` 成最终 `input`。

这也是为什么 `learn/step3.js` 只需要定义工具，不需要再解析流事件。

## 6. Anthropic 如何接收工具结果

工具执行完成后，客户端不能直接把字符串追加成普通用户文本。必须构造 `tool_result` content block：

```js
{
  role: 'user',
  content: [
    {
      type: 'tool_result',
      tool_use_id: 'toolu_01...',
      content: 'File: src/index.ts\nLines: 1-20 / 120\n...'
    }
  ]
}
```

如果工具执行失败，也仍然要回传 `tool_result`，并标记错误：

```js
{
  type: 'tool_result',
  tool_use_id: 'toolu_01...',
  content: 'Error reading file: file not found',
  is_error: true
}
```

几个重要规则：

- `tool_result` 是下一条 `user` message 的 content block，不是新的 `tool` role。
- `tool_result.tool_use_id` 必须对应前一个 assistant message 里的 `tool_use.id`。
- 回传工具结果前，要把包含 `tool_use` 的 assistant message 也保存在历史里。
- 如果同一轮 assistant message 里有多个 `tool_use`，通常应该把多个 `tool_result` 放在同一条紧随其后的 `user` message 中。
- `tool_result` 应该先于任何新的普通用户文本出现，否则模型会丢失工具调用和结果之间的对应关系。

`learn/step3.js` 还没有写这部分逻辑。它只先提供本地工具和注册表，给后续 agent loop 使用。

## 7. `resolveWorkspacePath()`：工具安全边界

代码：

```js
export function resolveWorkspacePath(filePath, cwd) {
  const resolved = path.resolve(cwd, filePath)
  const relative = path.relative(cwd, resolved)

  // Prevent the model from escaping the workspace root.
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside the workspace: ' + filePath)
  }

  return resolved
}
```

这个函数解决的是路径逃逸问题。

模型可能请求：

```text
../../.ssh/id_rsa
/etc/passwd
```

如果工具直接 `fs.readFile(filePath)`，就可能读到工作区外的文件。

这里的防护逻辑是：

1. 用 `path.resolve(cwd, filePath)` 得到绝对路径。
2. 用 `path.relative(cwd, resolved)` 看这个绝对路径相对工作区的位置。
3. 如果相对路径以 `..` 开头，说明它在工作区外。
4. 如果 `relative` 本身是绝对路径，也视为越界。

这是最小安全边界。正式项目里建议进一步用 `fs.realpath()` 防止符号链接逃逸。

## 8. `addLineNumbers()`：让文件内容更适合模型阅读

代码：

```js
export function addLineNumbers(text, startLine = 1) {
  const lines = text.split(/\r?\n/)
  const width = String(startLine + lines.length - 1).length

  return lines
    .map((line, index) => String(startLine + index).padStart(width, ' ') + '\t' + line)
    .join('\n')
}
```

这个函数把文件内容变成：

```text
 8	import { runRepl } from './cli/repl.js'
 9	
10	await runRepl()
```

行号对代码 agent 很重要：

- 模型可以精确引用某一行。
- 后续写编辑工具时，可以用行号定位。
- CLI 输出也更容易让用户检查。

`width` 的作用是让行号右对齐。比如第 9 行和第 10 行宽度不同，如果不 `padStart()`，视觉上会错位。

## 9. `readTool` 的内部契约

`readTool` 是 Step 3 的第一个工具：

```js
export const readTool = {
  name: 'Read',
  description:
    'Read a file from the current workspace. Supports partial reads with offset and limit.',
  inputSchema: { ... },
  isReadOnly() {
    return true
  },
  isEnabled() {
    return true
  },
  async call(input, context) { ... }
}
```

### `name`

工具名是 `Read`。

这个名字会出现在两个地方：

- 请求参数 `tools[].name`
- 模型返回的 `tool_use.name`

所以本地查找工具时必须用同一个名字：

```js
findToolByName('Read')
```

### `description`

描述告诉模型这个工具适合做什么。

当前描述能说明基本用途，但正式项目里可以更具体，比如：

- 只能读取当前 workspace 内的文本文件。
- `file_path` 应该是相对路径。
- 如果只需要片段，优先使用 `offset` 和 `limit`。
- 不适合读取超大文件或二进制文件。

模型越清楚工具边界，生成的 `input` 越稳定。

### `inputSchema`

当前 schema：

```js
{
  type: 'object',
  properties: {
    file_path: { type: 'string' },
    offset: { type: 'number' },
    limit: { type: 'number' }
  },
  required: ['file_path']
}
```

它告诉模型：

- 必须传 `file_path`。
- 可以传 `offset`。
- 可以传 `limit`。

正式项目里建议把 `offset` 和 `limit` 改成 `integer`，并加上 `minimum`、`maximum` 和字段描述。模型看到更精确的 schema，工具调用质量会更好。

## 10. `readTool.call()` 的执行流程

核心代码：

```js
async call(input, context) {
  const filePath = input.file_path
  const offset = input.offset || 1
  const limit = input.limit

  if (!filePath) {
    return { content: 'Error: file_path is required', isError: true }
  }

  try {
    const resolvedPath = resolveWorkspacePath(filePath, context.cwd)
    const raw = await fs.readFile(resolvedPath, 'utf8')
    const allLines = raw.split(/\r?\n/)

    const startIndex = Math.max(0, offset - 1)
    const endIndex = typeof limit === 'number' ? startIndex + limit : allLines.length
    const selected = allLines.slice(startIndex, endIndex)

    return {
      content: [
        'File: ' + resolvedPath,
        'Lines: ' +
          (startIndex + 1) +
          '-' +
          (startIndex + selected.length) +
          ' / ' +
          allLines.length,
        addLineNumbers(selected.join('\n'), startIndex + 1)
      ].join('\n')
    }
  } catch (error) {
    return { content: 'Error reading file: ' + error.message, isError: true }
  }
}
```

执行流程可以拆成：

1. 从模型 input 里取 `file_path`、`offset`、`limit`。
2. 如果缺少 `file_path`，返回错误工具结果。
3. 解析并校验路径不能逃出 workspace。
4. 读取文件内容。
5. 按行切分。
6. 根据 `offset` 和 `limit` 选择片段。
7. 添加文件路径、行号范围和带行号的内容。
8. 如果异常，返回 `{ content, isError: true }`。

这里没有直接 `throw` 给上层，而是把错误包装成工具结果。这样 agent loop 可以把错误返回给模型，让模型自己决定下一步，比如换路径、调整参数或向用户解释。

## 11. `allTools`、`findToolByName()` 和 `getToolsApiParams()`

代码：

```js
export const allTools = [readTool]

export function findToolByName(name) {
  return allTools.find((tool) => tool.name === name)
}

export function getToolsApiParams() {
  return allTools
    .filter((tool) => tool.isEnabled())
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }))
}
```

这三个导出分别服务于不同阶段：

- `allTools`：集中注册工具。
- `findToolByName()`：模型返回 `tool_use.name` 后，用它找到本地实现。
- `getToolsApiParams()`：发请求前，把启用的工具转换成 Anthropic API 参数。

对应完整调用链：

```text
allTools
  |
  | getToolsApiParams()
  v
client.messages.stream({ messages, tools })
  |
  | 模型返回 tool_use: { id, name, input }
  v
findToolByName(name)
  |
  | tool.call(input, { cwd })
  v
{ type: 'tool_result', tool_use_id: id, content, is_error? }
  |
  | 追加到 messages 后再次调用模型
  v
assistant 最终回答
```

## 12. 这个学习版本的边界

`learn/step3.js` 有意保持很小，所以它有几个明显边界：

- 没有执行 agent loop。
- 没有把 `tool_result` 回传给模型。
- 没有用 TypeScript 类型约束工具契约。
- 没有用 Zod 或 JSON Schema validator 校验模型传入的 input。
- `offset` 和 `limit` 没有限制整数、最小值、最大值。
- 没有限制读取文件大小。
- 没有处理二进制文件。
- 路径防护没有处理符号链接逃逸。
- 错误字段用的是内部 `isError`，回传 Anthropic 时还要映射成 `is_error`。

这些不是学习代码的失败，而是它的边界。Step 3 在正式项目里的设计目标，就是保留这条简单链路，同时补上类型、校验、测试和 agent loop。

## 13. 参考资料

- Anthropic Tool use overview: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Anthropic define tools: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- Anthropic handle tool calls: https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
- Anthropic streaming messages: https://platform.claude.com/docs/en/api/streaming
