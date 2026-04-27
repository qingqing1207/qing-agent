import { env } from '../../src/config/env.js'
import { streamMessage } from '../../src/llm/stream-message.js'
import type { StreamMessageResult } from '../../src/llm/types.js'

const iterator = streamMessage({
  model: env.ANTHROPIC_MODEL,
  messages: [
    {
      role: 'user',
      content: '以《少年，你的剑太重了》为主题，写一篇三百字以内的故事'
    }
  ]
})

let finalResult: StreamMessageResult | undefined

console.log(`model: ${env.ANTHROPIC_MODEL}`)
console.log('assistant:')

while (true) {
  const next = await iterator.next()

  if (next.done) {
    finalResult = next.value
    break
  }

  const event = next.value

  if (event.type === 'text') {
    process.stdout.write(event.text)
  }

  if (event.type === 'tool_use_start') {
    console.log(`\n[tool_use_start] ${event.name} (${event.id})`)
  }

  if (event.type === 'message_done') {
    console.log('\n')
    console.log(`[message_done] stopReason=${event.stopReason}`)
    console.log(
      `[usage] inputTokens=${event.usage.inputTokens}, outputTokens=${event.usage.outputTokens}`
    )
  }
}

console.log('\nfinal assistant message:')
console.dir(finalResult?.assistantMessage, { depth: null })
