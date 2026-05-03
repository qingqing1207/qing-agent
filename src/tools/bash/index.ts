import fs from 'node:fs/promises'
import { execaCommand } from 'execa'
import { z } from 'zod'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 20_000

const SAFE_ENV_NAMES = [
  'CI',
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'PWD',
  'SHELL',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERNAME',
  'WINDIR'
]

export const bashToolInputSchema = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'Shell command to execute in the current workspace.'
    },
    timeout_ms: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_TIMEOUT_MS,
      description: 'Maximum command runtime in milliseconds.'
    }
  },
  required: ['command'],
  additionalProperties: false
} satisfies ToolInputSchema

const bashInputValidator = z
  .object({
    command: z.string().min(1),
    timeout_ms: z.number().int().min(1).max(MAX_TIMEOUT_MS).optional().default(DEFAULT_TIMEOUT_MS)
  })
  .strict()

export const bashTool: AgentTool = {
  name: 'Bash',
  description:
    'Execute a shell command in the current workspace. Use for tests, builds, and inspection commands.',
  inputSchema: bashToolInputSchema,

  isReadOnly() {
    return false
  },

  isEnabled() {
    return process.env.QING_ENABLE_BASH_TOOL === '1'
  },

  async call(input: JsonObject, context): Promise<ToolCallResult> {
    const parsed = bashInputValidator.safeParse(input)

    if (!parsed.success) {
      return errorResult(`Error: invalid Bash input: ${formatZodError(parsed.error)}`)
    }

    try {
      const workspaceRoot = await resolveWorkspaceRoot(context.cwd)
      const result = await execaCommand(parsed.data.command, {
        cwd: workspaceRoot,
        env: createSafeEnv(workspaceRoot),
        extendEnv: false,
        shell: true,
        reject: false,
        all: true,
        timeout: parsed.data.timeout_ms,
        maxBuffer: MAX_OUTPUT_CHARS * 4
      })

      if (result.timedOut) {
        return errorResult(
          formatCommandResult(result.exitCode ?? -1, String(result.all ?? ''), result.timedOut)
        )
      }

      return {
        content: formatCommandResult(result.exitCode ?? 0, String(result.all ?? ''), result.timedOut)
      }
    } catch (error) {
      return errorResult(`Error running Bash: ${formatError(error)}`)
    }
  }
}

async function resolveWorkspaceRoot(cwd: string): Promise<string> {
  const workspaceRoot = await fs.realpath(cwd)
  const stat = await fs.stat(workspaceRoot)

  if (!stat.isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${cwd}`)
  }

  return workspaceRoot
}

function createSafeEnv(workspaceRoot: string): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {}

  for (const name of SAFE_ENV_NAMES) {
    const value = process.env[name]

    if (value !== undefined) {
      safeEnv[name] = value
    }
  }

  safeEnv.PWD = workspaceRoot

  return safeEnv
}

function formatCommandResult(exitCode: number, allOutput: string, timedOut: boolean): string {
  const lines = [`Exit code: ${exitCode}`]

  if (timedOut) {
    lines.push('Timed out: true')
  }

  const output = truncateOutput(allOutput.trimEnd())

  if (output.length > 0) {
    lines.push('', output)
  }

  return lines.join('\n')
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output
  }

  return `${output.slice(0, MAX_OUTPUT_CHARS).trimEnd()}\n[truncated]`
}

function errorResult(content: string): ToolCallResult {
  return { content, isError: true }
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join('; ')
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
