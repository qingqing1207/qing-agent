import type { MessageParam, Model } from '@anthropic-ai/sdk/resources/messages'
import { ChatSession } from '../chat/chat-session.js'
import { streamMessage } from '../llm/stream-message.js'
import type { StreamMessageEvent, StreamMessageInput, StreamMessageResult } from '../llm/types.js'
import { consoleRenderer } from './console-renderer.js'
import { parseReplInput } from './commands.js'
import { createReadlineInputReader } from './readline-prompt.js'
import type { InputReader, Renderer } from './types.js'

type SendMessage = (
  input: StreamMessageInput
) => AsyncGenerator<StreamMessageEvent, StreamMessageResult>

export type ReplOptions = {
  model?: Model
  system?: string
  inputReader?: InputReader
  renderer?: Renderer
  sendMessage?: SendMessage
}

export async function runRepl(options: ReplOptions = {}): Promise<void> {
  const inputReader = options.inputReader ?? createReadlineInputReader()
  const renderer = options.renderer ?? consoleRenderer
  const sendMessage = options.sendMessage ?? streamMessage
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
        const result = await renderAssistantTurn({
          messages: session.getMessages(),
          sendMessage,
          renderer,
          ...(options.model !== undefined ? { model: options.model } : {}),
          ...(options.system !== undefined ? { system: options.system } : {})
        })

        session.addAssistantMessage(result)
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

type RenderAssistantTurnInput = {
  messages: MessageParam[]
  model?: Model
  system?: string
  sendMessage: SendMessage
  renderer: Renderer
}

async function renderAssistantTurn(input: RenderAssistantTurnInput): Promise<StreamMessageResult> {
  const stream = input.sendMessage({
    messages: input.messages,
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.system !== undefined ? { system: input.system } : {})
  })

  input.renderer.write('assistant: ')

  while (true) {
    const next = await stream.next()

    if (next.done) {
      input.renderer.line()
      return next.value
    }

    renderStreamEvent(next.value, input.renderer)
  }
}

function renderStreamEvent(event: StreamMessageEvent, renderer: Renderer): void {
  if (event.type === 'text') {
    renderer.write(event.text)
  }

  if (event.type === 'tool_use_start') {
    renderer.line()
    renderer.line(`[tool: ${event.name}]`)
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
