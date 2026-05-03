# Step 6：动态 System Prompt 正式集成计划

`learn/step6.js` 展示了动态组装 system prompt 的模式：

```text
静态角色定义 + 运行时环境信息 + 项目记忆（AGENT.md）
```

正式项目当前状态：

```text
system 参数的传递链路已经完整。
但没有任何代码构建 system prompt。
模型收到的请求里没有 system 字段。
```

本文件说明如何把 Step 6 的能力正式集成到项目中。

## 当前项目状态

### 已有的传递链路

```text
src/cli/repl.ts
  → runAgentTurn({ ..., system })
    → runModelTurn({ ..., system })
      → streamMessage({ ..., system })
        → client.messages.stream({ ..., system })
```

每一层都支持 `system?: string`，但 `src/index.ts` 从未传入。

所以集成 Step 6 不需要改 agent loop 或 LLM 层。

只需要在 REPL 层或入口层构建 system prompt，然后传进去。

### 已有的类型支持

`StreamMessageInput` 已经有：

```ts
system?: string
```

`RunAgentTurnInput` 已经有：

```ts
system?: string
```

不需要新增类型。

## 集成范围

### 要做的事

```text
1. 新建 src/prompt/ 模块，负责构建 system prompt。
2. 在 src/cli/repl.ts 或 src/index.ts 调用构建函数。
3. 单元测试。
```

### 不做的事

```text
1. 不改 agent loop。
2. 不改 LLM 层。
3. 不改工具层。
4. 不做 prompt 缓存（后续优化）。
5. 不做 AGENT.md 长度截断（后续优化）。
```

## 模块设计

### 建议文件结构

```text
src/prompt/
  build-system-prompt.ts    # 核心构建函数
  git-info.ts               # git 信息获取
  agent-md.ts               # AGENT.md 读取

test/prompt/
  build-system-prompt.test.ts
  git-info.test.ts
  agent-md.test.ts
```

为什么要拆三个文件？

```text
build-system-prompt.ts
  组装逻辑，依赖 git-info 和 agent-md。

git-info.ts
  获取 git 分支和状态，依赖 child_process。

agent-md.ts
  读取 AGENT.md，依赖 fs。
```

拆开后每个模块职责单一，测试方便。

`git-info.ts` 和 `agent-md.ts` 都是 I/O 操作，mock 容易。

## 类型设计

### `BuildSystemPromptInput`

```ts
export type BuildSystemPromptInput = {
  cwd: string
  additionalInstructions?: string
}
```

和学习版一致。

### `GitInfo`

```ts
export type GitInfo = {
  branch: string
  status: string
}
```

从 `getGitSection` 拆出来的结构化返回值。

## 模块一：`src/prompt/git-info.ts`

### 功能

获取当前 git 分支和工作区状态。

### 接口

```ts
export async function getGitInfo(cwd: string): Promise<GitInfo | null>
```

返回 `null` 表示 git 不可用（不在 git 仓库、git 未安装）。

### 实现要点

```text
使用 execFileAsync('git', ...)，和学习版一致。
Promise.all 并行执行两个 git 命令。
catch 返回 null，不抛错。
```

和学习版的区别：

```text
学习版返回格式化字符串。
正式版返回结构化对象。
格式化交给 build-system-prompt.ts。
```

为什么要结构化？

```text
测试更方便：直接比较对象字段。
复用性更强：其他模块如果需要分支名，可以直接用。
格式化职责分离：prompt 构建器决定怎么拼字符串。
```

### 测试覆盖

```text
正常返回 git 信息
不在 git 仓库时返回 null
git 命令执行失败时返回 null
```

## 模块二：`src/prompt/agent-md.ts`

### 功能

读取 workspace 根目录下的 AGENT.md 文件。

### 接口

```ts
export async function readAgentMd(cwd: string): Promise<string | null>
```

返回 `null` 表示文件不存在。

### 实现要点

```text
使用 fs.readFile 读取 cwd/AGENT.md。
文件不存在时 catch 返回 null。
返回原始内容，不加前缀。
```

和学习版的区别：

```text
学习版返回 '# Source: ' + filePath + '\n' + content。
正式版返回原始内容或 null。
Source 前缀由 build-system-prompt.ts 决定。
```

为什么返回 null 而不是空字符串？

```text
null 明确表示"文件不存在"。
空字符串可能是"文件存在但内容为空"。
调用方可以根据 null 决定是否跳过整个 AGENT.md 段。
```

### 测试覆盖

```text
文件存在时返回内容
文件不存在时返回 null
文件为空时返回空字符串
路径安全：不读取 workspace 外的文件
```

## 模块三：`src/prompt/build-system-prompt.ts`

### 功能

组装完整的 system prompt 字符串。

### 接口

```ts
export async function buildSystemPrompt(
  input: BuildSystemPromptInput
): Promise<string>
```

### 实现要点

staticSection 写死：

```ts
const staticSection = [
  '<SYSTEM_STATIC_CONTEXT>',
  'You are Qing Agent, a terminal-native coding assistant.',
  'Be concise, practical, and action-oriented.',
  'Prefer specialized tools before using Bash.',
  'Understand the code before changing it.',
  '</SYSTEM_STATIC_CONTEXT>'
].join('\n')
```

注意把 `Easy Agent` 改成 `Qing Agent`，和项目名一致。

dynamicSection 动态构建：

```ts
const parts: string[] = []

parts.push('- Current working directory: ' + cwd)
parts.push('- Current date: ' + new Date().toISOString())
parts.push('- OS: ' + os.platform() + ' ' + os.release() + ' (' + os.arch() + ')')

const gitInfo = await getGitInfo(cwd)
if (gitInfo) {
  parts.push('- Git branch: ' + gitInfo.branch)
  parts.push('- Git status:\n' + (gitInfo.status || 'clean'))
} else {
  parts.push('- Git: not available')
}

if (additionalInstructions) {
  parts.push('- Session instructions:\n' + additionalInstructions)
}

const agentMd = await readAgentMd(cwd)
if (agentMd) {
  parts.push('# Source: ' + path.join(cwd, 'AGENT.md') + '\n' + agentMd)
}

return [
  staticSection,
  '<SYSTEM_DYNAMIC_CONTEXT>',
  parts.join('\n\n'),
  '</SYSTEM_DYNAMIC_CONTEXT>'
].join('\n\n')
```

### 和学习版的区别

```text
1. 使用结构化的 getGitInfo() 而不是 getGitSection()。
2. 使用 readAgentMd() 返回 null 的语义，而不是空字符串。
3. 前缀拼接逻辑集中在这里，而不是分散在各个辅助函数里。
4. 用 parts 数组而不是 inline 数组 + .filter(Boolean)，更清晰。
```

### 测试覆盖

```text
包含 staticSection
包含 cwd
包含当前日期
包含 OS 信息
包含 git 信息（正常情况）
包含 Git: not available（git 不可用时）
包含 additionalInstructions（有值时）
不包含 additionalInstructions（无值时）
包含 AGENT.md 内容（文件存在时）
不包含 AGENT.md（文件不存在时）
各段之间用正确的分隔符连接
```

## REPL 集成方式

### 方案：在 `runRepl` 内部构建

修改 `src/cli/repl.ts`：

```ts
import { buildSystemPrompt } from '../prompt/build-system-prompt.js'

export async function runRepl(options?: RunReplOptions) {
  const cwd = process.cwd()
  const system = await buildSystemPrompt({ cwd })

  // ... 现有逻辑，把 system 传给 runAgentTurn
}
```

### 为什么不改 `src/index.ts`？

```text
index.ts 是入口，职责应该是"启动"，不应该包含 prompt 构建逻辑。
runRepl 是 REPL 的主函数，它知道 cwd 是什么。
system prompt 是 REPL 的运行时需求，放在 repl.ts 更内聚。
```

### `runRepl` 的签名变化

当前：

```ts
export async function runRepl(options?: RunReplOptions)
```

可以不变，因为 `runRepl` 内部自己构建 system prompt。

如果未来需要从外部传入 system prompt（比如测试），可以扩展：

```ts
export type RunReplOptions = {
  system?: string  // 可选，外部传入则不自动构建
}
```

但初始版本不需要，直接在内部构建即可。

## 实现顺序

```text
1. src/prompt/git-info.ts + test/prompt/git-info.test.ts
2. src/prompt/agent-md.ts + test/prompt/agent-md.test.ts
3. src/prompt/build-system-prompt.ts + test/prompt/build-system-prompt.test.ts
4. 修改 src/cli/repl.ts 集成
5. 端到端验证
```

为什么这个顺序？

```text
git-info 和 agent-md 是独立的底层模块，没有依赖。
build-system-prompt 依赖前两个。
repl.ts 集成依赖 build-system-prompt。
最后端到端验证整体效果。
```

## 验收标准

```text
npm run typecheck 通过
npm run lint 通过
npm run test 通过
REPL 启动后，模型能看到 system prompt
system prompt 包含 cwd、日期、OS、git 信息
没有 AGENT.md 时不影响功能
不在 git 仓库时不影响功能
```

## 后续优化（不在本次范围）

```text
1. Prompt 缓存
   每轮对话都重新构建 system prompt，但 staticSection 不变。
   可以缓存 staticSection，只重建 dynamicSection。
   甚至 dynamicSection 中的 OS 信息也不会变，可以进一步拆分。

2. AGENT.md 长度控制
   AGENT.md 可能很大，直接塞进 system prompt 会占用大量 token。
   需要截断策略或摘要机制。

3. 多记忆文件支持
   除了 AGENT.md，可能还需要支持 .agent/ 目录下的多个文件。
   类似 Claude Code 的 memory 系统。

4. 自定义角色定义
   staticSection 写死了角色定义。
   可能需要支持用户自定义角色。

5. System prompt 的 structured output
   当前用纯文本拼接。
   Anthropic API 支持 system prompt 使用 content block 数组。
   可以用 [{ type: 'text', text: '...' }] 格式，支持 cache_control。
```

## 文件变更清单

### 新增文件

```text
src/prompt/build-system-prompt.ts
src/prompt/git-info.ts
src/prompt/agent-md.ts
test/prompt/build-system-prompt.test.ts
test/prompt/git-info.test.ts
test/prompt/agent-md.test.ts
```

### 修改文件

```text
src/cli/repl.ts   引入 buildSystemPrompt，传入 system 参数
```

### 不变的文件

```text
src/agent/agent-loop.ts    已支持 system 参数
src/llm/stream-message.ts  已支持 system 参数
src/llm/types.ts           已有 system 类型定义
src/tools/*                工具层不受影响
```
