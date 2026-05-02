# Step 5：Edit 工具代码解释

本文用于解释 Step 5 正式项目中 `Edit` 工具的代码：

```text
src/tools/edit/index.ts
src/tools/edit/count-occurrences.ts
```

`Edit` 工具的重点是：

```text
1. 接收模型传来的精确替换参数。
2. 校验输入。
3. 默认禁用写入类工具。
4. 把目标文件限制在 workspace 内。
5. 要求 old_string 在文件中刚好出现一次。
6. 写入替换后的内容。
7. 使用 diff 包生成 unified diff 摘要。
8. 把结果转换成 ToolCallResult。
```

## Edit 工具目标

`Edit` 的作用是：

```text
在 workspace 内的已有文本文件中，把唯一一段 old_string 替换成 new_string。
```

示例输入：

```ts
await editTool.call(
  {
    file_path: 'src/index.ts',
    old_string: 'const value = "old"',
    new_string: 'const value = "new"'
  },
  {
    cwd: '/Users/me/code/qing-agent'
  }
)
```

可能输出：

```text
Edited src/index.ts

Index: src/index.ts
===================================================================
--- src/index.ts	before
+++ src/index.ts	after
@@ -1,1 +1,1 @@
-const value = "old"
+const value = "new"
```

## 默认禁用

`Edit` 是写入类工具，会修改文件。

当前实现默认不把它暴露给模型：

```ts
isEnabled() {
  return process.env.QING_ENABLE_WRITE_TOOLS === '1'
}
```

`.env.example` 和本地 `.env` 都包含：

```env
QING_ENABLE_WRITE_TOOLS=0
```

默认值为 `0`，表示关闭写入类工具。

只有显式设置：

```env
QING_ENABLE_WRITE_TOOLS=1
```

`Edit` 才会出现在 Anthropic tools 参数里。

注意：

```text
isEnabled()
  控制模型是否能看到这个工具。

editTool.call()
  仍然可以在单元测试或直接调用中执行。
```

所以测试可以直接调用 `editTool.call()`，但 REPL 中模型默认不能调用 `Edit`。

## 文件结构

当前 `Edit` 工具在：

```text
src/tools/edit/index.ts
```

唯一匹配计数函数在：

```text
src/tools/edit/count-occurrences.ts
```

测试在：

```text
test/tools/edit/index.test.ts
test/tools/edit/count-occurrences.test.ts
```

相关共享路径函数在：

```text
src/tools/workspace-path.ts
```

## 导入模块

`src/tools/edit/index.ts` 开头：

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { z } from 'zod'
import { resolveExistingWorkspacePath } from '../workspace-path.js'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'
import { countOccurrences } from './count-occurrences.js'
```

### `fs`

`fs` 用于真实读写文件：

```ts
await fs.stat(resolvedPath)
await fs.readFile(resolvedPath, 'utf8')
await fs.writeFile(resolvedPath, updated, 'utf8')
```

`Edit` 是写入工具，所以它必须比只读工具多做安全检查。

### `path`

`path` 用于把真实路径转换成 workspace-relative 路径：

```ts
path.relative(workspaceRoot, resolvedPath)
```

工具结果不应该暴露用户机器上的绝对路径。

### `diff`

`diff` 包用于生成 unified diff。

当前使用：

```ts
import { createTwoFilesPatch } from 'diff'
```

它把编辑前后的文本转换成类似 Git diff 的摘要，方便用户和模型理解发生了什么变化。

### `zod`

`zod` 用于运行时输入校验。

模型传来的工具参数不可信，写文件前必须再次校验。

### `resolveExistingWorkspacePath`

`resolveExistingWorkspacePath()` 用于把 `file_path` 解析成真实路径，并确保它没有逃出 workspace。

`Edit` 只能编辑已存在文件，所以使用 existing path 版本。

## 常量

```ts
const MAX_EDIT_FILE_BYTES = 1_000_000
const MAX_DIFF_CHARS = 20_000
```

含义：

```text
MAX_EDIT_FILE_BYTES
  最多编辑 1 MB 文件。

MAX_DIFF_CHARS
  diff 输出最多保留 20000 个字符。
```

文件大小限制可以避免模型对超大文件做字符串替换。

diff 长度限制可以避免一次工具结果占用过多上下文。

## 工具 Schema

`editToolInputSchema` 是给模型看的工具参数说明：

```ts
export const editToolInputSchema = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'Workspace-relative path of the existing text file to edit.'
    },
    old_string: {
      type: 'string',
      description: 'Exact string to replace. It must appear exactly once.'
    },
    new_string: {
      type: 'string',
      description: 'Replacement string.'
    }
  },
  required: ['file_path', 'old_string', 'new_string'],
  additionalProperties: false
} satisfies ToolInputSchema
```

字段含义：

```text
file_path
  必填。workspace-relative 文件路径。

old_string
  必填。要替换的精确字符串，必须刚好出现一次。

new_string
  必填。替换后的字符串，可以是空字符串。
```

## Zod 输入校验

本地运行时校验：

```ts
const editInputValidator = z
  .object({
    file_path: z.string().min(1),
    old_string: z.string().min(1),
    new_string: z.string()
  })
  .strict()
```

规则：

```text
file_path
  必须是非空字符串。

old_string
  必须是非空字符串。

new_string
  必须是字符串，但允许为空。
```

为什么 `new_string` 允许为空？

```text
把一段文本替换为空字符串，本质上就是删除这段文本。
```

为什么 `old_string` 不允许为空？

```text
空字符串可以匹配任意位置。
如果允许空 old_string，替换行为会非常不明确。
```

## 工具对象

`editTool` 实现统一的 `AgentTool` 契约：

```ts
export const editTool: AgentTool = {
  name: 'Edit',
  description: 'Replace one unique string inside an existing workspace text file.',
  inputSchema: editToolInputSchema,

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

### `name`

```ts
name: 'Edit'
```

模型发起工具调用时使用这个名字：

```json
{
  "type": "tool_use",
  "name": "Edit",
  "input": {
    "file_path": "src/index.ts",
    "old_string": "old",
    "new_string": "new"
  }
}
```

### `isReadOnly()`

```ts
isReadOnly() {
  return false
}
```

这明确告诉项目：`Edit` 会修改文件。

后续如果增加权限确认 UI，可以优先根据 `isReadOnly()` 区分只读工具和写入工具。

### `isEnabled()`

```ts
isEnabled() {
  return process.env.QING_ENABLE_WRITE_TOOLS === '1'
}
```

默认禁用。

只有用户显式打开写工具开关时，模型才能看到 `Edit`。

## `call()` 执行流程

核心逻辑：

```ts
async call(input: JsonObject, context): Promise<ToolCallResult> {
  const parsed = editInputValidator.safeParse(input)

  if (!parsed.success) {
    return errorResult(`Error: invalid Edit input: ${formatZodError(parsed.error)}`)
  }

  try {
    const resolvedPath = await resolveExistingWorkspacePath(parsed.data.file_path, context.cwd)
    const stat = await fs.stat(resolvedPath)

    if (!stat.isFile()) {
      return errorResult(`Error: Edit target is not a file: ${parsed.data.file_path}`)
    }

    if (stat.size > MAX_EDIT_FILE_BYTES) {
      return errorResult(
        `Error: file is too large to edit: ${parsed.data.file_path} (${stat.size} bytes)`
      )
    }

    const original = await fs.readFile(resolvedPath, 'utf8')
    const matches = countOccurrences(original, parsed.data.old_string)

    if (matches !== 1) {
      return errorResult(`Error: expected exactly 1 match, got ${matches}`)
    }

    const updated = original.replace(parsed.data.old_string, parsed.data.new_string)
    await fs.writeFile(resolvedPath, updated, 'utf8')

    const workspaceRoot = await fs.realpath(context.cwd)
    const relativePath = normalizePath(path.relative(workspaceRoot, resolvedPath))

    return {
      content: [
        `Edited ${relativePath}`,
        '',
        formatDiff(relativePath, original, updated)
      ].join('\n')
    }
  } catch (error) {
    return errorResult(`Error running Edit: ${formatError(error)}`)
  }
}
```

执行步骤：

```text
1. 用 Zod 校验 input。
2. 校验失败时返回 isError。
3. 把 file_path 解析成 workspace 内真实文件路径。
4. 确认目标是文件。
5. 检查文件大小。
6. 读取文件内容。
7. 统计 old_string 出现次数。
8. 如果不是刚好 1 次，返回错误。
9. 替换唯一匹配。
10. 写回文件。
11. 生成 workspace-relative 路径。
12. 生成 diff。
13. 返回编辑摘要。
```

## 路径安全

```ts
const resolvedPath = await resolveExistingWorkspacePath(parsed.data.file_path, context.cwd)
```

`file_path` 来自模型输入，不能直接传给 `fs.writeFile()`。

必须先确认：

```text
路径真实存在
路径没有逃出 workspace
符号链接不会指向 workspace 外部
```

非法输入：

```json
{
  "file_path": "../outside/secret.ts",
  "old_string": "old",
  "new_string": "new"
}
```

应该返回错误，而不是修改 workspace 外的文件。

## 文件大小限制

```ts
const stat = await fs.stat(resolvedPath)

if (stat.size > MAX_EDIT_FILE_BYTES) {
  return errorResult(
    `Error: file is too large to edit: ${parsed.data.file_path} (${stat.size} bytes)`
  )
}
```

当前限制：

```text
1_000_000 bytes
```

也就是约 1 MB。

这个限制避免对超大文件执行整文件字符串替换。

## 唯一匹配

`Edit` 要求 `old_string` 刚好出现一次。

计数函数在：

```text
src/tools/edit/count-occurrences.ts
```

实现：

```ts
export function countOccurrences(value: string, search: string): number {
  if (search.length === 0) {
    return 0
  }

  let count = 0
  let index = 0

  while (true) {
    const foundIndex = value.indexOf(search, index)

    if (foundIndex === -1) {
      return count
    }

    count += 1
    index = foundIndex + search.length
  }
}
```

它统计非重叠匹配。

示例：

```ts
countOccurrences('old new old', 'old')
// 2

countOccurrences('aaaa', 'aa')
// 2
```

为什么要求唯一匹配？

```text
避免模型给的 old_string 太短，误改多个位置。
强迫模型提供足够精确的上下文。
让一次 Edit 只产生一处改动。
```

如果出现 0 次：

```text
Error: expected exactly 1 match, got 0
```

如果出现多次：

```text
Error: expected exactly 1 match, got 2
```

## 写入文件

```ts
const updated = original.replace(parsed.data.old_string, parsed.data.new_string)
await fs.writeFile(resolvedPath, updated, 'utf8')
```

因为前面已经确认 `old_string` 只出现一次，所以这里使用普通 `replace()` 就足够。

`writeFile()` 会覆盖原文件内容。

所以这个工具必须保持默认禁用，直到用户明确打开写工具开关。

## diff 输出

生成 diff：

```ts
function formatDiff(filePath: string, original: string, updated: string): string {
  const diff = createTwoFilesPatch(filePath, filePath, original, updated, 'before', 'after')

  if (diff.length <= MAX_DIFF_CHARS) {
    return diff
  }

  return `${diff.slice(0, MAX_DIFF_CHARS).trimEnd()}\n[diff truncated]`
}
```

`createTwoFilesPatch()` 来自 `diff` 包。

参数含义：

```text
filePath
  旧文件名。

filePath
  新文件名。这里编辑的是同一个文件，所以两边相同。

original
  编辑前内容。

updated
  编辑后内容。

before
  旧文件标签。

after
  新文件标签。
```

输出示例：

```text
Index: src/index.ts
===================================================================
--- src/index.ts	before
+++ src/index.ts	after
@@ -1,1 +1,1 @@
-const value = "old"
+const value = "new"
```

如果 diff 太长，会截断并追加：

```text
[diff truncated]
```

## 返回值

工具统一返回：

```ts
type ToolCallResult = {
  content: string
  isError?: boolean
}
```

### 编辑成功

```ts
return {
  content: [
    `Edited ${relativePath}`,
    '',
    formatDiff(relativePath, original, updated)
  ].join('\n')
}
```

示例：

```text
Edited src/index.ts

Index: src/index.ts
...
```

### 输入错误

```ts
return errorResult(`Error: invalid Edit input: ${formatZodError(parsed.error)}`)
```

### 匹配数量错误

```ts
return errorResult(`Error: expected exactly 1 match, got ${matches}`)
```

### 执行异常

```ts
return errorResult(`Error running Edit: ${formatError(error)}`)
```

常见异常：

```text
文件不存在
路径逃出 workspace
文件读取失败
文件写入失败
```

## 一次完整调用示例

假设 workspace：

```text
workspace/
  src/
    index.ts
```

文件内容：

```ts
const value = "old"
console.log(value)
```

调用：

```ts
const result = await editTool.call(
  {
    file_path: 'src/index.ts',
    old_string: 'const value = "old"',
    new_string: 'const value = "new"'
  },
  { cwd: workspaceRoot }
)
```

执行过程：

```text
1. 校验 file_path / old_string / new_string。
2. 解析 src/index.ts，确认它在 workspace 内。
3. 检查它是文件且大小不超过限制。
4. 读取原始内容。
5. countOccurrences() 返回 1。
6. replace() 生成新内容。
7. writeFile() 写回文件。
8. createTwoFilesPatch() 生成 diff。
9. 返回 Edited src/index.ts 和 diff。
```

## 测试覆盖

`test/tools/edit/count-occurrences.test.ts` 覆盖：

```text
统计普通非重叠匹配
缺失字符串返回 0
空 search 返回 0
不统计重叠匹配
```

`test/tools/edit/index.test.ts` 覆盖：

```text
默认禁用，QING_ENABLE_WRITE_TOOLS=1 时启用
成功替换唯一字符串
返回 diff
old_string 为空返回错误
old_string 不存在返回错误
old_string 多次出现返回错误
workspace 外路径被拒绝
文件不存在返回错误
```

`test/tools/registry.test.ts` 覆盖：

```text
Edit 注册到 allTools
findToolByName('Edit') 能找到工具
默认 getToolsApiParams() 不包含 Edit
```

## 与 Agent Loop 的关系

`Edit` 工具只负责本地执行。

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

`Edit` 虽然注册在：

```text
src/tools/registry.ts
```

但默认不会暴露给模型。

只有设置：

```env
QING_ENABLE_WRITE_TOOLS=1
```

它才会进入 Anthropic tools 参数。
