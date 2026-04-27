import { describe, expect, it } from 'vitest'
import { ChatSession } from '../../src/chat/chat-session.js'
import type { StreamMessageResult } from '../../src/llm/types.js'

describe('ChatSession', () => {
  it('starts with empty messages', () => {
    const session = new ChatSession()

    expect(session.getMessages()).toEqual([])
  })

  it('adds user messages', () => {
    const session = new ChatSession()

    session.addUserMessage('hello')

    expect(session.getMessages()).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('adds assistant messages from stream result', () => {
    const session = new ChatSession()

    session.addAssistantMessage(createAssistantResult('hi there'))

    expect(session.getMessages()).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi there' }]
      }
    ])
  })

  it('keeps user and assistant messages in order', () => {
    const session = new ChatSession()

    session.addUserMessage('hello')
    session.addAssistantMessage(createAssistantResult('hi'))
    session.addUserMessage('who are you?')

    expect(session.getMessages()).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'user', content: 'who are you?' }
    ])
  })

  it('clears message history', () => {
    const session = new ChatSession()

    session.addUserMessage('hello')
    session.addAssistantMessage(createAssistantResult('hi'))
    session.clear()

    expect(session.getMessages()).toEqual([])
  })

  it('returns a copy of the messages array', () => {
    const session = new ChatSession()
    session.addUserMessage('hello')

    const messages = session.getMessages()
    messages.push({ role: 'user', content: 'mutated outside' })

    expect(session.getMessages()).toEqual([{ role: 'user', content: 'hello' }])
  })
})

function createAssistantResult(text: string): StreamMessageResult {
  return {
    assistantMessage: {
      role: 'assistant',
      content: [{ type: 'text', text }]
    },
    usage: {
      inputTokens: 1,
      outputTokens: 1
    },
    stopReason: 'end_turn'
  }
}
