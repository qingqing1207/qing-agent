import type { RedactedThinkingBlock, TextBlock, ThinkingBlock, ToolUseBlock } from './types.js'

export function createTextBlock(text = ''): TextBlock {
  return { type: 'text', text }
}

export function createToolUseBlock(
  id: string,
  name: string,
  input: Record<string, unknown> = {}
): ToolUseBlock {
  return { type: 'tool_use', id, name, input }
}

export function createThinkingBlock(thinking = '', signature = ''): ThinkingBlock {
  return { type: 'thinking', thinking, signature }
}

export function createRedactedThinkingBlock(data: string): RedactedThinkingBlock {
  return { type: 'redacted_thinking', data }
}
