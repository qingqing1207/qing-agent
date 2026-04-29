# Step 5：核心工具代码解释

本文用于解释 Step 5 正式项目中新增工具的代码。

当前先从 `Glob` 工具开始：

```text
src/tools/glob/index.ts
```

重点不是重复描述工具功能，而是解释代码里用到的 Node.js API、路径处理、递归遍历和 glob 匹配逻辑。

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
    pattern: '*.ts',
    path: 'src',
    limit: 20
  },
  {
    cwd: 'D:\\code\\qing-agent'
  }
)
```

可能输出：

```text
index.ts
llm/types.ts
llm/stream-message.ts
```

注意：返回路径是相对于搜索根目录的路径。

如果搜索根是：

```text
D:\code\qing-agent\src
```

文件是：

```text
D:\code\qing-agent\src\llm\types.ts
```

返回的是：

```text
llm\types.ts
```

在匹配时，代码会把 Windows 的 `\` 统一成 `/`，避免跨平台差异影响 glob 判断。

## 为什么不用 `rg --files`

`learn/step5.js` 里的 `Glob` 用的是：

```js
execFileAsync('rg', ['--files', '-g', input.pattern], { cwd })
```

这依赖本机安装了 ripgrep。

在当前环境里，测试时出现过：

```text
spawn rg ENOENT
```

`ENOENT` 的意思是系统找不到 `rg` 可执行文件。

为了让工具和单元测试在 Windows、CI、没有安装 ripgrep 的机器上稳定运行，当前正式项目的 `Glob` 改成了纯 Node 实现：

```text
fs.readdir() 递归列出文件
path.relative() 生成相对路径
RegExp 判断 glob pattern 是否匹配
```

这个实现覆盖当前 Step 5A 的需求：简单、可测、不依赖外部命令。

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

`Glob` 文件开头：

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { resolveExistingWorkspacePath } from '../workspace-path.js'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'
```

### `node:fs/promises`

```ts
import fs from 'node:fs/promises'
```

这是 Node.js 的文件系统 Promise API。

这里主要用：

```ts
fs.readdir(current, { withFileTypes: true })
```

它用于读取目录内容。

普通用法：

```ts
const names = await fs.readdir('src')
```

返回：

```ts
['index.ts', 'llm', 'cli']
```

当前代码使用了 `withFileTypes: true`：

```ts
const entries = await fs.readdir(current, { withFileTypes: true })
```

这样返回的不是字符串数组，而是 `Dirent[]`。

每个 `Dirent` 可以判断自己是文件还是目录：

```ts
entry.isDirectory()
entry.isFile()
```

示例：

```ts
const entries = await fs.readdir('src', { withFileTypes: true })

for (const entry of entries) {
  console.log(entry.name)
  console.log(entry.isDirectory())
  console.log(entry.isFile())
}
```

这比先拿名字再 `fs.stat()` 更方便，也减少额外文件系统调用。

### `node:path`

```ts
import path from 'node:path'
```

`path` 是 Node.js 的路径处理模块。

当前 `Glob` 用到了：

```ts
path.join()
path.relative()
path.sep
path.basename()
```

这些 API 不直接访问文件系统，只负责字符串层面的路径计算。

### `zod`

```ts
import { z } from 'zod'
```

Zod 不是 Node API，它负责运行时输入校验。

模型传来的工具参数不可信，所以即使已经有 JSON Schema，也要在本地再校验一次。

当前 `Glob` 用它保证：

```text
pattern 必须是非空字符串
path 可选，默认 '.'
limit 可选，默认 200，范围 1 到 500
不允许额外字段
```

## 工具 schema

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

这是给模型看的工具参数说明。

它会被 `getToolsApiParams()` 转成 Anthropic API 的 `input_schema`。

示例：

```ts
{
  name: 'Glob',
  description: 'Find files in the current workspace by glob pattern.',
  input_schema: globToolInputSchema
}
```

注意区分：

```text
globToolInputSchema
  给模型看的 JSON Schema。

globInputValidator
  本地执行前用 Zod 做的运行时校验。
```

## Zod 校验器

```ts
const globInputValidator = z
  .object({
    pattern: z.string().min(1),
    path: z.string().min(1).optional().default('.'),
    limit: z.number().int().min(1).max(500).optional().default(200)
  })
  .strict()
```

属性说明：

```text
pattern
  必须是非空字符串。

path
  可选。
  如果没传，默认是 '.'，也就是 workspace 根目录。

limit
  可选。
  必须是整数。
  最小 1，最大 500。
  默认 200。

strict()
  不允许模型传入 schema 之外的字段。
```

示例：

```ts
globInputValidator.safeParse({ pattern: '*.ts' })
```

结果里的 `data` 会自动补默认值：

```ts
{
  pattern: '*.ts',
  path: '.',
  limit: 200
}
```

无效输入：

```ts
globInputValidator.safeParse({ pattern: '', extra: true })
```

会失败，因为：

```text
pattern 为空
extra 是未知字段
```

工具里不会抛异常，而是返回：

```ts
{
  content: 'Error: invalid Glob input: ...',
  isError: true
}
```

## `globTool` 对象

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
    ...
  }
}
```

### `name`

```ts
name: 'Glob'
```

模型会用这个名字请求工具：

```ts
{
  type: 'tool_use',
  name: 'Glob',
  input: { pattern: '*.ts' }
}
```

### `description`

给模型看的自然语言说明。

模型会根据这个描述判断什么时候调用 `Glob`。

### `inputSchema`

给模型看的参数 schema。

### `isReadOnly()`

```ts
isReadOnly() {
  return true
}
```

表示这个工具不会修改文件、不会执行有副作用操作。

后续如果做权限策略，可以优先允许只读工具自动执行。

### `isEnabled()`

```ts
isEnabled() {
  return true
}
```

表示工具默认启用。

后续如果需要按配置关闭某些工具，可以在这里读取环境变量或上下文。

## `call()` 执行流程

核心代码：

```ts
async call(input: JsonObject, context): Promise<ToolCallResult> {
  const parsed = globInputValidator.safeParse(input)

  if (!parsed.success) {
    return errorResult(`Error: invalid Glob input: ${formatZodError(parsed.error)}`)
  }

  try {
    const searchRoot = await resolveExistingWorkspacePath(parsed.data.path, context.cwd)
    const files = await listFiles(searchRoot)
    const matches = files
      .filter((filePath) => matchesGlob(filePath, parsed.data.pattern))
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

可以分成 5 步：

```text
1. 校验 input。
2. 把 path 解析成 workspace 内真实路径。
3. 递归列出 searchRoot 下所有文件。
4. 用 glob pattern 过滤文件。
5. 排序、limit、格式化输出。
```

### 示例 1：省略 path

输入：

```ts
await globTool.call({ pattern: '*.md' }, { cwd: '/repo' })
```

Zod 补默认值：

```ts
{
  pattern: '*.md',
  path: '.',
  limit: 200
}
```

路径解析：

```ts
resolveExistingWorkspacePath('.', '/repo')
```

搜索根：

```text
/repo
```

如果 `/repo` 下有：

```text
README.md
docs/intro.md
src/index.ts
```

由于 pattern 是 `*.md` 且不包含 `/`，当前实现会按文件名匹配。

匹配结果：

```text
README.md
intro.md  // 如果 docs/intro.md 被递归列出，basename 是 intro.md，也会匹配
```

返回路径仍然是相对 searchRoot 的完整相对路径：

```text
README.md
docs/intro.md
```

### 示例 2：指定 path

输入：

```ts
await globTool.call({ pattern: '*.ts', path: 'src' }, { cwd: '/repo' })
```

搜索根：

```text
/repo/src
```

假设文件：

```text
/repo/src/index.ts
/repo/src/llm/types.ts
/repo/README.md
```

`listFiles('/repo/src')` 返回：

```ts
[
  'index.ts',
  'llm/types.ts'
]
```

`*.ts` 不包含 `/`，所以按 basename 匹配：

```text
index.ts      -> basename 是 index.ts，匹配
llm/types.ts  -> basename 是 types.ts，匹配
```

输出：

```text
index.ts
llm/types.ts
```

### 示例 3：包含目录的 pattern

输入：

```ts
await globTool.call({ pattern: 'llm/*.ts', path: 'src' }, { cwd: '/repo' })
```

文件：

```text
index.ts
llm/types.ts
llm/stream-message.ts
cli/repl.ts
```

pattern 包含 `/`，所以会对完整相对路径匹配：

```text
llm/types.ts           -> 匹配
llm/stream-message.ts  -> 匹配
index.ts               -> 不匹配
cli/repl.ts            -> 不匹配
```

## `resolveExistingWorkspacePath()`

调用：

```ts
const searchRoot = await resolveExistingWorkspacePath(parsed.data.path, context.cwd)
```

它来自：

```text
src/tools/workspace-path.ts
```

作用：

```text
把模型传入的 path 解析成 workspace 内已经存在的真实路径。
```

它会做：

```text
1. fs.realpath(cwd)
2. path.resolve(workspaceRoot, filePath)
3. fs.realpath(candidatePath)
4. 检查真实路径仍然在 workspaceRoot 内
```

为什么要用 `realpath`？

因为符号链接可能逃出 workspace。

例子：

```text
/repo/link -> /Users/me/.ssh
```

如果模型请求：

```ts
{ path: 'link' }
```

普通 `path.resolve()` 会得到：

```text
/repo/link
```

看起来还在 workspace 里。

但 `fs.realpath()` 会得到：

```text
/Users/me/.ssh
```

这时就能发现它逃出了 workspace，并拒绝执行。

## `listFiles()`

源码：

```ts
async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (shouldSkipEntry(entry.name)) {
      continue
    }

    const fullPath = path.join(current, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, fullPath)))
      continue
    }

    if (entry.isFile()) {
      files.push(path.relative(root, fullPath))
    }
  }

  return files
}
```

### 参数：`root`

`root` 是搜索根目录。

它保持不变，用来计算返回路径：

```ts
path.relative(root, fullPath)
```

### 参数：`current`

`current` 是当前正在遍历的目录。

第一次调用时：

```ts
listFiles('/repo/src')
```

等价于：

```ts
listFiles('/repo/src', '/repo/src')
```

递归进入子目录时：

```ts
listFiles('/repo/src', '/repo/src/llm')
```

`root` 仍然是 `/repo/src`，`current` 变成子目录。

### `fs.readdir(current, { withFileTypes: true })`

读取当前目录。

假设目录：

```text
/repo/src
  index.ts
  llm/
```

返回的 `entries` 类似：

```ts
[
  Dirent { name: 'index.ts' },
  Dirent { name: 'llm' }
]
```

然后代码判断：

```ts
entry.isDirectory()
entry.isFile()
```

### `path.join(current, entry.name)`

把当前目录和条目名称拼成完整路径。

示例：

```ts
path.join('/repo/src', 'index.ts')
// '/repo/src/index.ts'

path.join('/repo/src', 'llm')
// '/repo/src/llm'
```

在 Windows 上：

```ts
path.join('D:\\repo\\src', 'index.ts')
// 'D:\\repo\\src\\index.ts'
```

所以不要手写：

```ts
current + '/' + entry.name
```

`path.join()` 会按当前系统使用正确路径分隔符。

### 递归目录

```ts
if (entry.isDirectory()) {
  files.push(...(await listFiles(root, fullPath)))
  continue
}
```

如果是目录，就递归调用 `listFiles()`。

返回值是子目录里的所有文件数组。

`...` 是展开运算符，把子数组展开追加进 `files`。

示例：

```ts
files.push(...['llm/types.ts', 'llm/stream-message.ts'])
```

等价于：

```ts
files.push('llm/types.ts', 'llm/stream-message.ts')
```

### 收集文件

```ts
if (entry.isFile()) {
  files.push(path.relative(root, fullPath))
}
```

如果是文件，就加入结果。

用 `path.relative(root, fullPath)` 的原因是工具结果不应该暴露本机绝对路径。

示例：

```ts
path.relative('/repo/src', '/repo/src/llm/types.ts')
// 'llm/types.ts'
```

Windows 示例：

```ts
path.relative('D:\\repo\\src', 'D:\\repo\\src\\llm\\types.ts')
// 'llm\\types.ts'
```

## `shouldSkipEntry()`

源码：

```ts
function shouldSkipEntry(name: string): boolean {
  return name === '.git' || name === 'node_modules' || name === 'dist'
}
```

作用：

```text
跳过不适合递归搜索的目录。
```

为什么跳过：

```text
.git
  Git 内部对象很多，没必要暴露给模型。

node_modules
  文件数量巨大，会拖慢搜索，也会制造大量噪音。

dist
  构建产物，通常不是用户想让模型阅读的源代码。
```

当前实现只按名称跳过。

也就是说任何层级下叫 `node_modules` 的目录都会跳过。

## `matchesGlob()`

源码：

```ts
function matchesGlob(filePath: string, pattern: string): boolean {
  const normalizedFilePath = filePath.split(path.sep).join('/')
  const normalizedPattern = pattern.split(path.sep).join('/')

  if (!normalizedPattern.includes('/')) {
    return matchesGlobSegment(path.basename(normalizedFilePath), normalizedPattern)
  }

  return globToRegExp(normalizedPattern).test(normalizedFilePath)
}
```

### 路径归一化

```ts
const normalizedFilePath = filePath.split(path.sep).join('/')
const normalizedPattern = pattern.split(path.sep).join('/')
```

为什么要做这个？

Windows 路径分隔符是：

```text
\
```

Linux/macOS 路径分隔符是：

```text
/
```

但 glob pattern 通常使用：

```text
/
```

为了让匹配逻辑跨平台稳定，内部统一成 `/`。

示例：

```ts
// Windows 上
filePath = 'llm\\types.ts'
path.sep = '\\'

filePath.split(path.sep).join('/')
// 'llm/types.ts'
```

### pattern 不包含 `/`

```ts
if (!normalizedPattern.includes('/')) {
  return matchesGlobSegment(path.basename(normalizedFilePath), normalizedPattern)
}
```

如果 pattern 是：

```text
*.ts
```

它没有指定目录。

当前实现会用文件名匹配，而不是完整路径匹配。

示例：

```text
filePath: llm/types.ts
basename: types.ts
pattern: *.ts
匹配
```

这符合常见 `rg --files -g '*.ts'` 的使用直觉：它能匹配任意目录下的 `.ts` 文件。

### pattern 包含 `/`

如果 pattern 是：

```text
llm/*.ts
```

它包含目录信息。

这时用完整相对路径匹配：

```ts
globToRegExp('llm/*.ts').test('llm/types.ts')
```

## `path.basename()`

```ts
path.basename(normalizedFilePath)
```

作用：

```text
取路径最后一段，也就是文件名。
```

示例：

```ts
path.basename('llm/types.ts')
// 'types.ts'

path.basename('src/cli/repl.ts')
// 'repl.ts'
```

这里用于让 `*.ts` 可以匹配任意目录下的 TypeScript 文件。

## `globToRegExp()`

源码：

```ts
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')

  return new RegExp(`^${escaped}$`)
}
```

这个函数把简单 glob pattern 转成正则表达式。

当前支持：

```text
*
  匹配同一目录层级内的任意字符，不跨 /

**
  匹配任意字符，可以跨 /

?
  匹配一个非 / 字符
```

### 第一步：转义正则特殊字符

```ts
.replace(/[.+^${}()|[\]\\]/g, '\\$&')
```

正则里很多字符有特殊含义：

```text
. + ^ $ { } ( ) | [ ] \
```

如果用户 pattern 里出现这些字符，我们通常希望按普通字符理解。

示例：

```ts
pattern = 'file.test.ts'
```

如果不转义，`.` 在正则里表示“任意字符”。

转义后：

```text
file\.test\.ts
```

才表示真正的点号。

`$&` 是 JavaScript replace 里的特殊占位符，表示匹配到的原始字符串。

所以：

```ts
'.'.replace(/[.+^${}()|[\]\\]/g, '\\$&')
// '\\.'
```

### 第二步：处理 `**`

```ts
.replace(/\*\*/g, '.*')
```

`**` 表示可以跨目录匹配。

示例：

```text
**/*.ts
```

转换后大致是：

```text
.*/[^/]*\.ts
```

可以匹配：

```text
src/index.ts
src/llm/types.ts
```

### 第三步：处理 `*`

```ts
.replace(/\*/g, '[^/]*')
```

单个 `*` 表示匹配当前目录层级内的任意字符，但不跨 `/`。

示例：

```text
llm/*.ts
```

可以匹配：

```text
llm/types.ts
```

不能匹配：

```text
llm/sub/types.ts
```

因为中间多了一级 `/`。

### 第四步：处理 `?`

```ts
.replace(/\?/g, '[^/]')
```

`?` 匹配一个非 `/` 字符。

示例：

```text
file?.ts
```

可以匹配：

```text
file1.ts
fileA.ts
```

不能匹配：

```text
file12.ts
```

### 第五步：加 `^` 和 `$`

```ts
return new RegExp(`^${escaped}$`)
```

`^` 表示从字符串开头匹配。

`$` 表示匹配到字符串结尾。

这样 pattern 必须匹配整个路径，而不是路径中的一小段。

示例：

```ts
globToRegExp('*.ts').test('index.ts')
// true

globToRegExp('*.ts').test('index.ts.bak')
// false
```

## 当前 glob 实现的限制

当前实现是够 Step 5A 用的简单 glob，不是完整 glob 引擎。

它不支持：

```text
{js,ts}
[abc]
[a-z]
!(pattern)
extglob
复杂 ignore 规则
```

如果后续需要完整 glob 语义，可以考虑：

```text
1. 引入成熟库，例如 fast-glob / minimatch。
2. 或改回 rg --files，但把命令执行抽象成可注入依赖，避免测试依赖本机安装 rg。
```

当前阶段不建议引入依赖。

## 错误处理

工具统一返回：

```ts
ToolCallResult
```

成功：

```ts
{ content: 'README.md' }
```

失败：

```ts
{ content: 'Error running Glob: ...', isError: true }
```

辅助函数：

```ts
function errorResult(content: string): ToolCallResult {
  return { content, isError: true }
}
```

格式化未知错误：

```ts
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
```

为什么不用 `throw`？

因为 agent loop 期望工具错误能变成 `tool_result` 返回给模型。

如果工具直接抛出，agent loop 虽然也会捕获，但工具内部能给出更明确的错误信息会更好。

## 测试里用到的 Node API

测试文件：

```text
test/tools/glob/index.test.ts
```

导入：

```ts
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
```

### `os.tmpdir()`

```ts
os.tmpdir()
```

返回系统临时目录。

Windows 示例：

```text
C:\Users\<user>\AppData\Local\Temp
```

Linux/macOS 示例：

```text
/tmp
```

测试用它创建隔离 workspace，避免污染真实项目。

### `fs.mkdtemp()`

```ts
tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qing-agent-glob-'))
```

作用：

```text
创建一个唯一临时目录。
```

示例结果：

```text
C:\Users\...\Temp\qing-agent-glob-a1b2c3
```

`mkdtemp` 会在给定 prefix 后追加随机字符。

### `fs.mkdir(..., { recursive: true })`

```ts
await fs.mkdir(path.join(workspaceRoot, 'src', 'llm'), { recursive: true })
```

作用：

```text
递归创建目录。
```

如果中间目录不存在，也会一起创建。

类似：

```text
mkdir -p src/llm
```

### `fs.writeFile()`

```ts
await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# test\n')
```

作用：

```text
创建或覆盖文件，并写入内容。
```

测试用它准备 fixture 文件。

### `fs.rm(..., { recursive: true, force: true })`

```ts
await fs.rm(tempRoot, { recursive: true, force: true })
```

作用：

```text
测试结束后删除整个临时目录。
```

参数含义：

```text
recursive: true
  递归删除目录内容。

force: true
  文件不存在时不报错。
```

这个 API 有破坏性，所以测试里只对 `fs.mkdtemp()` 创建出来的临时目录使用。

## 一次完整调用示例

假设临时 workspace：

```text
workspace/
  README.md
  src/
    index.ts
    llm/
      types.ts
```

调用：

```ts
const result = await globTool.call(
  { pattern: '*.ts', path: 'src', limit: 10 },
  { cwd: workspaceRoot }
)
```

执行步骤：

```text
1. Zod 校验 input。
2. path 默认值不需要补，因为传了 'src'。
3. limit 是 10。
4. resolveExistingWorkspacePath('src', workspaceRoot) 得到真实搜索根。
5. listFiles(searchRoot) 递归得到：
   - index.ts
   - llm/types.ts
6. matchesGlob(filePath, '*.ts') 按 basename 匹配：
   - index.ts -> true
   - llm/types.ts -> true
7. sort()
8. slice(0, 10)
9. join('\n')
```

返回：

```ts
{
  content: 'index.ts\nllm\\types.ts'
}
```

在 Windows 上，`listFiles()` 收集到的路径可能包含 `\`。

测试里用：

```ts
path.join('llm', 'types.ts')
```

来兼容不同平台：

```ts
expect(result.content).toContain(path.join('llm', 'types.ts'))
```

## 后续追加文档建议

后续新增工具时，可以按同样结构追加：

```text
## Grep 工具
  - 用到的 Node API
  - 搜索逻辑
  - 输出限制
  - 测试 fixture

## Edit 工具
  - fs.readFile / fs.writeFile
  - 字符串替换
  - 唯一匹配
  - diff 或摘要

## Write 工具
  - fs.mkdir
  - fs.writeFile
  - 新文件路径安全

## Bash 工具
  - child_process.spawn
  - stdout/stderr stream
  - timeout / kill
```

