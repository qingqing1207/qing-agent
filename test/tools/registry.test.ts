import { describe, expect, it } from 'vitest'
import { allTools, findToolByName, getToolsApiParams } from '../../src/tools/registry.js'
import type { AgentTool } from '../../src/tools/types.js'

describe('tools registry', () => {
  it('registers the Read tool', () => {
    expect(allTools.map((tool) => tool.name)).toContain('Read')
  })

  it('registers the Glob tool', () => {
    expect(allTools.map((tool) => tool.name)).toContain('Glob')
  })

  it('registers the Grep tool', () => {
    expect(allTools.map((tool) => tool.name)).toContain('Grep')
  })

  it('registers the Edit tool', () => {
    expect(allTools.map((tool) => tool.name)).toContain('Edit')
  })

  it('finds a tool by name', () => {
    expect(findToolByName('Read')?.name).toBe('Read')
    expect(findToolByName('Glob')?.name).toBe('Glob')
    expect(findToolByName('Grep')?.name).toBe('Grep')
    expect(findToolByName('Edit')?.name).toBe('Edit')
  })

  it('returns undefined for an unknown tool', () => {
    expect(findToolByName('Unknown')).toBeUndefined()
  })

  it('omits disabled tools from Anthropic API params', () => {
    const disabledTool = createTool({
      name: 'Disabled',
      isEnabled: () => false
    })

    expect(getToolsApiParams([disabledTool])).toEqual([])
  })

  it('maps internal tools to Anthropic API params', () => {
    const tool = createTool({ name: 'Example' })

    expect(getToolsApiParams([tool])).toEqual([
      {
        name: 'Example',
        description: 'Example tool',
        input_schema: {
          type: 'object',
          properties: {
            value: { type: 'string' }
          },
          required: ['value'],
          additionalProperties: false
        }
      }
    ])
  })

  it('omits Edit from Anthropic API params by default', () => {
    expect(getToolsApiParams().map((tool) => tool.name)).not.toContain('Edit')
  })
})

function createTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: 'Example',
    description: 'Example tool',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string' }
      },
      required: ['value'],
      additionalProperties: false
    },
    isReadOnly: () => true,
    isEnabled: () => true,
    call: async () => ({ content: 'ok' }),
    ...overrides
  }
}
