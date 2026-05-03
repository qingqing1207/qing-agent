# Step 5：Bash 工具代码解释

本文用于解释 Step 5 正式项目中 `Bash` 工具的代码：

```text
src/tools/bash/index.ts
```

`Bash` 工具的重点是：

```text
1. 接收模型传来的 shell 命令。
2. 校验输入。
3. 使用独立环境变量默认禁用。
4. 把命令工作目录限制在 workspace 根目录。
5. 使用 execa 执行命令，不手写子进程管理。
6. 限制命令超时时间。
7. 限制输出长度。
8. 只透传白名单环境变量。
9. 把命令结果转换成 ToolCallResult。
```

## Bash 工具目标

`Bash` 的作用是：

```text
在 workspace 根目录执行 shell 命令。
```

典型用途：

```text
运行测试
运行 typecheck
运行 lint
查看 git 状态
查看文件列表
执行项目脚本
```

示例输入：

```ts
await bashTool.call(
  {
    command: 'npm test -- test/tools/bash/index.test.ts'
  },
  {
    cwd: '/Users/me/code/qing-agent'
  }
)
```

可能输出：

```text
Exit code: 0

> qing-agent@1.0.0 test
> vitest run test/tools/bash/index.test.ts

...
```

## 风险级别

`Bash` 是当前工具里风险最高的一个。

它可以：

```text
读取文件
写入文件
删除文件
修改 git 状态
启动子进程
访问网络
读取环境变量
输出大量内容
长时间运行
```

所以它和 `Edit` / `Write` 不共用同一个开关。

`Edit` / `Write` 使用：

```env
QING_ENABLE_WRITE_TOOLS=1
```

`Bash` 单独使用：

```env
QING_ENABLE_BASH_TOOL=1
```

这样可以做到：

```text
允许模型改文件
  但不允许模型执行任意命令。

允许模型执行命令
  需要额外显式开启。
```

当前实现仍然不是完整安全沙箱。

它只是做了几个基础限制：

```text
默认禁用
workspace 工作目录限制
命令超时
输出长度限制
环境变量白名单
```

后续如果要给真实用户长期开放，还需要继续设计：

```text
用户确认 UI
危险命令提示
命令 allowlist / denylist
更强的环境隔离
进程树清理
权限分级
```

## 默认禁用

`Bash` 默认不暴露给模型：

```ts
isEnabled() {
  return process.env.QING_ENABLE_BASH_TOOL === '1'
}
```

`.env.example` 中默认是：

```env
QING_ENABLE_BASH_TOOL=0
```

只有显式设置：

```env
QING_ENABLE_BASH_TOOL=1
```

`Bash` 才会出现在 Anthropic tools 参数里。

注意：

```text
isEnabled()
  控制模型是否能看到这个工具。

bashTool.call()
  仍然可以在单元测试或直接调用中执行。
```

所以：

```text
REPL 真实调用
  需要 QING_ENABLE_BASH_TOOL=1。

单元测试
  可以直接调用 bashTool.call()。
```

## 文件结构

当前 `Bash` 工具在：

```text
src/tools/bash/index.ts
```

测试在：

```text
test/tools/bash/index.test.ts
```

注册入口在：

```text
src/tools/registry.ts
```

环境变量示例在：

```text
.env.example
```

## 导入模块

`src/tools/bash/index.ts` 开头：

```ts
import fs from 'node:fs/promises'
import { execaCommand } from 'execa'
import { z } from 'zod'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'
```

### `fs`

`fs` 用于确认 `context.cwd` 指向一个真实存在的 workspace 目录：

```ts
const workspaceRoot = await fs.realpath(cwd)
const stat = await fs.stat(workspaceRoot)
```

这里不是为了读取业务文件，而是做两件事：

```text
1. 把 context.cwd 转成 canonical path。
2. 确认它是一个目录。
```

`context.cwd` 已经是工具调用时传入的 workspace 根目录。

`Bash` 没有接收模型传来的 `file_path`，所以这里不需要像 `Read` / `Write` 那样解析用户输入路径。

### `execa`

`execa` 是当前 Bash 工具的核心依赖。

项目没有直接使用 Node.js 原生：

```ts
child_process.spawn()
```

而是使用：

```ts
import { execaCommand } from 'execa'
```

原因是 `execa` 已经封装了很多子进程细节：

```text
Promise API
stdout / stderr 收集
合并 stdout 和 stderr
exitCode 结构化返回
timeout
maxBuffer
reject: false
跨平台 shell 选项
```

这符合项目基调：

```text
底层通用能力优先使用成熟 npm 包。
项目内只保留 AgentTool 契约、参数校验、权限策略和结果格式化。
```

### `zod`

`zod` 用于运行时输入校验。

模型传来的工具参数不可信，执行命令前必须再次校验。

## resolveWorkspaceRoot

`Bash` 使用 `resolveWorkspaceRoot()` 把 `context.cwd` 规范化成真实 workspace 根目录：

```ts
async function resolveWorkspaceRoot(cwd: string): Promise<string> {
  const workspaceRoot = await fs.realpath(cwd)
  const stat = await fs.stat(workspaceRoot)

  if (!stat.isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${cwd}`)
  }

  return workspaceRoot
}
```

这段逻辑很直接：

```text
context.cwd
  agent loop 传进来的 workspace 根目录。

fs.realpath(cwd)
  转成真实路径，处理符号链接和 macOS /var -> /private/var 这种路径别名。

fs.stat(workspaceRoot)
  确认这个路径存在。

stat.isDirectory()
  确认它是目录，不是文件。
```

最终 Bash 命令会在这个目录执行。

这里没有使用 `resolveExistingWorkspacePath()` 或 `resolveNewWorkspacePath()`。

原因是：

```text
Read / Edit / Grep / Glob / Write
  都会接收模型传来的路径参数。
  所以必须校验模型传来的路径是否逃出 workspace。

Bash
  当前只接收 command。
  不接收 file_path。
  工作目录直接来自 context.cwd。
```

所以 Bash 只需要确认 `context.cwd` 本身可用。

## 常量

```ts
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 20_000
```

含义：

```text
DEFAULT_TIMEOUT_MS
  默认超时时间 10 秒。

MAX_TIMEOUT_MS
  模型最多只能请求 30 秒。

MAX_OUTPUT_CHARS
  最终返回给模型的输出最多 20000 个字符。
```

这些限制分别控制：

```text
命令不能无限运行。
模型不能请求特别长的执行时间。
工具结果不能无限占用上下文。
```

## 环境变量白名单

代码中定义了：

```ts
const SAFE_ENV_NAMES = [
  'CI',
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'PWD',
  'SHELL',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERNAME',
  'WINDIR'
]
```

`Bash` 不会默认继承整个 `process.env`。

原因是项目 `.env` 里可能有：

```text
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_BASE_URL
ANTHROPIC_MODEL
```

如果把完整环境变量传给 shell，模型可以执行：

```bash
env
```

然后看到敏感 token。

当前实现只透传少量运行命令常用的环境变量：

```text
PATH
HOME
SHELL
TMPDIR
LANG
...
```

创建安全环境变量的函数是：

```ts
function createSafeEnv(workspaceRoot: string): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {}

  for (const name of SAFE_ENV_NAMES) {
    const value = process.env[name]

    if (value !== undefined) {
      safeEnv[name] = value
    }
  }

  safeEnv.PWD = workspaceRoot

  return safeEnv
}
```

重点是：

```ts
extendEnv: false
```

这表示不要把父进程的完整环境变量自动合并进去。

最终命令只会拿到：

```ts
env: createSafeEnv(workspaceRoot)
```

## 工具 Schema

`bashToolInputSchema` 是给模型看的工具参数说明：

```ts
export const bashToolInputSchema = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'Shell command to execute in the current workspace.'
    },
    timeout_ms: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_TIMEOUT_MS,
      description: 'Maximum command runtime in milliseconds.'
    }
  },
  required: ['command'],
  additionalProperties: false
} satisfies ToolInputSchema
```

字段含义：

```text
command
  必填。要执行的 shell 命令。

timeout_ms
  可选。命令最大运行时间，单位毫秒。
  最大不能超过 30000。
```

例如：

```json
{
  "command": "npm test -- test/tools/bash/index.test.ts",
  "timeout_ms": 30000
}
```

## Zod 输入校验

Schema 是给模型看的。

真正执行工具前，还要用 `zod` 再校验一次：

```ts
const bashInputValidator = z
  .object({
    command: z.string().min(1),
    timeout_ms: z.number().int().min(1).max(MAX_TIMEOUT_MS).optional().default(DEFAULT_TIMEOUT_MS)
  })
  .strict()
```

规则：

```text
command
  必须是非空字符串。

timeout_ms
  必须是整数。
  最小 1。
  最大 MAX_TIMEOUT_MS，也就是 30000。
  不传时默认 DEFAULT_TIMEOUT_MS，也就是 10000。

strict()
  不允许额外字段。
```

如果校验失败：

```ts
return errorResult(`Error: invalid Bash input: ${formatZodError(parsed.error)}`)
```

返回：

```ts
{
  content: 'Error: invalid Bash input: ...',
  isError: true
}
```

## AgentTool 定义

`bashTool` 实现了统一的 `AgentTool` 契约：

```ts
export const bashTool: AgentTool = {
  name: 'Bash',
  description:
    'Execute a shell command in the current workspace. Use for tests, builds, and inspection commands.',
  inputSchema: bashToolInputSchema,

  isReadOnly() {
    return false
  },

  isEnabled() {
    return process.env.QING_ENABLE_BASH_TOOL === '1'
  },

  async call(input: JsonObject, context): Promise<ToolCallResult> {
    // ...
  }
}
```

重点是：

```text
isReadOnly()
  返回 false。
  因为 shell 命令可能修改文件、删除文件、访问网络。

isEnabled()
  使用 QING_ENABLE_BASH_TOOL 单独控制是否暴露给模型。
```

## call 执行流程

`call()` 的主流程是：

```text
1. 使用 zod 校验 input。
2. 解析 workspaceRoot。
3. 使用 execaCommand 执行命令。
4. 如果命令超时，返回 isError。
5. 如果命令正常结束，返回 exit code 和输出。
6. 如果 execa 本身抛错，转换成 isError。
```

对应代码：

```ts
const parsed = bashInputValidator.safeParse(input)

if (!parsed.success) {
  return errorResult(`Error: invalid Bash input: ${formatZodError(parsed.error)}`)
}
```

然后解析 workspace：

```ts
const workspaceRoot = await resolveWorkspaceRoot(context.cwd)
```

再执行命令：

```ts
const result = await execaCommand(parsed.data.command, {
  cwd: workspaceRoot,
  env: createSafeEnv(workspaceRoot),
  extendEnv: false,
  shell: true,
  reject: false,
  all: true,
  timeout: parsed.data.timeout_ms,
  maxBuffer: MAX_OUTPUT_CHARS * 4
})
```

## execaCommand 配置逐项解释

### `cwd`

```ts
cwd: workspaceRoot
```

命令在 workspace 根目录执行。

例如模型传：

```bash
pwd && ls
```

输出里的 `pwd` 应该是项目根目录。

### `env`

```ts
env: createSafeEnv(workspaceRoot)
```

只给命令传安全白名单环境变量。

### `extendEnv`

```ts
extendEnv: false
```

不继承完整父进程环境变量。

这是环境变量安全的关键。

### `shell`

```ts
shell: true
```

表示命令按 shell 语义执行。

如果不加 `shell: true`，类似下面这些命令不会按预期工作：

```bash
pwd && ls
echo err >&2
npm test | cat
```

因为 `&&`、`>&2`、`|` 都是 shell 语法。

当前工具面向模型的输入是：

```text
Shell command to execute
```

所以应该开启 shell 语义。

### `reject`

```ts
reject: false
```

表示命令退出码非 0 时，不让 `execa` 直接 throw。

例如：

```bash
exit 7
```

会返回普通结果：

```text
Exit code: 7
```

而不是让工具本身变成异常。

这点很重要。

命令失败是命令结果，不一定是工具执行失败。

例如：

```bash
npm test
```

测试失败时 exit code 非 0，模型应该看到测试输出，再决定如何修复。

### `all`

```ts
all: true
```

表示把 stdout 和 stderr 合并到 `result.all`。

这样模型能按真实命令输出顺序看到：

```text
stdout
stderr
stdout
```

测试里也覆盖了：

```ts
{ command: 'echo out && echo err >&2' }
```

结果同时包含：

```text
out
err
```

### `timeout`

```ts
timeout: parsed.data.timeout_ms
```

命令运行超过指定毫秒数会被终止。

当前默认：

```text
10000 ms
```

最大：

```text
30000 ms
```

超时时，工具返回 `isError`：

```ts
if (result.timedOut) {
  return errorResult(
    formatCommandResult(result.exitCode ?? -1, String(result.all ?? ''), result.timedOut)
  )
}
```

输出类似：

```text
Exit code: -1
Timed out: true
```

### `maxBuffer`

```ts
maxBuffer: MAX_OUTPUT_CHARS * 4
```

`maxBuffer` 是 execa 收集输出时的缓冲上限。

这里设置成最终输出字符限制的 4 倍：

```text
20000 * 4 = 80000
```

原因是：

```text
maxBuffer 按底层输出大小限制。
MAX_OUTPUT_CHARS 按最终字符串长度截断。
两者不完全等价。
```

工具最终还会再做一次文本截断：

```ts
truncateOutput(allOutput.trimEnd())
```

## 输出格式

正常命令结果通过 `formatCommandResult()` 格式化：

```ts
function formatCommandResult(exitCode: number, allOutput: string, timedOut: boolean): string {
  const lines = [`Exit code: ${exitCode}`]

  if (timedOut) {
    lines.push('Timed out: true')
  }

  const output = truncateOutput(allOutput.trimEnd())

  if (output.length > 0) {
    lines.push('', output)
  }

  return lines.join('\n')
}
```

成功命令：

```text
Exit code: 0

hello
```

失败命令：

```text
Exit code: 7

before
```

超时命令：

```text
Exit code: -1
Timed out: true
```

注意：

```text
非 0 exit code 不会自动变成 isError。
超时会变成 isError。
```

原因是：

```text
非 0 exit code 是命令的业务结果。
超时表示工具没能正常拿到完整结果。
```

## 输出截断

最终输出会经过：

```ts
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output
  }

  return `${output.slice(0, MAX_OUTPUT_CHARS).trimEnd()}\n[truncated]`
}
```

如果输出超过 20000 字符，会变成：

```text
前 20000 字符
[truncated]
```

这样可以避免命令输出把模型上下文撑爆。

## 错误处理

输入错误：

```ts
return errorResult(`Error: invalid Bash input: ${formatZodError(parsed.error)}`)
```

超时：

```ts
return errorResult(
  formatCommandResult(result.exitCode ?? -1, String(result.all ?? ''), result.timedOut)
)
```

execa 自身异常：

```ts
return errorResult(`Error running Bash: ${formatError(error)}`)
```

`errorResult()`：

```ts
function errorResult(content: string): ToolCallResult {
  return { content, isError: true }
}
```

工具失败不会让 agent loop 崩溃。

失败结果仍然会作为 `tool_result` 返回给模型。

## 注册到工具表

`src/tools/registry.ts` 中引入：

```ts
import { bashTool } from './bash/index.js'
```

然后加入 `allTools`：

```ts
export const allTools: AgentTool[] = [readTool, globTool, grepTool, editTool, writeTool, bashTool]
```

`getToolsApiParams()` 会调用每个工具的 `isEnabled()`：

```ts
return tools
  .filter((tool) => tool.isEnabled(context))
  .map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }))
```

所以：

```text
QING_ENABLE_BASH_TOOL=0
  Anthropic tools 中没有 Bash。

QING_ENABLE_BASH_TOOL=1
  Anthropic tools 中有 Bash。
```

## 单元测试覆盖

`test/tools/bash/index.test.ts` 覆盖了：

```text
默认禁用，设置 QING_ENABLE_BASH_TOOL=1 后启用
在 workspace 内执行命令
非 0 exit code 作为普通命令结果返回
stdout 和 stderr 合并输出
不暴露非白名单环境变量
无效 input 返回 isError
长时间命令超时
```

其中环境变量过滤测试很关键：

```ts
process.env.ANTHROPIC_AUTH_TOKEN = 'secret-token'

const result = await bashTool.call(
  {
    command:
      'node -e \'console.log(process.env.ANTHROPIC_AUTH_TOKEN === undefined ? "missing" : process.env.ANTHROPIC_AUTH_TOKEN)\''
  },
  { cwd: workspaceRoot }
)

expect(result.content).toContain('missing')
expect(result.content).not.toContain('secret-token')
```

这说明：

```text
父进程里有 ANTHROPIC_AUTH_TOKEN。
Bash 子进程里看不到 ANTHROPIC_AUTH_TOKEN。
工具结果里也没有 secret-token。
```

非 0 exit code 测试也很关键：

```ts
const result = await bashTool.call({ command: 'echo before && exit 7' }, { cwd: workspaceRoot })

expect(result.isError).toBeUndefined()
expect(result.content).toContain('Exit code: 7')
expect(result.content).toContain('before')
```

这说明命令失败不会被当成工具崩溃。

模型可以继续根据输出修复问题。

## 真实调用测试

确认 `.env` 中：

```env
QING_ENABLE_BASH_TOOL=1
```

启动 REPL：

```bash
npm run repl
```

输入：

```text
运行 npm test -- test/tools/bash/index.test.ts
```

期望看到类似工具调用：

```text
[tool: Bash]
[tool result: Bash ok]
[tool input: {"command":"npm test -- test/tools/bash/index.test.ts"}]
Exit code: 0

> qing-agent@1.0.0 test
> vitest run test/tools/bash/index.test.ts
```

也可以测试非 0 exit code：

```text
执行 echo before && exit 7
```

期望：

```text
Exit code: 7

before
```

这不代表工具调用失败。

它只是命令本身返回了 7。

## 当前边界

当前 Bash 工具还有一些有意保留的边界：

```text
没有用户确认 UI。
没有危险命令拦截。
没有命令 allowlist。
没有进程树级别的强隔离。
没有容器或沙箱。
```

所以默认必须关闭：

```env
QING_ENABLE_BASH_TOOL=0
```

只有在你明确知道风险、需要模型运行命令时，再本地开启：

```env
QING_ENABLE_BASH_TOOL=1
```

## 和其他工具的分工

当前 Step 5 工具有：

```text
Read
  读取文件内容。

Glob
  查找文件路径。

Grep
  搜索文件内容。

Edit
  修改已有文件里的唯一字符串。

Write
  创建新文件，不覆盖已有文件。

Bash
  执行项目命令，比如测试、构建、git 状态检查。
```

常见组合：

```text
查找文件
  Glob

搜索代码
  Grep

查看文件
  Read

修改已有文件
  Edit

新增文件
  Write

验证项目
  Bash
```

`Bash` 不应该替代所有工具。

例如：

```text
读取文件内容
  优先用 Read，不要用 cat。

搜索代码
  优先用 Grep，不要用 grep/rg 命令。

创建或修改文件
  优先用 Write / Edit，不要用 shell 重定向。
```

这样可以让每个操作都有更清晰的权限边界和工具结果格式。
