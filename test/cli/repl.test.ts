import { describe, expect, it, vi } from 'vitest'
import { runRepl } from '../../src/cli/repl.js'
import type { InputReader, Renderer } from '../../src/cli/types.js'
import type { AgentTurnEvent, AgentTurnInput, AgentTurnResult } from '../../src/agent/agent-loop.js'

describe('runRepl', () => {
  it('sends user input to the agent loop and renders assistant text', async () => {
    const inputReader = new FakeInputReader(['hello', '/exit'])
    const renderer = new FakeRenderer()
    const runAgentTurn = createAgentTurn('hi')

    await runRepl({ inputReader, renderer, runAgentTurn, cwd: '/workspace' })

    expect(runAgentTurn).toHaveBeenCalledTimes(1)
    expect(runAgentTurn.mock.calls[0]?.[0].messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(runAgentTurn.mock.calls[0]?.[0].cwd).toBe('/workspace')
    expect(renderer.text()).toContain('assistant: hi')
    expect(renderer.text()).toContain('(tokens in/out: 1/1)')
    expect(inputReader.closed).toBe(true)
  })

  it('keeps agent turn messages in history for the next turn', async () => {
    const inputReader = new FakeInputReader(['hello', 'what did I say?', '/exit'])
    const renderer = new FakeRenderer()
    const runAgentTurn = createAgentTurn('hi')

    await runRepl({ inputReader, renderer, runAgentTurn, cwd: '/workspace' })

    expect(runAgentTurn).toHaveBeenCalledTimes(2)
    expect(runAgentTurn.mock.calls[1]?.[0].messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'user', content: 'what did I say?' }
    ])
  })

  it('appends multiple agent turn messages to history', async () => {
    const inputReader = new FakeInputReader(['read file', 'continue', '/exit'])
    const renderer = new FakeRenderer()
    const runAgentTurn = vi
      .fn<RunAgentTurn>()
      .mockImplementationOnce(
        createAgentTurnFromResult({
          events: [
            { type: 'tool_use_start', id: 'toolu_1', name: 'Read' },
            { type: 'tool_result', toolUseId: 'toolu_1', toolName: 'Read', isError: false },
            { type: 'text', text: 'done' }
          ],
          result: {
            messagesToAppend: [
              {
                role: 'assistant',
                content: [
                  {
                    type: 'tool_use',
                    id: 'toolu_1',
                    name: 'Read',
                    input: { file_path: 'src/index.ts' }
                  }
                ]
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: 'toolu_1',
                    content: 'file content'
                  }
                ]
              },
              {
                role: 'assistant',
                content: [{ type: 'text', text: 'done' }]
              }
            ],
            finalAssistantMessage: {
              role: 'assistant',
              content: [{ type: 'text', text: 'done' }]
            },
            usage: { inputTokens: 2, outputTokens: 3 },
            stopReason: 'end_turn'
          }
        })
      )
      .mockImplementationOnce(createAgentTurnFromResult(simpleResult('continued')))

    await runRepl({ inputReader, renderer, runAgentTurn, cwd: '/workspace' })

    expect(runAgentTurn.mock.calls[1]?.[0].messages).toEqual([
      { role: 'user', content: 'read file' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Read',
            input: { file_path: 'src/index.ts' }
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'file content'
          }
        ]
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }]
      },
      { role: 'user', content: 'continue' }
    ])

    expect(renderer.text()).toContain('[tool: Read]')
    expect(renderer.text()).toContain('[tool result: Read ok]')
    expect(renderer.text()).toContain('assistant: done')
  })

  it('clears message history with /clear', async () => {
    const inputReader = new FakeInputReader(['hello', '/clear', 'new topic', '/exit'])
    const renderer = new FakeRenderer()
    const runAgentTurn = createAgentTurn('ok')

    await runRepl({ inputReader, renderer, runAgentTurn, cwd: '/workspace' })

    expect(runAgentTurn).toHaveBeenCalledTimes(2)
    expect(runAgentTurn.mock.calls[1]?.[0].messages).toEqual([
      { role: 'user', content: 'new topic' }
    ])
    expect(renderer.text()).toContain('(history cleared)')
  })

  it('ignores empty input', async () => {
    const inputReader = new FakeInputReader(['', '   ', 'hello', '/exit'])
    const renderer = new FakeRenderer()
    const runAgentTurn = createAgentTurn('hi')

    await runRepl({ inputReader, renderer, runAgentTurn, cwd: '/workspace' })

    expect(runAgentTurn).toHaveBeenCalledTimes(1)
    expect(runAgentTurn.mock.calls[0]?.[0].messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('prints agent errors and continues the REPL loop', async () => {
    const inputReader = new FakeInputReader(['first', 'second', '/exit'])
    const renderer = new FakeRenderer()
    const runAgentTurn = vi
      .fn<RunAgentTurn>()
      .mockImplementationOnce(failingAgentTurn('agent failed'))
      .mockImplementationOnce(createAgentTurnFromResult(simpleResult('recovered')))

    await runRepl({ inputReader, renderer, runAgentTurn, cwd: '/workspace' })

    expect(runAgentTurn).toHaveBeenCalledTimes(2)
    expect(renderer.text()).toContain('[error] agent failed')
    expect(renderer.text()).toContain('assistant: recovered')
    expect(inputReader.closed).toBe(true)
  })
})

type RunAgentTurn = (input: AgentTurnInput) => AsyncGenerator<AgentTurnEvent, AgentTurnResult>

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

function createAgentTurn(responseText: string) {
  return vi
    .fn<RunAgentTurn>()
    .mockImplementation(createAgentTurnFromResult(simpleResult(responseText)))
}

function createAgentTurnFromResult(input: {
  events: AgentTurnEvent[]
  result: AgentTurnResult
}): RunAgentTurn {
  return async function* (_input: AgentTurnInput) {
    for (const event of input.events) {
      yield event
    }

    return input.result
  }
}

function simpleResult(text: string): { events: AgentTurnEvent[]; result: AgentTurnResult } {
  return {
    events: [{ type: 'text', text }],
    result: {
      messagesToAppend: [
        {
          role: 'assistant',
          content: [{ type: 'text', text }]
        }
      ],
      finalAssistantMessage: {
        role: 'assistant',
        content: [{ type: 'text', text }]
      },
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'end_turn'
    }
  }
}

function failingAgentTurn(message: string): RunAgentTurn {
  return async function* () {
    yield* []
    throw new Error(message)
  }
}
