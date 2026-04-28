import { describe, expect, it } from 'vitest'
import { createToolResultBlock } from '../../src/agent/tool-results.js'

describe('createToolResultBlock', () => {
  it('maps a successful tool result to a tool_result block', () => {
    expect(createToolResultBlock('toolu_1', { content: 'ok' })).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: 'ok'
    })
  })

  it('includes is_error for failed tool results', () => {
    expect(createToolResultBlock('toolu_1', { content: 'failed', isError: true })).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: 'failed',
      is_error: true
    })
  })

  it('keeps empty string content valid', () => {
    expect(createToolResultBlock('toolu_1', { content: '' })).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: ''
    })
  })
})
