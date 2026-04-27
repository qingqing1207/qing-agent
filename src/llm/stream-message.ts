import type { MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'
import { env } from '../config/env.js'
import { getAnthropicClient } from './anthropic-client.js'
import { DEFAULT_MAX_TOKENS } from './constants.js'
import { createTextBlock, createToolUseBlock } from './content-blocks.js'
import type {
  AssistantContentBlock,
  StreamMessageEvent,
  StreamMessageInput,
  StreamMessageResult,
  TextBlock,
  ToolUseBlock
} from './types.js'

export type CreateMessageStream = (
  input: Required<Pick<StreamMessageInput, 'messages' | 'model'>> &
    Omit<StreamMessageInput, 'messages' | 'model'>
) => AsyncIterable<MessageStreamEvent> | Promise<AsyncIterable<MessageStreamEvent>>

export type StreamMessageOptions = {
  createStream?: CreateMessageStream
}

export async function* streamMessage(
  input: StreamMessageInput,
  options: StreamMessageOptions = {}
): AsyncGenerator<StreamMessageEvent, StreamMessageResult> {
  const model = input.model ?? env.ANTHROPIC_MODEL
  const stream = await (options.createStream?.({ ...input, model }) ??
    createMessageStream({ ...input, model }))
  const content: AssistantContentBlock[] = []
  const usage = { inputTokens: 0, outputTokens: 0 }
  let stopReason = 'end_turn'
  const pendingToolJsonByIndex = new Map<number, string>()

  for await (const event of stream) {
    switch (event.type) {
      case 'message_start': {
        usage.inputTokens = event.message.usage.input_tokens ?? 0
        yield { type: 'message_start', messageId: event.message.id }
        break
      }

      case 'content_block_start': {
        if (event.content_block.type === 'text') {
          content[event.index] = createTextBlock('')
        }

        if (event.content_block.type === 'tool_use') {
          content[event.index] = createToolUseBlock(
            event.content_block.id,
            event.content_block.name
          )
          pendingToolJsonByIndex.set(event.index, '')
          yield {
            type: 'tool_use_start',
            id: event.content_block.id,
            name: event.content_block.name
          }
        }
        break
      }

      case 'content_block_delta': {
        if (event.delta.type === 'text_delta') {
          const block = getTextBlock(content, event.index)
          block.text += event.delta.text
          yield { type: 'text', text: event.delta.text }
        }

        if (event.delta.type === 'input_json_delta') {
          const currentJson = pendingToolJsonByIndex.get(event.index)
          if (currentJson === undefined) {
            throw new Error(
              `Received tool input JSON delta before tool block at index ${event.index}`
            )
          }
          pendingToolJsonByIndex.set(event.index, currentJson + event.delta.partial_json)
        }
        break
      }

      case 'content_block_stop': {
        const block = content[event.index]
        if (block?.type === 'tool_use') {
          const pendingToolJson = pendingToolJsonByIndex.get(event.index)
          if (pendingToolJson) {
            block.input = parseToolInput(pendingToolJson, block)
          }
          pendingToolJsonByIndex.delete(event.index)
        }
        break
      }

      case 'message_delta': {
        usage.outputTokens = event.usage.output_tokens ?? usage.outputTokens
        stopReason = event.delta.stop_reason ?? stopReason
        break
      }

      case 'message_stop': {
        yield { type: 'message_done', stopReason, usage: { ...usage } }
        break
      }

      default:
        break
    }
  }

  return {
    assistantMessage: { role: 'assistant', content: compactContent(content) },
    usage,
    stopReason
  }
}

function createMessageStream(
  input: Required<Pick<StreamMessageInput, 'messages' | 'model'>> &
    Omit<StreamMessageInput, 'messages' | 'model'>
): AsyncIterable<MessageStreamEvent> {
  const client = getAnthropicClient()

  return client.messages.stream({
    model: input.model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: input.messages,
    stream: true,
    ...(input.system ? { system: input.system } : {}),
    ...(input.tools?.length ? { tools: input.tools } : {})
  })
}

function getTextBlock(content: AssistantContentBlock[], index: number): TextBlock {
  const block = content[index]

  if (!block) {
    throw new Error(`Received text delta before content block start at index ${index}`)
  }

  if (block.type !== 'text') {
    throw new Error(`Received text delta for non-text content block at index ${index}`)
  }

  return block
}

function parseToolInput(pendingToolJson: string, block: ToolUseBlock): Record<string, unknown> {
  let parsed: unknown

  try {
    parsed = JSON.parse(pendingToolJson)
  } catch (error) {
    throw new Error(
      `Invalid tool input JSON for tool ${block.name} (${block.id}): ${pendingToolJson}`,
      { cause: error }
    )
  }

  if (!isRecord(parsed)) {
    throw new Error(`Tool input JSON for tool ${block.name} (${block.id}) must be an object`)
  }

  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compactContent(content: AssistantContentBlock[]): AssistantContentBlock[] {
  return content.filter(isAssistantContentBlock)
}

function isAssistantContentBlock(value: unknown): value is AssistantContentBlock {
  return isRecord(value) && (value.type === 'text' || value.type === 'tool_use')
}
