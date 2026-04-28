import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { ToolCallResult } from '../tools/types.js'

export function createToolResultBlock(
  toolUseId: string,
  result: ToolCallResult
): ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: result.content,
    ...(result.isError ? { is_error: true } : {})
  }
}
