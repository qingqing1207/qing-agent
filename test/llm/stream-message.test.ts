import type { MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'
import { describe, expect, it, vi } from 'vitest'
import { streamMessage, type CreateMessageStream } from '../../src/llm/stream-message.js'
import type {
  StreamMessageEvent,
  StreamMessageInput,
  StreamMessageResult
} from '../../src/llm/types.js'

const baseInput: StreamMessageInput = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'Hello' }]
}

describe('streamMessage', () => {
  it('streams text events and returns the assembled assistant message', async () => {
    const { events, result } = await collectStream([
      messageStart({ messageId: 'msg_1', inputTokens: 12 }),
      textBlockStart({ index: 0 }),
      textDelta({ index: 0, text: 'Hello' }),
      textDelta({ index: 0, text: ' world' }),
      contentBlockStop({ index: 0 }),
      messageDelta({ outputTokens: 4, stopReason: 'end_turn' }),
      messageStop()
    ])

    expect(events).toEqual([
      { type: 'message_start', messageId: 'msg_1' },
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      {
        type: 'message_done',
        stopReason: 'end_turn',
        usage: { inputTokens: 12, outputTokens: 4 }
      }
    ])

    expect(result).toEqual({
      assistantMessage: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello world' }]
      },
      usage: { inputTokens: 12, outputTokens: 4 },
      stopReason: 'end_turn'
    })
  })

  it('streams tool use start and parses tool input JSON after the block stops', async () => {
    const { events, result } = await collectStream([
      messageStart({ messageId: 'msg_tools', inputTokens: 20 }),
      toolUseBlockStart({ index: 0, id: 'toolu_1', name: 'read_file' }),
      inputJsonDelta({ index: 0, partialJson: '{"path":"' }),
      inputJsonDelta({ index: 0, partialJson: 'src/index.ts"}' }),
      contentBlockStop({ index: 0 }),
      messageDelta({ outputTokens: 8, stopReason: 'tool_use' }),
      messageStop()
    ])

    expect(events).toEqual([
      { type: 'message_start', messageId: 'msg_tools' },
      { type: 'tool_use_start', id: 'toolu_1', name: 'read_file' },
      {
        type: 'message_done',
        stopReason: 'tool_use',
        usage: { inputTokens: 20, outputTokens: 8 }
      }
    ])

    expect(result.assistantMessage.content).toEqual([
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'read_file',
        input: { path: 'src/index.ts' }
      }
    ])
  })

  it('compacts sparse content indexes in the final assistant message', async () => {
    const { result } = await collectStream([
      textBlockStart({ index: 1 }),
      textDelta({ index: 1, text: 'Text from one-based index' }),
      contentBlockStop({ index: 1 }),
      messageStop()
    ])

    expect(result.assistantMessage.content).toEqual([
      { type: 'text', text: 'Text from one-based index' }
    ])
  })

  it('throws a clear error when tool input JSON is invalid', async () => {
    await expect(
      collectStream([
        toolUseBlockStart({ index: 0, id: 'toolu_bad', name: 'read_file' }),
        inputJsonDelta({ index: 0, partialJson: '{"path":' }),
        contentBlockStop({ index: 0 })
      ])
    ).rejects.toThrow('Invalid tool input JSON for tool read_file (toolu_bad)')
  })

  it('throws when a text delta arrives before its text block starts', async () => {
    await expect(collectStream([textDelta({ index: 0, text: 'orphan' })])).rejects.toThrow(
      'Received text delta before content block start at index 0'
    )
  })

  it('passes normalized input to the injected stream factory', async () => {
    const createStream = vi.fn(() => fakeStream([messageStop()]))

    await collectStream([], {
      input: {
        ...baseInput,
        system: 'You are concise.'
      },
      createStream
    })

    expect(createStream).toHaveBeenCalledWith({
      ...baseInput,
      system: 'You are concise.'
    })
  })
})

type CollectOptions = {
  input?: StreamMessageInput
  createStream?: CreateMessageStream
}

async function collectStream(
  rawEvents: MessageStreamEvent[],
  options: CollectOptions = {}
): Promise<{ events: StreamMessageEvent[]; result: StreamMessageResult }> {
  const emittedEvents: StreamMessageEvent[] = []
  const iterator = streamMessage(options.input ?? baseInput, {
    createStream: options.createStream ?? (() => fakeStream(rawEvents))
  })

  while (true) {
    const next = await iterator.next()

    if (next.done) {
      return { events: emittedEvents, result: next.value }
    }

    emittedEvents.push(next.value)
  }
}

async function* fakeStream(events: MessageStreamEvent[]): AsyncGenerator<MessageStreamEvent> {
  for (const event of events) {
    yield event
  }
}

function messageStart(input: { messageId: string; inputTokens: number }): MessageStreamEvent {
  return toMessageStreamEvent({
    type: 'message_start',
    message: {
      id: input.messageId,
      container: null,
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'test-model',
      stop_details: null,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        cache_creation: null,
        input_tokens: input.inputTokens,
        output_tokens: 1,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        inference_geo: null,
        server_tool_use: null,
        service_tier: null
      }
    }
  })
}

function textBlockStart(input: { index: number }): MessageStreamEvent {
  return toMessageStreamEvent({
    type: 'content_block_start',
    index: input.index,
    content_block: {
      type: 'text',
      text: '',
      citations: null
    }
  })
}

function toolUseBlockStart(input: { index: number; id: string; name: string }): MessageStreamEvent {
  return toMessageStreamEvent({
    type: 'content_block_start',
    index: input.index,
    content_block: {
      type: 'tool_use',
      id: input.id,
      name: input.name,
      input: {}
    }
  })
}

function textDelta(input: { index: number; text: string }): MessageStreamEvent {
  return {
    type: 'content_block_delta',
    index: input.index,
    delta: {
      type: 'text_delta',
      text: input.text
    }
  }
}

function inputJsonDelta(input: { index: number; partialJson: string }): MessageStreamEvent {
  return {
    type: 'content_block_delta',
    index: input.index,
    delta: {
      type: 'input_json_delta',
      partial_json: input.partialJson
    }
  }
}

function contentBlockStop(input: { index: number }): MessageStreamEvent {
  return {
    type: 'content_block_stop',
    index: input.index
  }
}

function messageDelta(input: {
  outputTokens: number
  stopReason: 'end_turn' | 'tool_use'
}): MessageStreamEvent {
  return {
    type: 'message_delta',
    delta: {
      stop_reason: input.stopReason,
      stop_sequence: null,
      container: null,
      stop_details: null
    },
    usage: {
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      input_tokens: null,
      output_tokens: input.outputTokens,
      server_tool_use: null
    }
  }
}

function messageStop(): MessageStreamEvent {
  return { type: 'message_stop' }
}

function toMessageStreamEvent(value: unknown): MessageStreamEvent {
  return value as MessageStreamEvent
}
