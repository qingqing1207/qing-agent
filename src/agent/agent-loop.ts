import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { streamMessage } from '../llm/stream-message.js'
import type {
  AssistantContentBlock,
  StreamMessageEvent,
  StreamMessageInput,
  StreamMessageResult,
  ToolUseBlock,
  Usage
} from '../llm/types.js'
import { allTools, getToolsApiParams } from '../tools/registry.js'
import type { AgentTool, ToolCallResult, ToolContext } from '../tools/types.js'
import { createToolResultBlock } from './tool-results.js'

export const DEFAULT_MAX_TOOL_ROUNDS = 8

export type AgentTurnEvent =
  | StreamMessageEvent
  | { type: 'tool_result'; toolUseId: string; toolName: string; isError: boolean }

export type AgentTurnResult = {
  messagesToAppend: MessageParam[]
  finalAssistantMessage: StreamMessageResult['assistantMessage']
  usage: Usage
  stopReason: string
}

export type SendMessage = (
  input: StreamMessageInput
) => AsyncGenerator<StreamMessageEvent, StreamMessageResult>

export type AgentTurnInput = {
  messages: MessageParam[]
  cwd: string
  model?: StreamMessageInput['model']
  system?: string
  tools?: AgentTool[]
  maxToolRounds?: number
  sendMessage?: SendMessage
}

export async function* runAgentTurn(
  input: AgentTurnInput
): AsyncGenerator<AgentTurnEvent, AgentTurnResult> {
  const tools = input.tools ?? allTools
  const sendMessage = input.sendMessage ?? streamMessage
  const maxToolRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS
  const context: ToolContext = { cwd: input.cwd }

  // 本轮结束后要追加回 ChatSession 的新增消息
  const messagesToAppend: MessageParam[] = []

  // 本轮 agent loop 内部用于继续调用模型的完整上下文
  const currentMessages = [...input.messages]

  const totalUsage: Usage = { inputTokens: 0, outputTokens: 0 }
  let toolRounds = 0

  while (true) {
    // 1. 把内部 generator yield 出来的每一个事件，继续 yield 给外层调用方。
    // 2. 等内部 generator return 后，把 return 值赋给左边变量。
    const result = yield* runModelTurn({
      messages: currentMessages,
      sendMessage,
      tools,
      context,
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.system !== undefined ? { system: input.system } : {})
    })

    totalUsage.inputTokens += result.usage.inputTokens
    totalUsage.outputTokens += result.usage.outputTokens

    messagesToAppend.push(result.assistantMessage)
    currentMessages.push(result.assistantMessage)

    const toolUses = getToolUseBlocks(result.assistantMessage.content)

    if (result.stopReason !== 'tool_use' || toolUses.length === 0) {
      return {
        messagesToAppend,
        finalAssistantMessage: result.assistantMessage,
        usage: totalUsage,
        stopReason: result.stopReason
      }
    }

    if (toolRounds >= maxToolRounds) {
      throw new Error(`Tool loop exceeded max rounds: ${maxToolRounds}`)
    }

    toolRounds += 1

    const toolResultBlocks = []

    for (const toolUse of toolUses) {
      const toolResult = await runToolUse(toolUse, tools, context)

      toolResultBlocks.push(createToolResultBlock(toolUse.id, toolResult))

      yield {
        type: 'tool_result',
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        isError: Boolean(toolResult.isError)
      }
    }

    const toolResultMessage: MessageParam = {
      role: 'user',
      content: toolResultBlocks
    }

    messagesToAppend.push(toolResultMessage)
    currentMessages.push(toolResultMessage)
  }
}

type RunModelTurnInput = {
  messages: MessageParam[]
  model?: StreamMessageInput['model']
  system?: string
  sendMessage: SendMessage
  tools: AgentTool[]
  context: ToolContext
}

async function* runModelTurn(
  input: RunModelTurnInput
): AsyncGenerator<AgentTurnEvent, StreamMessageResult> {
  const stream = input.sendMessage({
    messages: input.messages,
    tools: getToolsApiParams(input.tools, input.context),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.system !== undefined ? { system: input.system } : {})
  })

  while (true) {
    const next = await stream.next()

    if (next.done) {
      return next.value
    }

    yield next.value
  }
}

function getToolUseBlocks(content: AssistantContentBlock[]): ToolUseBlock[] {
  return content.filter((block): block is ToolUseBlock => block.type === 'tool_use')
}

async function runToolUse(
  toolUse: ToolUseBlock,
  tools: AgentTool[],
  context: ToolContext
): Promise<ToolCallResult> {
  const tool = tools.find((candidate) => candidate.name === toolUse.name)

  if (!tool) {
    return {
      content: `Error: unknown tool ${toolUse.name}`,
      isError: true
    }
  }

  try {
    return await tool.call(toolUse.input, context)
  } catch (error) {
    return {
      content: `Error running tool ${toolUse.name}: ${formatError(error)}`,
      isError: true
    }
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
