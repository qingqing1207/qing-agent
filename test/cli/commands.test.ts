import { describe, expect, it } from 'vitest'
import { parseReplInput } from '../../src/cli/commands.js'

describe('parseReplInput', () => {
  it('returns empty for blank input', () => {
    expect(parseReplInput('')).toEqual({ type: 'empty' })
    expect(parseReplInput('   ')).toEqual({ type: 'empty' })
    expect(parseReplInput('\n\t')).toEqual({ type: 'empty' })
  })

  it('parses /exit command', () => {
    expect(parseReplInput('/exit')).toEqual({ type: 'exit' })
    expect(parseReplInput('  /exit  ')).toEqual({ type: 'exit' })
  })

  it('parses /clear command', () => {
    expect(parseReplInput('/clear')).toEqual({ type: 'clear' })
    expect(parseReplInput('  /clear  ')).toEqual({ type: 'clear' })
  })

  it('parses normal text as message', () => {
    expect(parseReplInput('hello')).toEqual({ type: 'message', text: 'hello' })
    expect(parseReplInput('  hello  ')).toEqual({ type: 'message', text: 'hello' })
  })

  it('treats unknown slash commands as normal messages for now', () => {
    expect(parseReplInput('/help')).toEqual({ type: 'message', text: '/help' })
  })
})
