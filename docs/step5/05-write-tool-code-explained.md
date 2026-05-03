# Step 5：Write 工具代码解释

本文用于解释 Step 5 正式项目中 `Write` 工具的代码：

```text
src/tools/write/index.ts
src/tools/workspace-path.ts
```

`Write` 工具的重点是：

```text
1. 接收模型传来的新文件路径和完整文件内容。
2. 校验输入。
3. 默认禁用写入类工具。
4. 把写入路径限制在 workspace 内。
5. 自动创建父目录。
6. 只创建新文件，不覆盖已有文件。
7. 把写入结果转换成 ToolCallResult。
```

## Write 工具目标

`Write` 的作用是：

```text
在 workspace 内创建一个新的文本文件。
```

示例输入：

```ts
await writeTool.call(
  {
    file_path: 'tmp/write-smoke.ts',
    content: 'const value = "write"\n'
  },
  {
    cwd: '/Users/me/code/qing-agent'
  }
)
```

可能输出：

```text
Wrote tmp/write-smoke.ts
Bytes: 22
```

当前实现有一个重要策略：

```text
如果目标文件已经存在，Write 会返回 isError，不会覆盖原文件。
```

这是为了让写入工具先保持可控。

覆盖已有文件的能力可以以后再加，但需要额外设计：

```text
是否需要用户确认
是否需要展示 diff
是否限制覆盖目录
是否需要备份或回滚
```

## 默认禁用

`Write` 是写入类工具，会修改 workspace。

当前实现默认不把它暴露给模型：

```ts
isEnabled() {
  return process.env.QING_ENABLE_WRITE_TOOLS === '1'
}
```

`.env.example` 中默认是：

```env
QING_ENABLE_WRITE_TOOLS=0
```

只有显式设置：

```env
QING_ENABLE_WRITE_TOOLS=1
```

`Write` 才会出现在 Anthropic tools 参数里。

注意：

```text
isEnabled()
  控制模型是否能看到这个工具。

writeTool.call()
  仍然可以在单元测试或直接调用中执行。
```

所以：

```text
REPL 真实调用
  需要 QING_ENABLE_WRITE_TOOLS=1。

单元测试
  可以直接调用 writeTool.call()。
```

## 文件结构

当前 `Write` 工具在：

```text
src/tools/write/index.ts
```

测试在：

```text
test/tools/write/index.test.ts
```

相关共享路径函数在：

```text
src/tools/workspace-path.ts
```

注册入口在：

```text
src/tools/registry.ts
```

## 导入模块

`src/tools/write/index.ts` 开头：

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'
import { resolveNewWorkspacePath } from '../workspace-path.js'
```

### `fs`

`fs` 用于真实创建目录和写文件：

```ts
await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
await fs.writeFile(resolvedPath, parsed.data.content, { encoding: 'utf8', flag: 'wx' })
```

这里使用 Node.js 标准库是合适的：

```text
Write 的底层能力只是文件写入。
没有复杂匹配、搜索、diff、patch 算法。
Node.js fs 已经提供成熟稳定的文件系统接口。
```

项目基调是底层复杂能力优先使用成熟 npm 包。

但这里不是在手写复杂文件系统能力，而是在调用 Node.js 标准文件 API。

### `path`

`path` 用于：

```text
1. 获取父目录。
2. 把绝对路径转成 workspace-relative 路径。
3. 统一输出里的路径分隔符。
```

例如：

```ts
const relativePath = normalizePath(path.relative(workspaceRoot, resolvedPath))
```

工具结果不应该暴露用户机器上的绝对路径，所以返回的是：

```text
tmp/write-smoke.ts
```

而不是：

```text
/Users/me/code/qing-agent/tmp/write-smoke.ts
```

### `zod`

`zod` 用于运行时输入校验。

模型传来的工具参数不可信，写文件前必须再次校验。

### `resolveNewWorkspacePath`

`resolveNewWorkspacePath()` 用于解析“还不存在的目标文件路径”。

`Write` 和 `Read` / `Edit` 的路径处理不一样。

`Read` / `Edit` 面对的是已存在文件，可以使用：

```ts
resolveExistingWorkspacePath(filePath, cwd)
```

因为目标文件已经存在，可以直接：

```ts
fs.realpath(candidatePath)
```

但 `Write` 创建的是新文件。

例如：

```text
tmp/write-smoke.ts
```

如果这个文件还不存在，就不能对它直接 `realpath()`。

所以 `Write` 使用：

```ts
resolveNewWorkspacePath(filePath, cwd)
```

## 常量

```ts
const MAX_WRITE_BYTES = 1_000_000
```

含义：

```text
一次最多写入 1 MB 内容。
```

写入大小限制可以避免模型一次生成超大文件，导致工具结果和本地文件系统出现不可控行为。

当前限制按 UTF-8 字节数计算：

```ts
const contentBytes = Buffer.byteLength(parsed.data.content, 'utf8')
```

这比按字符串长度更接近真实写入大小。

## 工具 Schema

`writeToolInputSchema` 是给模型看的工具参数说明：

```ts
export const writeToolInputSchema = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'Workspace-relative path of the new text file to create.'
    },
    content: {
      type: 'string',
      description: 'Complete text content to write into the new file.'
    }
  },
  required: ['file_path', 'content'],
  additionalProperties: false
} satisfies ToolInputSchema
```

字段含义：

```text
file_path
  必填。workspace-relative 新文件路径。

content
  必填。要写入文件的完整文本内容。
```

注意这里的 `content` 是完整文件内容，不是增量 patch。

例如：

```json
{
  "file_path": "tmp/hello.ts",
  "content": "console.log('hello')\n"
}
```

`additionalProperties: false` 表示模型不能传额外字段。

## Zod 输入校验

Schema 是给模型看的。

真正执行工具前，还要用 `zod` 再校验一次：

```ts
const writeInputValidator = z
  .object({
    file_path: z.string().min(1),
    content: z.string()
  })
  .strict()
```

规则：

```text
file_path
  必须是非空字符串。

content
  必须是字符串。
  允许空字符串，用于创建空文件。

strict()
  不允许额外字段。
```

如果校验失败：

```ts
return errorResult(`Error: invalid Write input: ${formatZodError(parsed.error)}`)
```

返回的是 `ToolCallResult`：

```ts
{
  content: 'Error: invalid Write input: ...',
  isError: true
}
```

## AgentTool 定义

`writeTool` 实现了统一的 `AgentTool` 契约：

```ts
export const writeTool: AgentTool = {
  name: 'Write',
  description: 'Create a new text file in the current workspace. Existing files are not overwritten.',
  inputSchema: writeToolInputSchema,

  isReadOnly() {
    return false
  },

  isEnabled() {
    return process.env.QING_ENABLE_WRITE_TOOLS === '1'
  },

  async call(input: JsonObject, context): Promise<ToolCallResult> {
    // ...
  }
}
```

重点是：

```text
name
  模型调用工具时使用的名字。

description
  给模型看的工具说明。

inputSchema
  给模型看的参数结构。

isReadOnly()
  返回 false，表示这是写入工具。

isEnabled()
  控制是否暴露给模型。

call()
  真正执行写文件。
```

## call 执行流程

`call()` 的主流程是：

```text
1. 校验 input。
2. 计算 content 的 UTF-8 字节数。
3. 检查是否超过 MAX_WRITE_BYTES。
4. 解析 workspace 内的新文件路径。
5. 创建父目录。
6. 使用 wx 模式写入文件。
7. 返回相对路径和写入字节数。
8. 捕获错误并转换成 ToolCallResult。
```

对应代码：

```ts
const parsed = writeInputValidator.safeParse(input)

if (!parsed.success) {
  return errorResult(`Error: invalid Write input: ${formatZodError(parsed.error)}`)
}
```

通过校验后，先计算内容大小：

```ts
const contentBytes = Buffer.byteLength(parsed.data.content, 'utf8')
```

如果超过限制：

```ts
if (contentBytes > MAX_WRITE_BYTES) {
  return errorResult(
    `Error: content is too large to write: ${parsed.data.file_path} (${contentBytes} bytes)`
  )
}
```

然后解析路径：

```ts
const resolvedPath = await resolveNewWorkspacePath(parsed.data.file_path, context.cwd)
```

再创建父目录：

```ts
await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
```

最后写入文件：

```ts
await fs.writeFile(resolvedPath, parsed.data.content, { encoding: 'utf8', flag: 'wx' })
```

## 为什么使用 `flag: 'wx'`

这里没有使用普通的：

```ts
await fs.writeFile(resolvedPath, content, 'utf8')
```

因为普通写法会覆盖已有文件。

当前策略是只创建新文件，不覆盖已有文件。

所以使用：

```ts
flag: 'wx'
```

含义：

```text
w
  write，写入文件。

x
  exclusive，文件已存在时失败。
```

如果文件已经存在，Node.js 会抛出 `EEXIST` 错误。

工具会把它转换成：

```text
Error: file already exists: src/existing.ts
```

对应代码：

```ts
if (isFileExistsError(error)) {
  return errorResult(`Error: file already exists: ${parsed.data.file_path}`)
}
```

这比先判断：

```ts
if (await exists(path)) ...
await writeFile(path, content)
```

更稳，因为 `wx` 把“检查是否存在”和“创建文件”合在一次文件系统操作里。

## resolveNewWorkspacePath

`src/tools/workspace-path.ts` 新增了：

```ts
export async function resolveNewWorkspacePath(filePath: string, cwd: string): Promise<string> {
  const workspaceRoot = await fs.realpath(cwd)
  const candidatePath = path.resolve(workspaceRoot, filePath)

  if (!isInsideWorkspace(candidatePath, workspaceRoot)) {
    throw new Error(`Path is outside the workspace: ${filePath}`)
  }

  const realExistingAncestor = await findRealExistingAncestor(path.dirname(candidatePath))

  if (!isInsideWorkspace(realExistingAncestor, workspaceRoot)) {
    throw new Error(`Path is outside the workspace: ${filePath}`)
  }

  return candidatePath
}
```

它做了两层检查。

第一层是字符串路径检查：

```ts
const candidatePath = path.resolve(workspaceRoot, filePath)

if (!isInsideWorkspace(candidatePath, workspaceRoot)) {
  throw new Error(`Path is outside the workspace: ${filePath}`)
}
```

这可以挡住：

```text
../outside/new.ts
/Users/me/secret.txt
```

第二层是已有父级目录的真实路径检查：

```ts
const realExistingAncestor = await findRealExistingAncestor(path.dirname(candidatePath))
```

为什么要找已有父级目录？

因为新文件可能不存在，父目录也可能有一部分不存在：

```text
src/generated/nested.ts
```

如果 `src/generated` 不存在，不能直接：

```ts
fs.realpath('src/generated')
```

所以代码会往上找最近存在的父级：

```text
src/generated
src
workspace
```

找到后再检查这个真实父级是否还在 workspace 内：

```ts
if (!isInsideWorkspace(realExistingAncestor, workspaceRoot)) {
  throw new Error(`Path is outside the workspace: ${filePath}`)
}
```

这样可以处理两类情况：

```text
正常新文件
  tmp/new.ts
  src/generated/nested.ts

越界路径
  ../outside/new.ts
  /Users/me/secret.txt
```

## 输出格式

写入成功后：

```ts
return {
  content: [`Wrote ${relativePath}`, `Bytes: ${contentBytes}`].join('\n')
}
```

示例：

```text
Wrote tmp/write-smoke.ts
Bytes: 22
```

工具只返回相对路径和字节数，不返回完整文件内容。

原因是：

```text
模型已经传入了 content。
再次返回完整内容会浪费上下文。
大文件内容会让 tool_result 变得很长。
```

如果模型需要确认文件内容，可以再调用 `Read`。

## 错误处理

所有错误都会转换成 `ToolCallResult`。

通用错误：

```ts
return errorResult(`Error running Write: ${formatError(error)}`)
```

文件已存在错误：

```ts
if (isFileExistsError(error)) {
  return errorResult(`Error: file already exists: ${parsed.data.file_path}`)
}
```

`errorResult()` 很简单：

```ts
function errorResult(content: string): ToolCallResult {
  return { content, isError: true }
}
```

注意：

```text
工具执行失败，不代表 agent loop 崩溃。

失败结果仍然会作为 tool_result 返回给模型。
模型可以根据错误信息决定下一步。
```

例如目标文件已存在时，模型可以改用：

```text
Read + Edit
```

而不是继续用 `Write` 覆盖。

## 注册到工具表

`src/tools/registry.ts` 中引入：

```ts
import { writeTool } from './write/index.js'
```

然后加入 `allTools`：

```ts
export const allTools: AgentTool[] = [readTool, globTool, grepTool, editTool, writeTool]
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
QING_ENABLE_WRITE_TOOLS=0
  Anthropic tools 中没有 Write。

QING_ENABLE_WRITE_TOOLS=1
  Anthropic tools 中有 Write。
```

## 单元测试覆盖

`test/tools/write/index.test.ts` 覆盖了：

```text
默认禁用，设置 QING_ENABLE_WRITE_TOOLS=1 后启用
创建新文件
自动创建父目录
目标文件已存在时不覆盖
允许创建空文件
拒绝 workspace 外路径
无效 input 返回 isError
```

其中禁止覆盖测试很关键：

```ts
const result = await writeTool.call(
  {
    file_path: 'src/existing.ts',
    content: 'new\n'
  },
  { cwd: workspaceRoot }
)

await expect(fs.readFile(path.join(workspaceRoot, 'src', 'existing.ts'), 'utf8')).resolves.toBe(
  'old\n'
)
expect(result).toEqual({
  content: 'Error: file already exists: src/existing.ts',
  isError: true
})
```

这说明：

```text
Write 返回了错误。
原文件内容没有被改掉。
```

注册表测试覆盖了：

```text
allTools 包含 Write。
findToolByName('Write') 可以找到。
默认不暴露 Write。
QING_ENABLE_WRITE_TOOLS=1 时暴露 Write。
```

## 真实调用测试

确认 `.env` 中：

```env
QING_ENABLE_WRITE_TOOLS=1
```

启动 REPL：

```bash
npm run repl
```

输入：

```text
创建 tmp/write-smoke.ts 文件，内容是 const value = "write"
```

期望看到类似工具调用：

```text
[tool: Write]
[tool result: Write ok]
[tool input: {"file_path":"tmp/write-smoke.ts","content":"const value = \"write\"\n"}]
Wrote tmp/write-smoke.ts
Bytes: 22
```

然后可以继续输入：

```text
读取 tmp/write-smoke.ts
```

模型应该调用 `Read` 验证文件内容。

如果再次要求创建同一个文件，应该得到：

```text
Error: file already exists: tmp/write-smoke.ts
```

这说明禁止覆盖策略生效。

## 和 Edit 的分工

当前写入类工具有两个：

```text
Write
  创建新文件。
  不覆盖已有文件。

Edit
  修改已有文件。
  要求 old_string 刚好出现一次。
```

所以常见工作流是：

```text
新建文件
  使用 Write。

修改已有文件
  先 Read，再 Edit。
```

不要让 `Write` 直接承担修改已有文件的职责。

这个分工更安全，也更容易测试。
