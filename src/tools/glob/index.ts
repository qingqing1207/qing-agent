import fastGlob from 'fast-glob'
import { z } from 'zod'
import { resolveExistingWorkspacePath } from '../workspace-path.js'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'

export const globToolInputSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'Glob pattern used to find files.'
    },
    path: {
      type: 'string',
      description: 'Workspace-relative directory to search from.'
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 500,
      description: 'Maximum number of paths to return.'
    }
  },
  required: ['pattern'],
  additionalProperties: false
} satisfies ToolInputSchema

const globInputValidator = z
  .object({
    pattern: z.string().min(1),
    path: z.string().min(1).optional().default('.'),
    limit: z.number().int().min(1).max(500).optional().default(200)
  })
  .strict()

export const globTool: AgentTool = {
  name: 'Glob',
  description: 'Find files in the current workspace by glob pattern.',
  inputSchema: globToolInputSchema,

  isReadOnly() {
    return true
  },

  isEnabled() {
    return true
  },

  async call(input: JsonObject, context): Promise<ToolCallResult> {
    const parsed = globInputValidator.safeParse(input)

    if (!parsed.success) {
      return errorResult(`Error: invalid Glob input: ${formatZodError(parsed.error)}`)
    }

    try {
      const searchRoot = await resolveExistingWorkspacePath(parsed.data.path, context.cwd)
      const matches = (await findMatchingFiles(parsed.data.pattern, searchRoot))
        .sort()
        .slice(0, parsed.data.limit)

      if (matches.length === 0) {
        return { content: 'No files matched' }
      }

      return { content: matches.join('\n') }
    } catch (error) {
      return errorResult(`Error running Glob: ${formatError(error)}`)
    }
  }
}

async function findMatchingFiles(pattern: string, cwd: string): Promise<string[]> {
  return fastGlob(pattern, {
    cwd,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ['**/.git/**', '**/node_modules/**', '**/dist/**']
  })
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
