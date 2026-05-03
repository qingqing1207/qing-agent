# Step 6：`learn/step6.js` 解读

`learn/step6.js` 解决的问题是：**如何动态组装 system prompt**。

前面的 step 里，system prompt 要么写死，要么直接传一个字符串给 API。

但一个真正的 coding agent 需要的 system prompt 不是静态的。

它需要包含：

```text
1. 稳定的角色定义（不变）
2. 运行时环境信息（每次对话都不同）
3. 项目记忆（AGENT.md，可选）
```

Step 6 就是把这三层拆开，再拼成一个完整的 system prompt。

## 整体结构

文件顶部导入：

```js
import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
```

用途：

```text
os        获取操作系统信息（platform, release, arch）
fs        读取 AGENT.md 文件
path      拼接文件路径
execFile  执行 git 命令
promisify 把 callback 风格的 execFile 转成 Promise
```

```js
const execFileAsync = promisify(execFile)
```

用于异步调用 git 命令。

## 核心函数：`readAgentMd(cwd)`

源码：

```js
async function readAgentMd(cwd) {
  const filePath = path.join(cwd, 'AGENT.md')
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return '# Source: ' + filePath + '\n' + content.trim()
  } catch {
    return ''
  }
}
```

功能：

```text
读取 workspace 根目录下的 AGENT.md 文件。
如果文件不存在，返回空字符串。
```

返回格式：

```text
# Source: /path/to/AGENT.md
（文件内容）
```

为什么用 `# Source:` 前缀？

```text
让模型知道这段内容来自哪里。
如果用户有多个 workspace，模型能区分不同项目的记忆。
```

为什么 catch 不抛错？

```text
AGENT.md 是可选的。
不存在时不应该阻止 system prompt 的构建。
返回空字符串，后续 .filter(Boolean) 会把它过滤掉。
```

## 核心函数：`getGitSection(cwd)`

源码：

```js
async function getGitSection(cwd) {
  try {
    const [branch, status] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }),
      execFileAsync('git', ['status', '--short'], { cwd })
    ])

    return [
      '- Git branch: ' + branch.stdout.trim(),
      '- Git status:\n' + (status.stdout.trim() || 'clean')
    ].join('\n')
  } catch {
    return '- Git: not available'
  }
}
```

功能：

```text
获取当前 git 分支和工作区状态。
```

两个 git 命令：

```text
git rev-parse --abbrev-ref HEAD
  获取当前分支名，例如 main、feat/step6。

git status --short
  获取工作区变更摘要，例如：
  M src/index.ts
  ?? docs/step6/
```

为什么用 `Promise.all`？

```text
两个 git 命令互相独立。
并行执行可以减少等待时间。
```

输出示例：

```text
- Git branch: main
- Git status:
M src/index.ts
```

如果没有变更：

```text
- Git branch: main
- Git status:
clean
```

如果不在 git 仓库里：

```text
- Git: not available
```

为什么 catch 返回默认值？

```text
有些目录不是 git 仓库。
不应该因为 git 不可用就阻止 system prompt 构建。
```

## 核心函数：`buildSystemPrompt({ cwd, additionalInstructions })`

源码：

```js
export async function buildSystemPrompt({ cwd, additionalInstructions = '' }) {
  const staticSection = [
    '<SYSTEM_STATIC_CONTEXT>',
    'You are Easy Agent, a terminal-native coding assistant.',
    'Be concise, practical, and action-oriented.',
    'Prefer specialized tools before using Bash.',
    'Understand the code before changing it.',
    '</SYSTEM_STATIC_CONTEXT>'
  ].join('\n')

  const dynamicSection = [
    '<SYSTEM_DYNAMIC_CONTEXT>',
    '- Current working directory: ' + cwd,
    '- Current date: ' + new Date().toISOString(),
    '- OS: ' + os.platform() + ' ' + os.release() + ' (' + os.arch() + ')',
    await getGitSection(cwd),
    additionalInstructions ? '- Session instructions:\n' + additionalInstructions : '',
    await readAgentMd(cwd),
    '</SYSTEM_DYNAMIC_CONTEXT>'
  ]
    .filter(Boolean)
    .join('\n\n')

  return staticSection + '\n\n' + dynamicSection
}
```

这是整个文件的入口函数。

### 输入

```js
{
  cwd: '/Users/me/project',           // 必填，当前工作目录
  additionalInstructions: 'Be careful' // 可选，会话级额外指令
}
```

### 输出

一个拼好的 system prompt 字符串。

### 两段结构

函数把 system prompt 分成两段：

```text
staticSection   稳定的角色定义，不会随对话变化
dynamicSection  运行时上下文，每次调用都重新生成
```

### staticSection 解读

```text
<SYSTEM_STATIC_CONTEXT>
You are Easy Agent, a terminal-native coding assistant.
Be concise, practical, and action-oriented.
Prefer specialized tools before using Bash.
Understand the code before changing it.
</SYSTEM_STATIC_CONTEXT>
```

这段内容是写死的。

作用：

```text
定义 agent 的身份和行为准则。
用 XML 标签包裹，方便模型识别边界。
```

### dynamicSection 解读

```text
<SYSTEM_DYNAMIC_CONTEXT>
- Current working directory: /Users/me/project
- Current date: 2026-05-03T10:30:00.000Z
- OS: darwin 24.6.0 (arm64)
- Git branch: main
- Git status:
M src/index.ts

- Session instructions:
Be careful

# Source: /Users/me/project/AGENT.md
项目特定的上下文信息...
</SYSTEM_DYNAMIC_CONTEXT>
```

这段内容每次调用都会重新生成。

包含的信息：

```text
cwd
  当前工作目录。模型需要知道它在操作哪个项目。

当前日期
  让模型知道今天是什么时候。
  处理时间相关问题时有用。

OS 信息
  platform + release + arch。
  让模型知道运行环境是 macOS / Linux / Windows。
  写 shell 命令时需要参考。

Git 信息
  分支名 + 工作区状态。
  让模型知道当前在哪个分支，有没有未提交的改动。

Session instructions（可选）
  用户传入的会话级额外指令。
  空字符串时被 .filter(Boolean) 过滤掉。

AGENT.md 内容（可选）
  项目特定的记忆文件。
  不存在时返回空字符串，被过滤掉。
```

### `.filter(Boolean)` 的作用

```js
.filter(Boolean)
```

`dynamicSection` 是一个数组。

有些元素可能是空字符串：

```text
additionalInstructions 为空时，那一行是 ''
readAgentMd 找不到文件时，返回 ''
```

`.filter(Boolean)` 把所有 falsy 值（空字符串、null、undefined）过滤掉。

这样拼出来不会有空行。

### 最终拼接

```js
return staticSection + '\n\n' + dynamicSection
```

两段之间用两个换行符分隔。

最终输出示例：

```text
<SYSTEM_STATIC_CONTEXT>
You are Easy Agent, a terminal-native coding assistant.
Be concise, practical, and action-oriented.
Prefer specialized tools before using Bash.
Understand the code before changing it.
</SYSTEM_STATIC_CONTEXT>

<SYSTEM_DYNAMIC_CONTEXT>
- Current working directory: /Users/me/project
- Current date: 2026-05-03T10:30:00.000Z
- OS: darwin 24.6.0 (arm64)
- Git branch: main
- Git status:
M src/index.ts
</SYSTEM_DYNAMIC_CONTEXT>
```

## 设计模式总结

Step 6 的核心设计模式是：

```text
静态 + 动态 = 完整 system prompt
```

| 部分 | 内容 | 是否变化 |
| --- | --- | --- |
| staticSection | 角色定义、行为准则 | 不变 |
| dynamicSection | cwd、日期、OS、git、AGENT.md | 每次调用重新生成 |

这种拆分的好处：

```text
1. 稳定指令可以集中管理，改一处生效。
2. 运行时信息自动注入，不需要手动拼。
3. AGENT.md 作为可选的记忆层，让用户自定义项目上下文。
4. 每个部分独立失败，不影响其他部分（git 不可用、AGENT.md 不存在都不会崩）。
```

## 学习样例的局限

这个学习版能工作，但正式项目需要注意：

```text
1. buildSystemPrompt 是 async 函数，但实际 I/O 只有 fs.readFile 和两个 git 命令。
   正式项目可能需要缓存或节流，避免每轮对话都重新读文件和执行 git。

2. AGENT.md 的路径写死了 cwd + 'AGENT.md'。
   正式项目可能需要支持自定义路径，或者支持多个记忆文件。

3. 没有 system prompt 的长度控制。
   AGENT.md 可能很大，直接塞进 system prompt 会占用大量 token。
   正式项目需要截断或摘要策略。

4. additionalInstructions 没有格式限制。
   正式项目可能需要结构化的指令格式。

5. 没有测试。
   异步函数 + 文件系统 + 子进程，需要 mock 才能测试。
```

## 和正式项目的关系

当前正式项目：

```text
src/llm/types.ts       有 system?: string 类型定义
src/llm/stream-message.ts  会把 system 传给 Anthropic API
src/agent/agent-loop.ts    会把 system 传给 streamMessage
src/cli/repl.ts        会把 system 传给 runAgentTurn
```

但是：

```text
没有任何代码实际构建 system prompt。
src/index.ts 调用 runRepl() 时没有传 system。
```

也就是说：

```text
管道已经铺好了（system 参数从 REPL 一路传到 API）。
水还没放进去（没有构建 system prompt 的代码）。
```

Step 6 就是要在正式项目里"放水"。
