# Step 5：核心工具代码解释

本文用于解释 Step 5 正式项目中新增工具的代码。

当前先从 `Glob` 工具开始：

```text
src/tools/glob/index.ts
```

`Glob` 工具的重点是：

```text
1. 接收模型传来的 glob 查询参数。
2. 校验输入。
3. 把搜索目录限制在 workspace 内。
4. 使用 fast-glob 查找匹配文件。
5. 把结果转换成 agent loop 可以回传给模型的 ToolCallResult。
```

后续新增 `Grep`、`Edit`、`Write`、`Bash` 时，可以继续在本文追加对应章节。

## Glob 工具目标

`Glob` 的作用是：

```text
在 workspace 内按 glob pattern 查找文件。
```

示例输入：

```ts
await globTool.call(
  {
    pattern: '**/*.ts',
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
agent/agent-loop.ts
cli/repl.ts
llm/stream-message.ts
tools/glob/index.ts
```

返回路径是相对于搜索根目录的路径。

如果搜索根是：

```text
/Users/me/code/qing-agent/src
```

文件是：

```text
/Users/me/code/qing-agent/src/tools/glob/index.ts
```

返回的是：

```text
tools/glob/index.ts
```

## Glob Pattern 语义

当前实现使用 `fast-glob` 处理 pattern。

常用写法：

```text
*.ts
  匹配搜索根目录下的一层 .ts 文件。

**/*.ts
  匹配搜索根目录下所有 .ts 文件，包括根目录文件和任意层级子目录文件。

tools/**/*.ts
  匹配 tools 目录下任意层级的 .ts 文件。

*.md
  匹配搜索根目录下的一层 Markdown 文件。
```

注意：

```text
*.ts
```

不会递归进入子目录。

如果要查找全部 TypeScript 文件，应该使用：

```text
**/*.ts
```

## 文件结构

当前 `Glob` 工具在：

```text
src/tools/glob/index.ts
```

测试在：

```text
test/tools/glob/index.test.ts
```

相关共享路径函数在：

```text
src/tools/workspace-path.ts
```

## 导入模块

`src/tools/glob/index.ts` 开头：

```ts
import fastGlob from 'fast-glob'
import { z } from 'zod'
import { resolveExistingWorkspacePath } from '../workspace-path.js'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'
```

### `fast-glob`

`fast-glob` 负责文件查找和 glob pattern 匹配。

在当前工具里，它替代了手写的：

```text
递归读取目录
路径字符串匹配
** / * / ? 等 glob 规则处理
```

正式项目里，glob 这类底层能力应该优先交给成熟 npm 包。

### `zod`

`zod` 用于运行时输入校验。

模型传来的工具参数不可信，即使已经给 Anthropic API 提供了 JSON Schema，本地执行前仍然要校验一次。

### `resolveExistingWorkspacePath`

`resolveExistingWorkspacePath()` 用于把模型传来的 `path` 解析成真实文件系统路径，并确保它没有逃出 workspace。

`Glob` 是只读工具，但仍然必须做路径安全检查。

例如：

```ts
await resolveExistingWorkspacePath('../outside', context.cwd)
```

应该返回错误，而不是允许工具扫描 workspace 外的文件。

## 工具 Schema

`globToolInputSchema` 是给模型看的工具参数说明：

```ts
export const globToolInputSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'Glob pattern used to find files.'
    },
    path: {
      type: 'string',
      description: 'Workspace-relative directory to search from.'
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 500,
      description: 'Maximum number of paths to return.'
    }
  },
  required: ['pattern'],
  additionalProperties: false
} satisfies ToolInputSchema
```

字段含义：

```text
pattern
  必填。glob pattern，例如 **/*.ts。

path
  可选。workspace-relative 搜索目录，例如 src。

limit
  可选。最多返回多少条路径。
```

`required: ['pattern']` 表示模型至少必须提供 `pattern`。

`additionalProperties: false` 表示不鼓励模型传额外字段。

## Zod 输入校验

本地运行时校验：

```ts
const globInputValidator = z
  .object({
    pattern: z.string().min(1),
    path: z.string().min(1).optional().default('.'),
    limit: z.number().int().min(1).max(500).optional().default(200)
  })
  .strict()
```

这里定义了三个规则：

```text
pattern
  必须是非空字符串。

path
  必须是非空字符串；不传时默认为 '.'。

limit
  必须是 1 到 500 之间的整数；不传时默认为 200。
```

`.strict()` 表示输入里不能有 schema 之外的字段。

如果模型传入：

```ts
{ pattern: '' }
```

工具会返回：

```ts
{
  content: 'Error: invalid Glob input: ...',
  isError: true
}
```

不会继续访问文件系统。

## 工具对象

`globTool` 实现统一的 `AgentTool` 契约：

```ts
export const globTool: AgentTool = {
  name: 'Glob',
  description: 'Find files in the current workspace by glob pattern.',
  inputSchema: globToolInputSchema,

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
name: 'Glob'
```

模型发起工具调用时使用这个名字：

```json
{
  "type": "tool_use",
  "name": "Glob",
  "input": {
    "pattern": "**/*.ts",
    "path": "src"
  }
}
```

`registry` 通过这个名字找到本地工具。

### `description`

```ts
description: 'Find files in the current workspace by glob pattern.'
```

这是给模型看的说明。

描述要短，但必须明确工具边界：

```text
查找文件
当前 workspace
按 glob pattern
```

### `isReadOnly()`

```ts
isReadOnly() {
  return true
}
```

`Glob` 只读取目录结构，不修改文件，不执行命令。

后续做权限策略时，只读工具可以比写入工具更容易自动执行。

### `isEnabled()`

```ts
isEnabled() {
  return true
}
```

当前默认启用。

以后如果要按配置关闭某些工具，可以在这里读取上下文或环境变量。

## `call()` 执行流程

核心逻辑：

```ts
async call(input: JsonObject, context): Promise<ToolCallResult> {
  const parsed = globInputValidator.safeParse(input)

  if (!parsed.success) {
    return errorResult(`Error: invalid Glob input: ${formatZodError(parsed.error)}`)
  }

  try {
    const searchRoot = await resolveExistingWorkspacePath(parsed.data.path, context.cwd)
    const matches = (await findMatchingFiles(parsed.data.pattern, searchRoot))
      .sort()
      .slice(0, parsed.data.limit)

    if (matches.length === 0) {
      return { content: 'No files matched' }
    }

    return { content: matches.join('\n') }
  } catch (error) {
    return errorResult(`Error running Glob: ${formatError(error)}`)
  }
}
```

执行步骤：

```text
1. 用 Zod 校验 input。
2. 校验失败时返回 isError。
3. 把 path 解析成 workspace 内真实路径。
4. 调用 fast-glob 查找文件。
5. 对结果排序。
6. 按 limit 截断。
7. 没有匹配时返回 No files matched。
8. 有匹配时用换行拼接路径。
9. 捕获异常并转换成 ToolCallResult 错误。
```

## 路径安全

```ts
const searchRoot = await resolveExistingWorkspacePath(parsed.data.path, context.cwd)
```

`path` 是模型传来的输入，不能直接传给 `fast-glob`。

必须先经过 workspace 路径解析。

例如当前 workspace 是：

```text
/Users/me/code/qing-agent
```

合法输入：

```json
{
  "pattern": "**/*.ts",
  "path": "src"
}
```

会解析到：

```text
/Users/me/code/qing-agent/src
```

非法输入：

```json
{
  "pattern": "**/*.ts",
  "path": "../outside"
}
```

应该返回错误：

```text
Error running Glob: Path is outside the workspace: ../outside
```

## fast-glob 调用

工具内部封装了一个小函数：

```ts
async function findMatchingFiles(pattern: string, cwd: string): Promise<string[]> {
  return fastGlob(pattern, {
    cwd,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ['**/.git/**', '**/node_modules/**', '**/dist/**']
  })
}
```

### `pattern`

第一个参数是 glob pattern：

```ts
fastGlob('**/*.ts', options)
```

它决定要匹配哪些文件。

### `cwd`

```ts
cwd
```

表示搜索根目录。

`fast-glob` 返回的路径会相对于这个 `cwd`。

如果：

```ts
cwd = '/Users/me/code/qing-agent/src'
pattern = '**/*.ts'
```

返回可能是：

```text
index.ts
tools/glob/index.ts
```

而不是：

```text
/Users/me/code/qing-agent/src/tools/glob/index.ts
```

这样可以避免把本机绝对路径暴露给模型。

### `onlyFiles`

```ts
onlyFiles: true
```

表示只返回文件，不返回目录。

`Glob` 工具当前目标是找文件路径，所以目录不进入结果。

### `followSymbolicLinks`

```ts
followSymbolicLinks: false
```

表示不跟随符号链接继续遍历。

这样可以降低 symlink 指向 workspace 外部路径时的风险。

搜索根本身已经经过 `resolveExistingWorkspacePath()` 校验；遍历过程中仍然不跟随 symlink。

### `ignore`

```ts
ignore: ['**/.git/**', '**/node_modules/**', '**/dist/**']
```

排除常见的大目录：

```text
.git
node_modules
dist
```

这些目录通常不应该进入 agent 的普通文件搜索结果：

```text
.git
  版本控制内部数据。

node_modules
  依赖代码，数量很大。

dist
  构建产物。
```

## 排序和限制

```ts
const matches = (await findMatchingFiles(parsed.data.pattern, searchRoot))
  .sort()
  .slice(0, parsed.data.limit)
```

### `sort()`

排序让输出稳定。

稳定输出对测试和模型阅读都更友好。

### `slice(0, limit)`

限制最多返回多少条。

即使项目很大，也不会一次性把几千个路径塞进模型上下文。

默认值：

```text
200
```

最大值：

```text
500
```

## 返回值

工具统一返回：

```ts
type ToolCallResult = {
  content: string
  isError?: boolean
}
```

### 找到匹配文件

```ts
return { content: matches.join('\n') }
```

示例：

```text
agent/agent-loop.ts
cli/repl.ts
tools/glob/index.ts
```

### 没有匹配文件

```ts
return { content: 'No files matched' }
```

这不是工具执行错误。

它表示工具正常运行，但没有找到符合 pattern 的文件。

### 输入错误或执行错误

```ts
return errorResult(`Error running Glob: ${formatError(error)}`)
```

返回：

```ts
{
  content: 'Error running Glob: ...',
  isError: true
}
```

agent loop 会把它转换成 Anthropic 的 `tool_result`，并带上 `is_error: true`。

## 错误格式化

```ts
function errorResult(content: string): ToolCallResult {
  return { content, isError: true }
}
```

这个函数统一生成错误结果。

```ts
function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join('; ')
}
```

Zod 错误可能有多个 issue，这里把它们拼成一行。

```ts
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
```

`catch` 捕获的是 `unknown`，不能假设一定是 `Error`。

## 一次完整调用示例

假设 workspace：

```text
workspace/
  README.md
  src/
    index.ts
    llm/
      types.ts
    tools/
      glob/
        index.ts
```

调用：

```ts
const result = await globTool.call(
  { pattern: '**/*.ts', path: 'src', limit: 10 },
  { cwd: workspaceRoot }
)
```

执行过程：

```text
1. 校验 pattern/path/limit。
2. 把 path: 'src' 解析为 workspace 内真实目录。
3. 以 src 为 cwd 调用 fast-glob。
4. pattern: '**/*.ts' 匹配：
   - index.ts
   - llm/types.ts
   - tools/glob/index.ts
5. 排序。
6. 截断到最多 10 条。
7. 用换行拼成 content。
```

返回：

```ts
{
  content: 'index.ts\nllm/types.ts\ntools/glob/index.ts'
}
```

如果调用：

```ts
const result = await globTool.call(
  { pattern: '*.ts', path: 'src', limit: 10 },
  { cwd: workspaceRoot }
)
```

返回只包含搜索根目录下的一层文件：

```ts
{
  content: 'index.ts'
}
```

## 测试覆盖

`test/tools/glob/index.test.ts` 覆盖：

```text
找到当前目录 pattern 匹配文件
**/*.ts 递归匹配根目录和深层目录
tools/**/*.ts 匹配固定目录前缀下的深层文件
path 省略时默认使用 workspace root
limit 限制输出数量
没有匹配时返回 No files matched
无效 input 返回 isError
workspace 外路径被拒绝
```

测试使用临时目录创建隔离 workspace。

主要 fixture：

```text
workspace/
  README.md
  src/
    index.ts
    llm/
      types.ts
    tools/
      glob/
        index.ts
outside/
  secret.ts
```

这样可以验证：

```text
*.ts
  只匹配 src/index.ts。

**/*.ts
  匹配 src 下所有 .ts 文件。

tools/**/*.ts
  只匹配 tools/glob/index.ts。

../outside
  被 workspace 路径安全逻辑拒绝。
```

## 与 Agent Loop 的关系

`Glob` 工具只负责本地执行。

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

`Glob` 只要遵守 `AgentTool` 契约：

```text
提供 name / description / inputSchema
实现 isReadOnly / isEnabled
实现 call(input, context)
返回 ToolCallResult
```

注册到：

```text
src/tools/registry.ts
```

模型就能在正常对话里调用它。

## 后续追加文档建议

后续新增工具时，可以按同样结构追加：

```text
## Grep 工具
  - 工具目标
  - 输入 schema
  - 搜索实现
  - 输出限制
  - 测试 fixture

## Edit 工具
  - 工具目标
  - 输入 schema
  - 路径安全
  - 字符串替换
  - 唯一匹配
  - diff 或摘要

## Write 工具
  - 工具目标
  - 输入 schema
  - 新文件路径安全
  - fs.mkdir / fs.writeFile
  - 权限开关

## Bash 工具
  - 工具目标
  - 输入 schema
  - child_process.spawn
  - stdout/stderr stream
  - timeout / kill
  - 用户确认
```
