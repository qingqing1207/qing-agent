import type { MessageParam, Model, ToolUnion } from '@anthropic-ai/sdk/resources/messages'

export type TextBlock = {
  type: 'text'
  text: string
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type AssistantContentBlock = TextBlock | ToolUseBlock

export type Usage = {
  inputTokens: number
  outputTokens: number
}

export type StreamMessageInput = {
  messages: MessageParam[]
  model?: Model
  system?: string
  tools?: ToolUnion[]
}

export type StreamMessageEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'message_done'; stopReason: string; usage: Usage }

export type StreamMessageResult = {
  assistantMessage: {
    role: 'assistant'
    content: AssistantContentBlock[]
  }
  usage: Usage
  stopReason: string
}
