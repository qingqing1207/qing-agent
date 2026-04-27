import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  ANTHROPIC_AUTH_TOKEN: z.string().min(1, 'ANTHROPIC_AUTH_TOKEN is required'),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  ANTHROPIC_MODEL: z.string().default('deepseek-v4-flash')
})

export const env = envSchema.parse(process.env)
