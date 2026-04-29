# Step 5：核心工具正式集成计划

`learn/step5.js` 展示了 6 个核心工具：

```text
Read / Write / Edit / Grep / Glob / Bash
```

正式项目当前已经完成：

```text
Read
```

还没有实现：

```text
Grep
Glob
Write
Edit
Bash
```

本文件说明：

```text
1. 当前项目已经覆盖了哪些能力。
2. 哪些工具可以优先集成。
3. 哪些工具必须等权限和安全设计完成后再做。
4. 如果要集成，每个工具应该放在哪些文件里，怎么测试。
```

## 当前项目状态

### 已有工具基础设施

正式项目已有：

```text
src/tools/types.ts
src/tools/registry.ts
src/agent/agent-loop.ts
src/agent/tool-results.ts
```

工具契约：

```ts
export type AgentTool = {
  name: string
  description: string
  inputSchema: ToolInputSchema
  isReadOnly(): boolean
  isEnabled(context?: ToolContext): boolean
  call(input: JsonObject, context: ToolContext): Promise<ToolCallResult>
}
```

这和 `learn/step5.js` 的工具形状一致。

所以新增工具时，不需要改 agent loop。

新增工具主要做三件事：

```text
1. 在 src/tools/<tool-name>/ 下实现工具。
2. 在 src/tools/registry.ts 注册工具。
3. 为工具补测试。
```

### 已有 `Read`

正式项目已有：

```text
src/tools/read/index.ts
src/tools/read/workspace-path.ts
src/tools/read/line-numbers.ts
```

它比 `learn/step5.js` 的 `Read` 更完整：

```text
Zod 运行时输入校验
offset / limit
行号格式化
realpath 路径防护
symlink 逃逸防护
错误包装
测试覆盖
```

所以 Step 5 不需要重做 `Read`。

## 推荐集成顺序

建议不要一次性把 5 个新工具全加进正式项目。

推荐顺序：

```text
1. Glob
2. Grep
3. Edit
4. Write
5. Bash
```

原因：

```text
Glob / Grep
  只读，风险低，能显著提升模型定位文件和代码的能力。

Edit / Write
  会修改文件，需要权限确认或至少明确开关。

Bash
  风险最高，需要超时、输出截断、进程控制和用户确认。
```

如果严格控制风险，第一阶段只做：

```text
Glob + Grep
```

这是最合理的 Step 5 正式落地范围。

## 路径安全复用策略

当前路径安全函数在：

```text
src/tools/read/workspace-path.ts
```

它目前属于 Read 工具内部。

Step 5 如果新增 `Glob`、`Grep`、`Write`、`Edit`，路径安全会被多个工具复用。

建议把它提升为共享模块：

```text
src/tools/workspace-path.ts
```

迁移方式：

```text
从 src/tools/read/workspace-path.ts
移动到 src/tools/workspace-path.ts
```

然后更新：

```text
src/tools/read/index.ts
test/tools/read/workspace-path.test.ts
```

也可以先保留原文件，再从新文件 re-export：

```ts
export { resolveWorkspacePath } from '../workspace-path.js'
```

这样迁移风险更低。

### 读路径和写路径要区分

当前 `resolveWorkspacePath()` 使用：

```ts
fs.realpath(candidatePath)
```

这适合读取已存在文件。

但是 `Write` 可能要写入不存在的文件：

```text
notes/new-file.md
```

不存在的目标文件无法 `realpath()`。

所以正式项目应该拆成两个函数：

```ts
resolveExistingWorkspacePath(filePath, cwd)
resolveNewWorkspacePath(filePath, cwd)
```

建议：

```text
Read / Grep
  使用 resolveExistingWorkspacePath。

Write
  使用 resolveNewWorkspacePath，校验父目录 realpath 在 workspace 内。

Edit
  使用 resolveExistingWorkspacePath。
```

## 第一阶段：Glob 工具

### 目标

让模型可以按 glob 找文件。

示例：

```json
{
  "pattern": "*.ts",
  "path": "src"
}
```

返回：

```text
src/index.ts
src/llm/stream-message.ts
...
```

### 建议文件结构

```text
src/tools/glob/
  index.ts

test/tools/glob/
  index.test.ts
```

### 工具 schema

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

### 运行时校验

使用 Zod：

```ts
const globInputValidator = z
  .object({
    pattern: z.string().min(1),
    path: z.string().min(1).optional().default('.'),
    limit: z.number().int().min(1).max(500).optional().default(200)
  })
  .strict()
```

### 执行方式

可以沿用学习版：

```ts
rg --files -g <pattern>
```

但要加：

```text
limit
错误处理
输出排序
rg 不存在时的错误提示
```

### 测试覆盖

```text
找到匹配文件
没有匹配时返回 No files matched
path 默认为 .
limit 限制输出数量
workspace 外路径被拒绝
无效 input 返回 isError
rg 不存在或执行失败返回 isError
```

## 第二阶段：Grep 工具

### 目标

让模型可以搜索文件内容。

示例：

```json
{
  "pattern": "runAgentTurn",
  "path": "src",
  "limit": 100
}
```

返回：

```text
src/agent/agent-loop.ts:38:export async function* runAgentTurn(...)
```

### 建议文件结构

```text
src/tools/grep/
  index.ts

test/tools/grep/
  index.test.ts
```

### schema

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
      maximum: 500,
      description: 'Maximum number of matching lines to return.'
    }
  },
  required: ['pattern'],
  additionalProperties: false
} satisfies ToolInputSchema
```

### 执行方式

可以调用：

```text
rg -n <pattern> <targetPath>
```

建议加：

```text
--hidden 是否启用要谨慎
默认排除 node_modules / dist / .git
limit 输出行数
最大输出字符数
```

### 错误处理

`rg` 退出码语义：

```text
0
  找到匹配。

1
  没有匹配。

其他
  执行错误。
```

正式实现不应该把所有错误都当成 `No matches found`。

### 测试覆盖

```text
找到匹配行
没有匹配
path 默认为 .
limit 生效
workspace 外路径被拒绝
无效 pattern 返回错误
rg 执行失败返回 isError
```

## 第三阶段：Edit 工具

### 目标

让模型可以替换文件中的唯一字符串。

### 为什么先于 Write

`Edit` 的变更范围更小：

```text
必须基于已有文件
必须匹配唯一 old_string
只替换一处
```

比直接覆盖整个文件的 `Write` 更可控。

### 必须补的安全策略

正式项目集成 `Edit` 前，至少需要：

```text
old_string 不能为空
old_string 必须出现一次
文件必须存在
文件大小限制
路径必须在 workspace 内
返回编辑摘要
最好返回 diff
```

如果没有权限确认 UI，建议先默认禁用：

```ts
isEnabled() {
  return process.env.QING_ENABLE_WRITE_TOOLS === '1'
}
```

### 建议文件结构

```text
src/tools/edit/
  index.ts
  count-occurrences.ts

test/tools/edit/
  index.test.ts
  count-occurrences.test.ts
```

### 测试覆盖

```text
成功替换唯一字符串
old_string 为空返回错误
old_string 不存在返回错误
old_string 多次出现返回错误
workspace 外路径被拒绝
文件不存在返回错误
写入结果正确
```

## 第四阶段：Write 工具

### 目标

让模型可以创建或覆盖文件。

### 风险

`Write` 可以覆盖任何 workspace 内文件。

正式集成前必须决定：

```text
是否允许覆盖已有文件
是否需要用户确认
是否需要展示 diff
是否限制文件大小
是否只允许写入某些目录
```

### 推荐初始策略

如果没有权限确认 UI：

```text
默认禁用 Write。
只有 QING_ENABLE_WRITE_TOOLS=1 时启用。
```

并且初始版本可以只允许创建新文件，不允许覆盖：

```text
如果目标文件存在，返回 isError。
```

这样比学习版直接覆盖更安全。

### 建议文件结构

```text
src/tools/write/
  index.ts

test/tools/write/
  index.test.ts
```

### 测试覆盖

```text
创建新文件
自动创建父目录
目标文件已存在时拒绝或按策略处理
workspace 外路径被拒绝
无效 input 返回 isError
禁用时不出现在 API params
```

## 第五阶段：Bash 工具

### 目标

让模型可以执行 shell 命令。

### 为什么最后做

`Bash` 风险最高。

它可以：

```text
删除文件
修改 git 状态
访问网络
读取环境变量
启动长时间运行进程
输出大量内容
```

学习版只是演示模式，不适合直接进正式项目。

### 必须设计的能力

正式集成前至少需要：

```text
用户确认
命令超时
stdout/stderr 最大长度
进程 kill
工作目录限制
环境变量白名单或过滤
Windows shell 策略
危险命令提示
测试不执行真实破坏性命令
```

### Windows 兼容

学习版使用：

```js
spawn(process.env.SHELL || 'bash', ['-lc', input.command], ...)
```

当前项目开发环境是 PowerShell。

正式实现要么：

```text
明确只支持 bash
```

要么按平台选择：

```ts
if (process.platform === 'win32') {
  shell = 'powershell.exe'
  args = ['-NoProfile', '-Command', input.command]
} else {
  shell = process.env.SHELL || 'bash'
  args = ['-lc', input.command]
}
```

### 建议先不实现

在没有权限确认 UI 前，不建议实现 Bash。

## registry 集成方式

新增工具后，统一在：

```text
src/tools/registry.ts
```

注册：

```ts
import { globTool } from './glob/index.js'
import { grepTool } from './grep/index.js'
import { readTool } from './read/index.js'

export const allTools: AgentTool[] = [readTool, globTool, grepTool]
```

测试要更新：

```text
test/tools/registry.test.ts
```

覆盖：

```text
findToolByName('Glob')
findToolByName('Grep')
disabled tools 不出现在 getToolsApiParams
API params 不包含 call/isReadOnly/isEnabled
```

## REPL 集成方式

理论上新增工具后，REPL 不需要改。

原因：

```text
REPL 调用 runAgentTurn()
runAgentTurn() 使用 allTools
getToolsApiParams() 把 allTools 暴露给模型
```

只要工具注册到 `allTools`，模型就能看到。

如果新增写入类工具，REPL 可能需要新增权限确认能力。

这属于后续设计，不应该混进只读工具阶段。

## 推荐的 Step 5 正式范围

如果现在要从 Step 5 学习文件开始正式落代码，建议只做：

```text
Glob
Grep
```

验收标准：

```text
npm run typecheck 通过
npm run lint 通过
npm run test 通过
REPL 中模型可以先 Glob/Grep，再 Read 文件
不会修改任何文件
不会执行任意 shell 命令
```

暂不做：

```text
Write
Edit
Bash
```

原因：

```text
它们需要权限确认和更复杂的安全策略。
```

## 最终判断

`learn/step5.js` 对正式项目的价值是：

```text
提供核心工具的最小教学实现。
```

正式项目当前不应该一次性照搬全部工具。

建议路线：

```text
Step 5A：共享路径工具 + Glob + Grep
Step 5B：权限确认设计
Step 5C：Edit
Step 5D：Write
Step 5E：Bash
```

这样能保持项目每一步都可测试、可回滚、风险清晰。

