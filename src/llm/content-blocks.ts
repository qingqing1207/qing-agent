import type { TextBlock, ToolUseBlock } from './types.js'

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
