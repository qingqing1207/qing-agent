import type { Tool } from '@anthropic-ai/sdk/resources/messages'
import { editTool } from './edit/index.js'
import { globTool } from './glob/index.js'
import { grepTool } from './grep/index.js'
import { readTool } from './read/index.js'

import type { AgentTool, ToolContext } from './types.js'

export const allTools: AgentTool[] = [readTool, globTool, grepTool, editTool]

export function findToolByName(name: string): AgentTool | undefined {
  return allTools.find((tool) => tool.name === name)
}

export function getToolsApiParams(tools = allTools, context?: ToolContext): Tool[] {
  return tools
    .filter((tool) => tool.isEnabled(context))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }))
}
