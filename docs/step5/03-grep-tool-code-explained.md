# Step 5：Grep 工具代码解释

本文用于解释 Step 5 正式项目中 `Grep` 工具的代码：

```text
src/tools/grep/index.ts
```

`Grep` 工具的重点是：

```text
1. 接收模型传来的 regex 查询参数。
2. 校验输入。
3. 把搜索路径限制在 workspace 内。
4. 使用 @vscode/ripgrep 提供的 rg binary 搜索文件内容。
5. 使用 execa 从 Node.js 里执行 rg。
6. 解析 rg 的退出码和输出。
7. 把结果转换成 ToolCallResult。
```

## Grep 工具目标

`Grep` 的作用是：

```text
在 workspace 内搜索文件内容。
```

示例输入：

```ts
await grepTool.call(
  {
    pattern: 'runAgentTurn',
    path: 'src',
    limit: 20
  },
  {
    cwd: '/Users/me/code/qing-agent'
  }
)
```

可能输出：

```text
src/cli/repl.ts:2:import { runAgentTurn } from '../agent/agent-loop.js'
src/agent/agent-loop.ts:49:export async function* runAgentTurn(
```

输出格式来自 ripgrep：

```text
path:lineNumber:lineContent
```

## 文件结构

当前 `Grep` 工具在：

```text
src/tools/grep/index.ts
```

测试在：

```text
test/tools/grep/index.test.ts
```

相关共享路径函数在：

```text
src/tools/workspace-path.ts
```

## 导入模块

`src/tools/grep/index.ts` 开头：

```ts
import path from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { execa } from 'execa'
import { z } from 'zod'
import { resolveExistingWorkspacePath } from '../workspace-path.js'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'
```

## `@vscode/ripgrep`

`@vscode/ripgrep` 的作用是：

```text
把 ripgrep 的 rg 可执行文件作为 npm 依赖带进项目。
```

使用方式：

```ts
import { rgPath } from '@vscode/ripgrep'
```

`rgPath` 是当前平台下 `rg` binary 的路径。

示例：

```text
node_modules/@vscode/ripgrep/bin/rg
```

Windows 上会指向：

```text
node_modules/@vscode/ripgrep/bin/rg.exe
```

这样项目不依赖用户机器提前安装 `rg`。

`Grep` 需要搜索文件内容，ripgrep 是成熟的内容搜索工具，所以这里直接复用它的能力。

## `execa`

`execa` 的作用是：

```text
从 Node.js 里执行子进程，并拿到结构化结果。
```

当前工具用它执行 `rg`：

```ts
const result = await execa(rgPath, args, {
  cwd: workspaceRoot,
  reject: false,
  timeout: RIPGREP_TIMEOUT_MS
})
```

相比直接使用 Node.js 原生 `child_process`，`execa` 更适合这里：

```text
Promise API，方便 async/await。
自动收集 stdout / stderr。
返回 exitCode。
支持 timeout。
参数以数组传入，不需要 shell 字符串拼接。
```

这里没有使用 shell：

```ts
execa(rgPath, args)
```

而不是：

```ts
execaCommand(`rg ${pattern}`)
```

这样可以避免 shell 拼接带来的额外转义和注入问题。

## 常量

```ts
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const MAX_OUTPUT_CHARS = 20_000
const RIPGREP_TIMEOUT_MS = 10_000
```

含义：

```text
DEFAULT_LIMIT
  默认最多返回 100 行匹配。

MAX_LIMIT
  用户最多请求 500 行匹配。

MAX_OUTPUT_CHARS
  最终输出最多保留 20000 个字符。

RIPGREP_TIMEOUT_MS
  rg 最多运行 10 秒。
```

`limit` 控制匹配行数。

`MAX_OUTPUT_CHARS` 控制最终文本体积，避免单行特别长时把上下文撑爆。

`timeout` 控制子进程运行时间，避免搜索卡住。

## 工具 Schema

`grepToolInputSchema` 是给模型看的工具参数说明：

```ts
export const grepToolInputSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'Regex pattern to search for.'
    },
    path: {
      type: 'string',
      description: 'Workspace-relative path to search.'
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_LIMIT,
      description: 'Maximum number of matching lines to return.'
    }
  },
  required: ['pattern'],
  additionalProperties: false
} satisfies ToolInputSchema
```

字段含义：

```text
pattern
  必填。ripgrep regex pattern，例如 runAgentTurn。

path
  可选。workspace-relative 搜索路径，可以是目录，也可以是文件。

limit
  可选。最多返回多少行匹配。
```

## Zod 输入校验

本地运行时校验：

```ts
const grepInputValidator = z
  .object({
    pattern: z.string().min(1),
    path: z.string().min(1).optional().default('.'),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional().default(DEFAULT_LIMIT)
  })
  .strict()
```

规则：

```text
pattern
  必须是非空字符串。

path
  必须是非空字符串；不传时默认为 '.'。

limit
  必须是 1 到 500 之间的整数；不传时默认为 100。
```

`.strict()` 表示不允许额外字段。

如果模型传入：

```ts
{ pattern: '' }
```

工具返回：

```ts
{
  content: 'Error: invalid Grep input: ...',
  isError: true
}
```

不会启动 `rg`。

## 工具对象

`grepTool` 实现统一的 `AgentTool` 契约：

```ts
export const grepTool: AgentTool = {
  name: 'Grep',
  description: 'Search file contents in the current workspace using a regex pattern.',
  inputSchema: grepToolInputSchema,

  isReadOnly() {
    return true
  },

  isEnabled() {
    return true
  },

  async call(input: JsonObject, context): Promise<ToolCallResult> {
    // ...
  }
}
```

### `name`

```ts
name: 'Grep'
```

模型发起工具调用时使用这个名字：

```json
{
  "type": "tool_use",
  "name": "Grep",
  "input": {
    "pattern": "runAgentTurn",
    "path": "src",
    "limit": 20
  }
}
```

### `description`

```ts
description: 'Search file contents in the current workspace using a regex pattern.'
```

这是给模型看的说明。

它要表达：

```text
搜索文件内容
当前 workspace
使用 regex pattern
```

### `isReadOnly()`

```ts
isReadOnly() {
  return true
}
```

`Grep` 只读取文件内容，不修改文件。

### `isEnabled()`

```ts
isEnabled() {
  return true
}
```

当前默认启用。

以后如果要按配置关闭工具，可以在这里读取上下文或环境变量。

## `call()` 执行流程

核心逻辑：

```ts
async call(input: JsonObject, context): Promise<ToolCallResult> {
  const parsed = grepInputValidator.safeParse(input)

  if (!parsed.success) {
    return errorResult(`Error: invalid Grep input: ${formatZodError(parsed.error)}`)
  }

  try {
    const workspaceRoot = await resolveExistingWorkspacePath('.', context.cwd)
    const searchTarget = await resolveExistingWorkspacePath(parsed.data.path, context.cwd)
    const matches = await findMatchingLines(
      parsed.data.pattern,
      searchTarget,
      workspaceRoot,
      parsed.data.limit
    )

    if (matches.length === 0) {
      return { content: 'No matches found' }
    }

    return { content: formatMatches(matches) }
  } catch (error) {
    return errorResult(`Error running Grep: ${formatError(error)}`)
  }
}
```

执行步骤：

```text
1. 用 Zod 校验 input。
2. 校验失败时返回 isError。
3. 解析 workspaceRoot。
4. 解析 searchTarget，并确认没有逃出 workspace。
5. 调用 findMatchingLines() 执行 rg。
6. 没有匹配时返回 No matches found。
7. 有匹配时格式化输出。
8. 捕获异常并转换成 ToolCallResult 错误。
```

## 路径安全

```ts
const workspaceRoot = await resolveExistingWorkspacePath('.', context.cwd)
const searchTarget = await resolveExistingWorkspacePath(parsed.data.path, context.cwd)
```

这里解析两个路径。

`workspaceRoot` 用作 `execa` 的 `cwd`。

`searchTarget` 是用户希望搜索的目录或文件。

如果模型传入：

```json
{
  "pattern": "secret",
  "path": "../outside"
}
```

`resolveExistingWorkspacePath()` 会拒绝它。

## 执行 ripgrep

执行函数：

```ts
async function findMatchingLines(
  pattern: string,
  searchTarget: string,
  workspaceRoot: string,
  limit: number
): Promise<string[]> {
  const result = await execa(rgPath, createRipgrepArgs(pattern, searchTarget, workspaceRoot, limit), {
    cwd: workspaceRoot,
    reject: false,
    timeout: RIPGREP_TIMEOUT_MS
  })

  if (result.exitCode === 1) {
    return []
  }

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `ripgrep exited with code ${result.exitCode}`)
  }

  return result.stdout.split(/\r?\n/).filter(Boolean).slice(0, limit)
}
```

### `cwd`

```ts
cwd: workspaceRoot
```

让 `rg` 在 workspace 根目录下运行。

这样输出路径会相对于 workspace，而不是本机绝对路径。

示例输出：

```text
src/agent/agent-loop.ts:49:export async function* runAgentTurn(
```

### `reject: false`

默认情况下，`execa` 遇到非 0 退出码会 throw。

但 `rg` 的退出码有业务含义：

```text
0
  找到匹配。

1
  没有匹配。

其他
  执行错误，例如 regex 语法错误。
```

所以这里设置：

```ts
reject: false
```

让代码自己判断 `exitCode`。

### `timeout`

```ts
timeout: RIPGREP_TIMEOUT_MS
```

限制搜索时间。

当前值：

```text
10000 ms
```

也就是 10 秒。

## ripgrep 参数

参数由 `createRipgrepArgs()` 生成：

```ts
function createRipgrepArgs(
  pattern: string,
  searchTarget: string,
  workspaceRoot: string,
  limit: number
): string[] {
  return [
    '--line-number',
    '--no-heading',
    '--color=never',
    '--glob',
    '!.git/**',
    '--glob',
    '!node_modules/**',
    '--glob',
    '!dist/**',
    '--max-count',
    String(limit),
    '--regexp',
    pattern,
    toRipgrepTarget(searchTarget, workspaceRoot)
  ]
}
```

### `--line-number`

输出匹配行号。

示例：

```text
src/cli/repl.ts:2:import { runAgentTurn } from '../agent/agent-loop.js'
```

中间的 `2` 就是行号。

### `--no-heading`

禁用按文件分组的标题输出。

这样每条匹配都是一行：

```text
path:line:content
```

更适合模型消费和测试断言。

### `--color=never`

禁用终端颜色。

否则输出里可能包含 ANSI 控制字符。

### `--glob !...`

排除常见目录：

```text
.git
node_modules
dist
```

这些目录通常不应该进入普通代码搜索结果。

### `--max-count`

```ts
'--max-count', String(limit)
```

限制每个文件最多返回多少条匹配。

代码后面还会执行：

```ts
.slice(0, limit)
```

确保最终总行数也不会超过 `limit`。

### `--regexp`

```ts
'--regexp', pattern
```

把模型传来的 `pattern` 作为 ripgrep regex。

使用 `--regexp` 可以避免 pattern 以 `-` 开头时被误认为命令行参数。

### 搜索目标

```ts
toRipgrepTarget(searchTarget, workspaceRoot)
```

实现：

```ts
function toRipgrepTarget(searchTarget: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, searchTarget) || '.'
}
```

如果搜索目标是 workspace 根目录，返回：

```text
.
```

如果搜索目标是：

```text
/Users/me/code/qing-agent/src
```

返回：

```text
src
```

这样传给 `rg` 的仍然是 workspace-relative 路径。

## 输出限制

`findMatchingLines()` 会先按行拆分：

```ts
return result.stdout.split(/\r?\n/).filter(Boolean).slice(0, limit)
```

作用：

```text
按换行拆成数组。
过滤空行。
截断到最多 limit 行。
```

然后 `formatMatches()` 控制最终字符数：

```ts
function formatMatches(matches: string[]): string {
  const content = matches.join('\n')

  if (content.length <= MAX_OUTPUT_CHARS) {
    return content
  }

  return `${content.slice(0, MAX_OUTPUT_CHARS).trimEnd()}\n[truncated]`
}
```

如果输出超过 `MAX_OUTPUT_CHARS`，会截断并追加：

```text
[truncated]
```

## 返回值

工具统一返回：

```ts
type ToolCallResult = {
  content: string
  isError?: boolean
}
```

### 找到匹配

```ts
return { content: formatMatches(matches) }
```

示例：

```text
src/agent/agent-loop.ts:49:export async function* runAgentTurn(
```

### 没有匹配

```ts
return { content: 'No matches found' }
```

这不是工具错误。

它表示搜索正常完成，但没有找到匹配内容。

### 输入错误或执行错误

```ts
return errorResult(`Error running Grep: ${formatError(error)}`)
```

返回：

```ts
{
  content: 'Error running Grep: ...',
  isError: true
}
```

常见错误包括：

```text
无效 regex pattern
搜索路径逃出 workspace
rg 执行超时
rg binary 执行失败
```

## 一次完整调用示例

假设 workspace：

```text
workspace/
  README.md
  src/
    agent/
      agent-loop.ts
    cli/
      repl.ts
```

调用：

```ts
const result = await grepTool.call(
  { pattern: 'runAgentTurn', path: 'src', limit: 20 },
  { cwd: workspaceRoot }
)
```

执行过程：

```text
1. 校验 pattern/path/limit。
2. 把 path: 'src' 解析成 workspace 内真实路径。
3. 使用 @vscode/ripgrep 提供的 rgPath。
4. 使用 execa 执行 rg。
5. rg 搜索 src 下文件内容。
6. 输出 path:line:content。
7. 没有匹配时按 exitCode 1 返回 No matches found。
8. 有匹配时返回匹配行文本。
```

返回示例：

```ts
{
  content:
    "src/cli/repl.ts:2:import { runAgentTurn } from '../agent/agent-loop.js'\n" +
    'src/agent/agent-loop.ts:49:export async function* runAgentTurn('
}
```

## 测试覆盖

`test/tools/grep/index.test.ts` 覆盖：

```text
找到匹配行
path 省略时默认使用 workspace root
默认排除 node_modules
limit 限制返回行数
没有匹配时返回 No matches found
无效 input 返回 isError
无效 regex pattern 返回 isError
workspace 外路径被拒绝
```

测试使用临时目录创建隔离 workspace。

主要 fixture：

```text
workspace/
  README.md
  src/
    agent/
      agent-loop.ts
    cli/
      repl.ts
  node_modules/
    pkg/
      index.ts
outside/
  secret.ts
```

这样可以验证：

```text
pattern: runAgentTurn, path: src
  找到 src 下匹配行。

path 省略
  从 workspace root 搜索。

node_modules
  默认被排除。

path: ../outside
  被 workspace 路径安全逻辑拒绝。
```

## 与 Agent Loop 的关系

`Grep` 工具只负责本地执行。

它不关心：

```text
模型怎么选择工具
tool_use block 怎么解析
tool_result 怎么回传模型
REPL 怎么显示工具结果
```

这些由 agent 层负责：

```text
src/agent/agent-loop.ts
src/agent/tool-results.ts
src/cli/repl.ts
```

`Grep` 只要遵守 `AgentTool` 契约，并注册到：

```text
src/tools/registry.ts
```

模型就能在正常对话里调用它。
