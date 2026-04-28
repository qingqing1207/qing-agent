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

  addMessage(message: MessageParam): void {
    this.messages.push(message)
  }

  addMessages(messages: MessageParam[]): void {
    for (const message of messages) {
      this.addMessage(message)
    }
  }

  clear(): void {
    this.messages.length = 0
  }

  getMessages(): MessageParam[] {
    return [...this.messages]
  }
}
