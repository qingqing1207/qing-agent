import path from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { execa } from 'execa'
import { z } from 'zod'
import { resolveExistingWorkspacePath } from '../workspace-path.js'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const MAX_OUTPUT_CHARS = 20_000
const RIPGREP_TIMEOUT_MS = 10_000

export const grepToolInputSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'Regex pattern to search for.'
    },
    path: {
      type: 'string',
      description: 'Workspace-relative path to search.'
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_LIMIT,
      description: 'Maximum number of matching lines to return.'
    }
  },
  required: ['pattern'],
  additionalProperties: false
} satisfies ToolInputSchema

const grepInputValidator = z
  .object({
    pattern: z.string().min(1),
    path: z.string().min(1).optional().default('.'),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional().default(DEFAULT_LIMIT)
  })
  .strict()

export const grepTool: AgentTool = {
  name: 'Grep',
  description: 'Search file contents in the current workspace using a regex pattern.',
  inputSchema: grepToolInputSchema,

  isReadOnly() {
    return true
  },

  isEnabled() {
    return true
  },

  async call(input: JsonObject, context): Promise<ToolCallResult> {
    const parsed = grepInputValidator.safeParse(input)

    if (!parsed.success) {
      return errorResult(`Error: invalid Grep input: ${formatZodError(parsed.error)}`)
    }

    try {
      const workspaceRoot = await resolveExistingWorkspacePath('.', context.cwd)
      const searchTarget = await resolveExistingWorkspacePath(parsed.data.path, context.cwd)
      const matches = await findMatchingLines(
        parsed.data.pattern,
        searchTarget,
        workspaceRoot,
        parsed.data.limit
      )

      if (matches.length === 0) {
        return { content: 'No matches found' }
      }

      return { content: formatMatches(matches) }
    } catch (error) {
      return errorResult(`Error running Grep: ${formatError(error)}`)
    }
  }
}

async function findMatchingLines(
  pattern: string,
  searchTarget: string,
  workspaceRoot: string,
  limit: number
): Promise<string[]> {
  const result = await execa(rgPath, createRipgrepArgs(pattern, searchTarget, workspaceRoot, limit), {
    cwd: workspaceRoot,
    reject: false,
    timeout: RIPGREP_TIMEOUT_MS
  })

  if (result.exitCode === 1) {
    return []
  }

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `ripgrep exited with code ${result.exitCode}`)
  }

  return result.stdout.split(/\r?\n/).filter(Boolean).slice(0, limit)
}

function createRipgrepArgs(
  pattern: string,
  searchTarget: string,
  workspaceRoot: string,
  limit: number
): string[] {
  return [
    '--line-number',
    '--no-heading',
    '--color=never',
    '--glob',
    '!.git/**',
    '--glob',
    '!node_modules/**',
    '--glob',
    '!dist/**',
    '--max-count',
    String(limit),
    '--regexp',
    pattern,
    toRipgrepTarget(searchTarget, workspaceRoot)
  ]
}

function toRipgrepTarget(searchTarget: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, searchTarget) || '.'
}

function formatMatches(matches: string[]): string {
  const content = matches.join('\n')

  if (content.length <= MAX_OUTPUT_CHARS) {
    return content
  }

  return `${content.slice(0, MAX_OUTPUT_CHARS).trimEnd()}\n[truncated]`
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
