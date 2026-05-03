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

  it('registers the Write tool', () => {
    expect(allTools.map((tool) => tool.name)).toContain('Write')
  })

  it('registers the Bash tool', () => {
    expect(allTools.map((tool) => tool.name)).toContain('Bash')
  })

  it('finds a tool by name', () => {
    expect(findToolByName('Read')?.name).toBe('Read')
    expect(findToolByName('Glob')?.name).toBe('Glob')
    expect(findToolByName('Grep')?.name).toBe('Grep')
    expect(findToolByName('Edit')?.name).toBe('Edit')
    expect(findToolByName('Write')?.name).toBe('Write')
    expect(findToolByName('Bash')?.name).toBe('Bash')
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

  it('omits write-capable tools from Anthropic API params by default', () => {
    const previousWriteTools = process.env.QING_ENABLE_WRITE_TOOLS
    const previousBashTool = process.env.QING_ENABLE_BASH_TOOL

    try {
      delete process.env.QING_ENABLE_WRITE_TOOLS
      delete process.env.QING_ENABLE_BASH_TOOL
      const toolNames = getToolsApiParams().map((tool) => tool.name)

      expect(toolNames).not.toContain('Edit')
      expect(toolNames).not.toContain('Write')
      expect(toolNames).not.toContain('Bash')
    } finally {
      restoreEnv('QING_ENABLE_WRITE_TOOLS', previousWriteTools)
      restoreEnv('QING_ENABLE_BASH_TOOL', previousBashTool)
    }
  })

  it('includes write-capable tools in Anthropic API params when enabled', () => {
    const previous = process.env.QING_ENABLE_WRITE_TOOLS

    try {
      process.env.QING_ENABLE_WRITE_TOOLS = '1'
      const toolNames = getToolsApiParams().map((tool) => tool.name)

      expect(toolNames).toContain('Edit')
      expect(toolNames).toContain('Write')
    } finally {
      restoreEnv('QING_ENABLE_WRITE_TOOLS', previous)
    }
  })

  it('includes Bash in Anthropic API params when enabled', () => {
    const previous = process.env.QING_ENABLE_BASH_TOOL

    try {
      process.env.QING_ENABLE_BASH_TOOL = '1'

      expect(getToolsApiParams().map((tool) => tool.name)).toContain('Bash')
    } finally {
      restoreEnv('QING_ENABLE_BASH_TOOL', previous)
    }
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
