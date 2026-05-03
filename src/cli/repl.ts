import type { MessageParam, Model } from '@anthropic-ai/sdk/resources/messages'
import { runAgentTurn } from '../agent/agent-loop.js'
import type { AgentTurnEvent, AgentTurnResult, AgentTurnInput } from '../agent/agent-loop.js'
import { ChatSession } from '../chat/chat-session.js'
import { consoleRenderer } from './console-renderer.js'
import { parseReplInput } from './commands.js'
import { createReadlineInputReader } from './readline-prompt.js'
import { buildSystemPrompt } from '../prompt/build-system-prompt.js'
import type { InputReader, Renderer } from './types.js'

type RunAgentTurn = (input: AgentTurnInput) => AsyncGenerator<AgentTurnEvent, AgentTurnResult>

export type ReplOptions = {
  model?: Model
  system?: string
  inputReader?: InputReader
  renderer?: Renderer
  runAgentTurn?: RunAgentTurn
  cwd?: string
}

export async function runRepl(options: ReplOptions = {}): Promise<void> {
  const inputReader = options.inputReader ?? createReadlineInputReader()
  const renderer = options.renderer ?? consoleRenderer
  const runTurn = options.runAgentTurn ?? runAgentTurn
  const cwd = options.cwd ?? process.cwd()
  const system = options.system ?? (await buildSystemPrompt({ cwd }))
  const session = new ChatSession()

  renderer.line('Qing Agent REPL')
  renderer.line('Type /exit to quit, /clear to clear history.')

  try {
    while (true) {
      const command = parseReplInput(await inputReader.question('> '))

      if (command.type === 'empty') {
        continue
      }

      if (command.type === 'exit') {
        break
      }

      if (command.type === 'clear') {
        session.clear()
        renderer.line('(history cleared)')
        continue
      }

      session.addUserMessage(command.text)

      try {
        const result = await renderAgentTurn({
          messages: session.getMessages(),
          cwd,
          runAgentTurn: runTurn,
          renderer,
          ...(options.model !== undefined ? { model: options.model } : {}),
          system
        })

        session.addMessages(result.messagesToAppend)
        renderer.line(`(tokens in/out: ${result.usage.inputTokens}/${result.usage.outputTokens})`)
      } catch (error) {
        renderer.line()
        renderer.line(`[error] ${formatError(error)}`)
      }
    }
  } finally {
    inputReader.close()
  }
}

type RenderAgentTurnInput = {
  messages: MessageParam[]
  cwd: string
  model?: Model
  system?: string
  runAgentTurn: RunAgentTurn
  renderer: Renderer
}

async function renderAgentTurn(input: RenderAgentTurnInput): Promise<AgentTurnResult> {
  const stream = input.runAgentTurn({
    messages: input.messages,
    cwd: input.cwd,
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.system !== undefined ? { system: input.system } : {})
  })

  let needsAssistantPrefix = true

  while (true) {
    const next = await stream.next()

    if (next.done) {
      input.renderer.line()
      return next.value
    }

    needsAssistantPrefix = renderAgentTurnEvent(next.value, input.renderer, needsAssistantPrefix)
  }
}

function renderAgentTurnEvent(
  event: AgentTurnEvent,
  renderer: Renderer,
  needsAssistantPrefix: boolean
): boolean {
  if (event.type === 'text') {
    if (needsAssistantPrefix) {
      renderer.write('assistant: ')
    }

    renderer.write(event.text)
    return false
  }

  if (event.type === 'tool_use_start') {
    renderer.line()
    renderer.line(`[tool: ${event.name}]`)
    return true
  }

  if (event.type === 'tool_result') {
    renderer.line(`[tool result: ${event.toolName} ${event.isError ? 'error' : 'ok'}]`)
    renderer.line(`[tool input: ${formatToolInput(event.input)}]`)
    // 后续可以在这里按工具类型做特殊显示，例如 Glob 打印路径列表，Read 打印摘要。
    renderer.line(event.content)
    return true
  }

  return needsAssistantPrefix
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function formatToolInput(input: Record<string, unknown>): string {
  return JSON.stringify(input)
}
