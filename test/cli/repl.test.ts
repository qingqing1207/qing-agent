import { describe, expect, it, vi } from 'vitest'
import { runRepl } from '../../src/cli/repl.js'
import type { InputReader, Renderer } from '../../src/cli/types.js'
import type {
  StreamMessageEvent,
  StreamMessageInput,
  StreamMessageResult
} from '../../src/llm/types.js'

describe('runRepl', () => {
  it('sends user input to the model and renders assistant text', async () => {
    const inputReader = new FakeInputReader(['hello', '/exit'])
    const renderer = new FakeRenderer()
    const sendMessage = createSendMessage('hi')

    await runRepl({ inputReader, renderer, sendMessage })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]?.[0].messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(renderer.text()).toContain('assistant: hi')
    expect(renderer.text()).toContain('(tokens in/out: 1/1)')
    expect(inputReader.closed).toBe(true)
  })

  it('keeps assistant messages in history for the next turn', async () => {
    const inputReader = new FakeInputReader(['hello', 'what did I say?', '/exit'])
    const renderer = new FakeRenderer()
    const sendMessage = createSendMessage('hi')

    await runRepl({ inputReader, renderer, sendMessage })

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage.mock.calls[1]?.[0].messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'user', content: 'what did I say?' }
    ])
  })

  it('clears message history with /clear', async () => {
    const inputReader = new FakeInputReader(['hello', '/clear', 'new topic', '/exit'])
    const renderer = new FakeRenderer()
    const sendMessage = createSendMessage('ok')

    await runRepl({ inputReader, renderer, sendMessage })

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage.mock.calls[1]?.[0].messages).toEqual([
      { role: 'user', content: 'new topic' }
    ])
    expect(renderer.text()).toContain('(history cleared)')
  })

  it('ignores empty input', async () => {
    const inputReader = new FakeInputReader(['', '   ', 'hello', '/exit'])
    const renderer = new FakeRenderer()
    const sendMessage = createSendMessage('hi')

    await runRepl({ inputReader, renderer, sendMessage })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]?.[0].messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('prints model errors and continues the REPL loop', async () => {
    const inputReader = new FakeInputReader(['first', 'second', '/exit'])
    const renderer = new FakeRenderer()
    const sendMessage = vi
      .fn()
      .mockImplementationOnce(failingSendMessage('model failed'))
      .mockImplementationOnce(createSendMessage('recovered'))

    await runRepl({ inputReader, renderer, sendMessage })

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(renderer.text()).toContain('[error] model failed')
    expect(renderer.text()).toContain('assistant: recovered')
    expect(inputReader.closed).toBe(true)
  })
})

class FakeInputReader implements InputReader {
  closed = false

  constructor(private readonly inputs: string[]) {}

  async question(): Promise<string> {
    return this.inputs.shift() ?? '/exit'
  }

  close(): void {
    this.closed = true
  }
}

class FakeRenderer implements Renderer {
  private readonly output: string[] = []

  line(text = ''): void {
    this.output.push(`${text}\n`)
  }

  write(text: string): void {
    this.output.push(text)
  }

  text(): string {
    return this.output.join('')
  }
}

function createSendMessage(responseText: string) {
  return vi.fn(async function* (
    _input: StreamMessageInput
  ): AsyncGenerator<StreamMessageEvent, StreamMessageResult> {
    yield { type: 'text', text: responseText }
    yield {
      type: 'message_done',
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 }
    }

    return {
      assistantMessage: {
        role: 'assistant',
        content: [{ type: 'text', text: responseText }]
      },
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'end_turn'
    }
  })
}

function failingSendMessage(message: string) {
  return async function* (): AsyncGenerator<StreamMessageEvent, StreamMessageResult> {
    yield* []
    throw new Error(message)
  }
}
