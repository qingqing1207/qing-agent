import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { describe, expect, it, vi } from 'vitest'
import {
  runAgentTurn,
  type AgentTurnEvent,
  type AgentTurnResult,
  type SendMessage
} from '../../src/agent/agent-loop.js'
import type { StreamMessageEvent, StreamMessageInput, StreamMessageResult } from '../../src/llm/types.js'
import type { AgentTool } from '../../src/tools/types.js'

describe('runAgentTurn', () => {
  it('calls the model once when there is no tool_use', async () => {
    const sendMessage = vi.fn<SendMessage>().mockImplementation(createModelTurn(textResult('done')))

    const { events, result } = await collectAgentTurn({
      messages: [{ role: 'user', content: 'hello' }],
      sendMessage,
      tools: []
    })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(events).toEqual([{ type: 'text', text: 'done' }])
    expect(result).toEqual({
      messagesToAppend: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }]
        }
      ],
      finalAssistantMessage: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }]
      },
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'end_turn'
    })
  })

  it('executes a tool and calls the model again with the tool_result message', async () => {
    const tool = createTool({ content: 'file content' })
    const messageSnapshots: MessageParam[][] = []
    const sendMessage = vi
      .fn<SendMessage>()
      .mockImplementationOnce(
        createRecordingModelTurn(toolUseResult('toolu_1', 'Read'), messageSnapshots)
      )
      .mockImplementationOnce(createRecordingModelTurn(textResult('final answer'), messageSnapshots))

    const { events, result } = await collectAgentTurn({
      messages: [{ role: 'user', content: 'read file' }],
      sendMessage,
      tools: [tool]
    })

    expect(tool.call).toHaveBeenCalledWith({ file_path: 'src/index.ts' }, { cwd: '/workspace' })
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(messageSnapshots[1]).toEqual([
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
      }
    ])

    expect(events).toEqual([
      { type: 'tool_use_start', id: 'toolu_1', name: 'Read' },
      {
        type: 'tool_result',
        toolUseId: 'toolu_1',
        toolName: 'Read',
        input: { file_path: 'src/index.ts' },
        content: 'file content',
        isError: false
      },
      { type: 'text', text: 'final answer' }
    ])
    expect(result.messagesToAppend).toEqual([
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
        content: [{ type: 'text', text: 'final answer' }]
      }
    ])
    expect(result.finalAssistantMessage).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'final answer' }]
    })
    expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 2 })
    expect(result.stopReason).toBe('end_turn')
  })

  it('passes thinking blocks through to the next model call', async () => {
    const tool = createTool({ content: 'file content' })
    const messageSnapshots: MessageParam[][] = []
    const sendMessage = vi
      .fn<SendMessage>()
      .mockImplementationOnce(
        createRecordingModelTurn(thinkingToolUseResult(), messageSnapshots, [
          { type: 'tool_use_start', id: 'toolu_1', name: 'Read' }
        ])
      )
      .mockImplementationOnce(createRecordingModelTurn(textResult('final answer'), messageSnapshots))

    await collectAgentTurn({
      messages: [{ role: 'user', content: 'read file' }],
      sendMessage,
      tools: [tool]
    })

    expect(messageSnapshots[1]?.[1]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'Need to inspect the file.',
          signature: 'sig_1'
        },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Read',
          input: { file_path: 'src/index.ts' }
        }
      ]
    })
  })

  it('creates an error tool_result for unknown tools', async () => {
    const sendMessage = vi
      .fn<SendMessage>()
      .mockImplementationOnce(createModelTurn(toolUseResult('toolu_1', 'MissingTool')))
      .mockImplementationOnce(createModelTurn(textResult('handled')))

    const { events, result } = await collectAgentTurn({
      messages: [{ role: 'user', content: 'use missing tool' }],
      sendMessage,
      tools: []
    })

    expect(events).toContainEqual({
      type: 'tool_result',
      toolUseId: 'toolu_1',
      toolName: 'MissingTool',
      input: { file_path: 'src/index.ts' },
      content: 'Error: unknown tool MissingTool',
      isError: true
    })
    expect(result.messagesToAppend[1]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'Error: unknown tool MissingTool',
          is_error: true
        }
      ]
    })
  })

  it('creates an error tool_result when a tool throws', async () => {
    const tool = createTool()
    vi.mocked(tool.call).mockRejectedValueOnce(new Error('boom'))
    const sendMessage = vi
      .fn<SendMessage>()
      .mockImplementationOnce(createModelTurn(toolUseResult('toolu_1', 'Read')))
      .mockImplementationOnce(createModelTurn(textResult('handled')))

    const { events, result } = await collectAgentTurn({
      messages: [{ role: 'user', content: 'read file' }],
      sendMessage,
      tools: [tool]
    })

    expect(events).toContainEqual({
      type: 'tool_result',
      toolUseId: 'toolu_1',
      toolName: 'Read',
      input: { file_path: 'src/index.ts' },
      content: 'Error running tool Read: boom',
      isError: true
    })
    expect(result.messagesToAppend[1]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'Error running tool Read: boom',
          is_error: true
        }
      ]
    })
  })

  it('handles multiple tool_use blocks in one assistant message', async () => {
    const tool = createTool({ content: 'ok' })
    const sendMessage = vi
      .fn<SendMessage>()
      .mockImplementationOnce(createModelTurn(multipleToolUseResult()))
      .mockImplementationOnce(createModelTurn(textResult('done')))

    const { result } = await collectAgentTurn({
      messages: [{ role: 'user', content: 'read files' }],
      sendMessage,
      tools: [tool]
    })

    expect(tool.call).toHaveBeenCalledTimes(2)
    expect(result.messagesToAppend[1]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'ok'
        },
        {
          type: 'tool_result',
          tool_use_id: 'toolu_2',
          content: 'ok'
        }
      ]
    })
  })

  it('fails when the tool loop exceeds maxToolRounds', async () => {
    const tool = createTool({ content: 'still looping' })
    const sendMessage = vi.fn<SendMessage>().mockImplementation(createModelTurn(toolUseResult('toolu_1', 'Read')))

    await expect(
      collectAgentTurn({
        messages: [{ role: 'user', content: 'loop' }],
        sendMessage,
        tools: [tool],
        maxToolRounds: 1
      })
    ).rejects.toThrow('Tool loop exceeded max rounds: 1')
  })
})

type CollectInput = {
  messages: MessageParam[]
  sendMessage: SendMessage
  tools: AgentTool[]
  maxToolRounds?: number
}

async function collectAgentTurn(input: CollectInput): Promise<{
  events: AgentTurnEvent[]
  result: AgentTurnResult
}> {
  const stream = runAgentTurn({
    messages: input.messages,
    cwd: '/workspace',
    sendMessage: input.sendMessage,
    tools: input.tools,
    ...(input.maxToolRounds !== undefined ? { maxToolRounds: input.maxToolRounds } : {})
  })

  const events: AgentTurnEvent[] = []

  while (true) {
    const next = await stream.next()

    if (next.done) {
      return { events, result: next.value }
    }

    events.push(next.value)
  }
}

function createModelTurn(result: StreamMessageResult, events?: StreamMessageEvent[]): SendMessage {
  return async function* (_input: StreamMessageInput) {
    for (const event of events ?? eventsForResult(result)) {
      yield event
    }

    return result
  }
}

function createRecordingModelTurn(
  result: StreamMessageResult,
  messageSnapshots: MessageParam[][],
  events?: StreamMessageEvent[]
): SendMessage {
  return async function* (input: StreamMessageInput) {
    messageSnapshots.push(cloneMessages(input.messages))

    for (const event of events ?? eventsForResult(result)) {
      yield event
    }

    return result
  }
}

function cloneMessages(messages: MessageParam[]): MessageParam[] {
  return JSON.parse(JSON.stringify(messages)) as MessageParam[]
}

function eventsForResult(result: StreamMessageResult): StreamMessageEvent[] {
  const firstBlock = result.assistantMessage.content[0]

  if (firstBlock?.type === 'text') {
    return [{ type: 'text', text: firstBlock.text }]
  }

  if (firstBlock?.type === 'tool_use') {
    return [{ type: 'tool_use_start', id: firstBlock.id, name: firstBlock.name }]
  }

  return []
}

function textResult(text: string): StreamMessageResult {
  return {
    assistantMessage: {
      role: 'assistant',
      content: [{ type: 'text', text }]
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'end_turn'
  }
}

function toolUseResult(id: string, name: string): StreamMessageResult {
  return {
    assistantMessage: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id,
          name,
          input: { file_path: 'src/index.ts' }
        }
      ]
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'tool_use'
  }
}

function thinkingToolUseResult(): StreamMessageResult {
  return {
    assistantMessage: {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'Need to inspect the file.',
          signature: 'sig_1'
        },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Read',
          input: { file_path: 'src/index.ts' }
        }
      ]
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'tool_use'
  }
}

function multipleToolUseResult(): StreamMessageResult {
  return {
    assistantMessage: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Read',
          input: { file_path: 'src/a.ts' }
        },
        {
          type: 'tool_use',
          id: 'toolu_2',
          name: 'Read',
          input: { file_path: 'src/b.ts' }
        }
      ]
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'tool_use'
  }
}

function createTool(result: { content?: string; isError?: boolean } = {}): AgentTool {
  return {
    name: 'Read',
    description: 'Read tool',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' }
      },
      required: ['file_path'],
      additionalProperties: false
    },
    isReadOnly: () => true,
    isEnabled: () => true,
    call: vi.fn(async () => ({
      content: result.content ?? 'ok',
      ...(result.isError ? { isError: true } : {})
    }))
  }
}
