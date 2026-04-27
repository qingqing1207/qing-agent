import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'

let client: Anthropic | undefined

export function createAnthropicClient(): Anthropic {
  return new Anthropic({
    apiKey: env.ANTHROPIC_AUTH_TOKEN,
    baseURL: env.ANTHROPIC_BASE_URL
  })
}

export function getAnthropicClient(): Anthropic {
  client ??= createAnthropicClient()
  return client
}
