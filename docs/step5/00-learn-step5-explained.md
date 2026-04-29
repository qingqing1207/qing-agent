# Step 5：`learn/step5.js` 解读

`learn/step5.js` 是一个把核心工具集中放在单个文件里的教学样例。

它展示了 6 类工具的最小实现模式：

```text
Read
Write
Edit
Grep
Glob
Bash
```

这个文件的重点不是生产级安全，而是让每个工具的基本结构足够短、足够容易看懂。

正式项目不能直接照搬全部实现，尤其是：

```text
Write / Edit / Bash
```

这三类工具有副作用，正式集成前必须设计权限确认、路径安全、超时、输出截断和测试。

## 整体结构

文件顶部导入：

```js
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
```

这些依赖分别用于：

```text
fs/promises
  读取、写入文件，创建目录。

path
  解析 workspace 内路径。

execFile
  执行固定命令，例如 rg。

spawn
  启动 shell，执行 Bash 命令。

promisify
  把 execFile 转成 Promise API。
```

```js
const execFileAsync = promisify(execFile)
```

`Grep` 和 `Glob` 使用它调用 `rg`。

## 共享函数：`resolveWorkspacePath()`

源码：

```js
function resolveWorkspacePath(filePath, cwd) {
  const resolved = path.resolve(cwd, filePath || '.')
  const relative = path.relative(cwd, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside the workspace: ' + filePath)
  }
  return resolved
}
```

作用：

```text
把模型传入的相对路径解析成绝对路径，并防止路径逃出 workspace。
```

例子：

```js
resolveWorkspacePath('src/index.ts', '/repo')
// -> '/repo/src/index.ts'

resolveWorkspacePath('../secret.txt', '/repo')
// -> throw Error
```

这个函数是好起点，但不是生产级实现。

正式项目的 Step 3 `Read` 工具已经用了更强的版本：

```text
src/tools/read/workspace-path.ts
```

正式版本使用 `fs.realpath()`，可以防止符号链接逃逸。

## 共享函数：`countOccurrences()`

源码：

```js
function countOccurrences(text, pattern) {
  let count = 0
  let index = 0
  while (true) {
    index = text.indexOf(pattern, index)
    if (index === -1) return count
    count += 1
    index += pattern.length
  }
}
```

作用：

```text
统计 old_string 在文件内容里出现了几次。
```

`Edit` 工具用它保证替换目标唯一。

为什么要唯一？

```text
如果 old_string 出现 0 次，说明模型给错了上下文。
如果 old_string 出现多次，直接替换可能改错位置。
只有出现 1 次时，替换才足够明确。
```

注意：这个函数有一个教学样例里的边界问题。

如果 `pattern` 是空字符串：

```js
countOccurrences('abc', '')
```

`index += pattern.length` 不会前进，可能无限循环。

正式项目集成 `Edit` 时必须禁止空 `old_string`。

## 工具契约

每个工具都遵循同一形状：

```js
{
  name,
  description,
  inputSchema,
  isReadOnly,
  isEnabled,
  async call(input, context)
}
```

含义：

```text
name
  模型调用工具时使用的名称。

description
  给模型看的工具说明。

inputSchema
  给模型看的 JSON Schema。

isReadOnly
  标记工具是否只读。

isEnabled
  当前上下文是否启用工具。

call
  本地真正执行工具逻辑。
```

这和正式项目里的 `AgentTool` 类型一致：

```text
src/tools/types.ts
```

## `Read` 工具

源码：

```js
export const readTool = {
  name: 'Read',
  description: 'Read file content.',
  inputSchema: {
    type: 'object',
    properties: { file_path: { type: 'string' } },
    required: ['file_path']
  },
  isReadOnly: () => true,
  isEnabled: () => true,
  async call(input, context) {
    const resolved = resolveWorkspacePath(input.file_path, context.cwd)
    const raw = await fs.readFile(resolved, 'utf8')
    return { content: raw }
  }
}
```

功能：

```text
读取 workspace 内文件内容。
```

输入：

```js
{
  file_path: 'src/index.ts'
}
```

输出：

```js
{
  content: '文件内容'
}
```

正式项目已经实现了更完整的 `Read`：

```text
src/tools/read/index.ts
```

正式版本额外支持：

```text
Zod 输入校验
offset / limit
行号格式化
realpath 路径防护
错误结果包装
单元测试
```

## `Write` 工具

源码：

```js
export const writeTool = {
  name: 'Write',
  description: 'Create or overwrite a file.',
  inputSchema: {
    type: 'object',
    properties: { file_path: { type: 'string' }, content: { type: 'string' } },
    required: ['file_path', 'content']
  },
  isReadOnly: () => false,
  isEnabled: () => true,
  async call(input, context) {
    const resolved = resolveWorkspacePath(input.file_path, context.cwd)
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    await fs.writeFile(resolved, input.content, 'utf8')
    return { content: 'Wrote ' + resolved }
  }
}
```

功能：

```text
创建或覆盖文件。
```

输入：

```js
{
  file_path: 'notes/todo.md',
  content: '# Todo\n'
}
```

行为：

```text
1. 解析 workspace 内路径。
2. 自动创建父目录。
3. 覆盖写入文件。
```

这是有副作用工具。

正式项目不能直接开启它，因为模型一旦调用 `Write`，就可以覆盖 workspace 内任何文件。

正式集成前至少需要：

```text
权限确认
路径安全
是否允许覆盖已有文件的策略
写入前 diff 或摘要展示
测试隔离
```

## `Edit` 工具

源码：

```js
export const editTool = {
  name: 'Edit',
  description: 'Replace one unique string inside a file.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' }
    },
    required: ['file_path', 'old_string', 'new_string']
  },
  isReadOnly: () => false,
  isEnabled: () => true,
  async call(input, context) {
    const resolved = resolveWorkspacePath(input.file_path, context.cwd)
    const original = await fs.readFile(resolved, 'utf8')
    const matches = countOccurrences(original, input.old_string)

    if (matches !== 1) {
      return { content: 'Error: expected 1 match, got ' + matches, isError: true }
    }

    const updated = original.replace(input.old_string, input.new_string)
    await fs.writeFile(resolved, updated, 'utf8')
    return { content: 'Edited ' + resolved }
  }
}
```

功能：

```text
在文件中把唯一一段 old_string 替换成 new_string。
```

输入：

```js
{
  file_path: 'src/index.ts',
  old_string: "console.log('old')",
  new_string: "console.log('new')"
}
```

为什么要求唯一匹配：

```text
避免一次替换改到多个位置。
避免模型给出的上下文不够精确。
```

边界：

```text
old_string 为空必须拒绝。
old_string 出现 0 次必须失败。
old_string 出现多次必须失败。
文件编码和换行符需要尽量保持。
```

正式集成前还应该考虑：

```text
是否生成 diff
是否需要用户确认
是否支持 replaceAll
是否限制文件大小
```

## `Grep` 工具

源码：

```js
export const grepTool = {
  name: 'Grep',
  description: 'Search file contents with ripgrep.',
  inputSchema: {
    type: 'object',
    properties: { pattern: { type: 'string' }, path: { type: 'string' } },
    required: ['pattern']
  },
  isReadOnly: () => true,
  isEnabled: () => true,
  async call(input, context) {
    const targetPath = resolveWorkspacePath(input.path || '.', context.cwd)
    try {
      const { stdout } = await execFileAsync('rg', ['-n', input.pattern, targetPath])
      return { content: stdout.trim() || 'No matches found' }
    } catch (error) {
      return { content: (error.stdout || '').trim() || 'No matches found' }
    }
  }
}
```

功能：

```text
用 ripgrep 搜索文件内容。
```

输入：

```js
{
  pattern: 'runAgentTurn',
  path: 'src'
}
```

实际执行：

```text
rg -n runAgentTurn /repo/src
```

特点：

```text
只读工具。
适合让模型快速定位代码。
```

注意点：

```text
rg 不存在时需要清晰错误。
输出可能很大，需要 limit。
pattern 是正则还是普通字符串要明确。
路径仍需 workspace 防护。
```

当前学习版把 `rg` 退出码都当成“可能没结果”处理：

```js
catch (error) {
  return { content: (error.stdout || '').trim() || 'No matches found' }
}
```

生产实现应该区分：

```text
退出码 1：没有匹配
其他错误：命令失败
```

## `Glob` 工具

源码：

```js
export const globTool = {
  name: 'Glob',
  description: 'Find files by glob pattern.',
  inputSchema: {
    type: 'object',
    properties: { pattern: { type: 'string' }, path: { type: 'string' } },
    required: ['pattern']
  },
  isReadOnly: () => true,
  isEnabled: () => true,
  async call(input, context) {
    const cwd = resolveWorkspacePath(input.path || '.', context.cwd)
    const { stdout } = await execFileAsync('rg', ['--files', '-g', input.pattern], { cwd })
    return { content: stdout.trim() || 'No files matched' }
  }
}
```

功能：

```text
按 glob pattern 查找文件。
```

输入：

```js
{
  pattern: '*.ts',
  path: 'src'
}
```

实际执行：

```text
rg --files -g *.ts
```

特点：

```text
只读工具。
适合让模型先找文件，再用 Read 查看内容。
```

注意点：

```text
输出数量要限制。
应该排除 node_modules、dist、.git 等目录。
rg 不存在时需要 fallback 或清晰错误。
```

## `Bash` 工具

源码：

```js
export const bashTool = {
  name: 'Bash',
  description: 'Run a shell command in the workspace.',
  inputSchema: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command']
  },
  isReadOnly: () => false,
  isEnabled: () => true,
  async call(input, context) {
    return new Promise((resolve) => {
      const child = spawn(process.env.SHELL || 'bash', ['-lc', input.command], {
        cwd: context.cwd,
        env: process.env
      })

      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.on('close', (code) => {
        resolve({
          content: ['Exit code: ' + code, 'STDOUT:', stdout, 'STDERR:', stderr].join('\n').trim(),
          isError: code !== 0
        })
      })
    })
  }
}
```

功能：

```text
在 workspace 中执行 shell 命令。
```

输入：

```js
{
  command: 'npm test'
}
```

输出：

```text
Exit code: 0
STDOUT:
...
STDERR:
...
```

这是风险最高的工具。

正式项目不能直接照搬这个版本。

至少需要：

```text
用户确认
命令超时
输出截断
进程终止
环境变量控制
工作目录防护
Windows shell 兼容
危险命令策略
```

当前学习版还有一个 Windows 问题：

```js
spawn(process.env.SHELL || 'bash', ['-lc', input.command], ...)
```

Windows 默认通常没有 `SHELL` 和 `bash`。

正式项目需要根据平台选择 shell，或者先只支持 PowerShell / cmd / Git Bash 中的一种并写清楚约束。

## 6 个工具的分类

| 工具 | 是否只读 | 风险 | 正式项目当前状态 |
| --- | --- | --- | --- |
| Read | 是 | 低 | 已实现 |
| Grep | 是 | 低到中 | 未实现 |
| Glob | 是 | 低 | 未实现 |
| Write | 否 | 高 | 未实现 |
| Edit | 否 | 高 | 未实现 |
| Bash | 否 | 最高 | 未实现 |

## 学习样例的价值

`learn/step5.js` 展示了几个重要模式：

```text
1. 所有工具遵循同一 AgentTool 形状。
2. 只读工具和写入工具可以通过 isReadOnly 区分。
3. 工具参数通过 inputSchema 暴露给模型。
4. 工具执行仍然通过 call(input, context) 完成。
5. 工具错误用 { content, isError: true } 返回，而不是直接崩掉 agent loop。
6. 搜索类工具可以通过 rg 快速实现。
```

正式项目可以沿用这些模式，但不能照搬所有细节。

特别是副作用工具必须先补安全策略，再进入 `src/tools/registry.ts`。

