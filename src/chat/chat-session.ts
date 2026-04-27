import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import type { StreamMessageResult } from '../llm/types.js'

export class ChatSession {
  private readonly messages: MessageParam[] = []

  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content })
  }

  addAssistantMessage(result: StreamMessageResult): void {
    this.messages.push(result.assistantMessage)
  }

  clear(): void {
    this.messages.length = 0
  }

  getMessages(): MessageParam[] {
    return [...this.messages]
  }
}
