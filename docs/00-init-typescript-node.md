# Step 0：初始化 TypeScript + Node 项目

这一步的目标是先把项目底座搭好：可以运行 TypeScript、可以做类型检查、可以管理环境变量、可以统一格式化和 lint，并且给后续正式项目代码留出清晰的开发路径。

## 1. 推荐目录结构

当前项目可以按下面的方式组织：

```text
qing-agent/
  docs/                 # 学习记录、设计笔记、每一步总结
  learn/                # 每一步 agent 的最小核心流程，用来学习参考
    step1.js            # 当前已有：最小 LLM streaming client
  src/                  # 正式项目代码，基于 learn 中的核心步骤重新设计和实现
    index.ts            # 项目入口
    config/
    llm/
    utils/
  dist/                 # TypeScript 编译产物，不提交
  package.json
  tsconfig.json
  eslint.config.js
  .prettierrc
  .env
  .env.example
  .gitignore
```

建议规则：

- `learn/` 只放最小核心步骤，用来帮助理解 agent 的关键流程；它不是正式项目代码，也不要求直接翻译成 TypeScript 后放进项目。
- `src/` 才是正式项目代码。开发时应该基于 `learn/` 中验证过的流程重新做模块拆分、类型设计、错误处理和运行时校验。
- `docs/` 记录每一步为什么这么做，而不只是记录命令。

## 2. 初始化 package.json

在项目根目录执行：

```powershell
npm init -y
npm pkg set type="module"
```

`type: "module"` 表示项目默认使用 ESM 语法，也就是：

```ts
import fs from 'node:fs'
export function run() {}
```

后续写 Node.js 新项目时，推荐直接使用 ESM，避免 CommonJS 和 ESM 混用带来的额外心智负担。

## 3. 安装依赖

当前 `learn/step1.js` 已经使用 Anthropic SDK，所以项目依赖可以先这样装：

```powershell
npm install @anthropic-ai/sdk dotenv zod
npm install -D typescript @types/node tsx eslint @eslint/js typescript-eslint globals prettier
```

依赖说明：

- `@anthropic-ai/sdk`：调用 Anthropic Messages API。
- `dotenv`：本地开发时从 `.env` 加载 API Key 等配置。
- `zod`：做环境变量、工具参数、模型输出等运行时校验。
- `typescript`：TypeScript 编译器，负责类型检查和构建。
- `@types/node`：让 TypeScript 认识 `process`、`Buffer`、`node:fs` 等 Node.js API。
- `tsx`：开发阶段直接运行 `.ts` 文件，适合快速学习和调试。
- `eslint` / `prettier`：统一代码质量和格式。

## 4. 配置 TypeScript

生成初始配置：

```powershell
npx tsc --init
```

然后把 `tsconfig.json` 调整为：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "noEmitOnError": true,
    "skipLibCheck": true
  },
  "include": ["learn/**/*.ts", "src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

关键点：

- `strict: true`：从一开始打开严格模式，能更早发现类型问题。
- `module: "NodeNext"`：让 TypeScript 按 Node.js 的 ESM 规则解析模块。
- `rootDir: "."` + `outDir: "dist"`：编译后保留目录结构，例如 `src/index.ts` 会输出到 `dist/src/index.js`。
- `noEmitOnError: true`：类型错误时不输出构建产物。

注意：当前已有的 `learn/step1.js` 不会被这个配置编译。它可以继续作为学习参考保留；正式项目实现应该放在 `src/` 中，而不是把 `learn/step1.js` 逐行翻译成 TypeScript。

## 5. 配置 npm scripts

把 `package.json` 中的 `scripts` 调整为：

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "start": "node dist/src/index.js",
    "lint": "eslint .",
    "format": "prettier --write .",
    "check": "npm run typecheck && npm run lint"
  }
}
```

使用方式：

```powershell
npm run dev        # 开发时运行正式项目入口
npm run typecheck  # 只做类型检查，不生成 dist
npm run build      # 编译到 dist
npm run start      # 运行编译后的 JS
npm run check      # 提交前检查
```

`tsx` 负责“快速运行”，但它不负责类型检查；类型检查仍然交给 `tsc --noEmit`。

如果想单独运行某个学习样例，可以额外加一个 `learn:*` 脚本，而不是把它作为正式项目入口：

```json
{
  "scripts": {
    "learn:step1": "tsx learn/step1.js"
  }
}
```

## 6. 配置环境变量

新建 `.env.example`：

```env
ANTHROPIC_AUTH_TOKEN=
ANTHROPIC_BASE_URL=
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

本地开发时复制一份 `.env`：

```powershell
Copy-Item .env.example .env
```

`.env` 里放真实密钥，不要提交到仓库。

后续可以在 `src/config/env.ts` 中集中校验环境变量：

```ts
import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  ANTHROPIC_AUTH_TOKEN: z.string().min(1, 'ANTHROPIC_AUTH_TOKEN is required'),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514')
})

export const env = envSchema.parse(process.env)
```

然后业务代码不要到处直接读 `process.env`，统一从 `env` 取：

```ts
import { env } from '../config/env.js'

console.log(env.ANTHROPIC_MODEL)
```

在 `module: "NodeNext"` 下，TypeScript 源码里引用本地模块时通常写编译后的 `.js` 后缀，例如 `../config/env.js`。这是 Node.js ESM 的解析规则，TypeScript 会在编译时正确对应到 `.ts` 源文件。

## 7. 配置 gitignore

新建 `.gitignore`：

```gitignore
node_modules/
dist/
.env
*.tsbuildinfo
npm-debug.log*
```

如果之后加入测试覆盖率，再补：

```gitignore
coverage/
```

## 8. 配置 Prettier

新建 `.prettierrc`：

```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "none"
}
```

并且配置.vscode，使能够保存自动格式化

这个项目教学代码较多，`printWidth: 100` 能减少无意义换行，同时仍然保持可读。

## 9. 配置 ESLint

新建 `eslint.config.js`：

```js
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
)
```

学习阶段不建议一上来禁止所有 `any`。可以先设为 `warn`，等核心流程跑通后，再逐步把关键边界补成明确类型。

## 10. 当前 step1 的使用方式

现在 `learn/step1.js` 是一个很好的第一步：它已经包含最小的流式模型客户端，可以用来理解一个 LLM streaming client 的核心流程。

它在项目中的定位是“流程参考”，不是“正式实现草稿”。后续开发时建议这样使用：

1. 先完成本项目初始化和基础配置。
2. 阅读 `learn/step1.js`，确认最小链路：创建模型客户端、发送 messages、消费 streaming event、组装 assistant message。
3. 在 `src/` 中按正式项目需要重新实现这些能力，例如 `src/config/env.ts`、`src/llm/anthropic.ts`、`src/index.ts`。
4. 给正式实现补清楚类型、错误处理、环境变量校验、日志和后续工具调用扩展点。
5. 当某个核心流程在 `learn/` 中已经足够清楚，再把它“设计成项目模块”，而不是机械复制。

简单说：`learn/` 负责把核心步骤讲明白，`src/` 负责把这些步骤变成可维护的工程代码。

## 11. 初始化完成后的验收清单

完成后至少跑一次：

```powershell
npm run typecheck
npm run lint
npm run build
```

如果还没有 `src/index.ts`，`typecheck` 和 `build` 可能会提示没有输入文件；这是正常的。创建第一个 `.ts` 文件后再跑即可。

推荐先创建一个最小验证文件 `src/index.ts`：

```ts
console.log('qing-agent initialized')
```

然后临时运行：

```powershell
npx tsx src/index.ts
npm run typecheck
npm run build
node dist/src/index.js
```

这四个命令都能跑通，就说明 TypeScript + Node 的基础底座已经搭好。

## 参考资料

- [Node.js：Introduction to TypeScript](https://nodejs.org/en/learn/typescript/introduction)
- [Node.js：Running TypeScript with a runner](https://nodejs.org/en/learn/typescript/run)
- [Node.js：Running TypeScript Natively](https://nodejs.org/en/learn/typescript/run-natively)
- [TypeScript：What is a tsconfig.json](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html)
- [TypeScript：tsc CLI Options](https://www.typescriptlang.org/docs/handbook/compiler-options)
- [tsx 官方文档](https://tsx.is/)
