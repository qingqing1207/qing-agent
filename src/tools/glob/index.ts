import fs from 'node:fs/promises'
import path from 'node:path'
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
      const files = await listFiles(searchRoot)
      const matches = files
        .filter((filePath) => matchesGlob(filePath, parsed.data.pattern))
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

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (shouldSkipEntry(entry.name)) {
      continue
    }

    const fullPath = path.join(current, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, fullPath)))
      continue
    }

    if (entry.isFile()) {
      files.push(path.relative(root, fullPath))
    }
  }

  return files
}

function shouldSkipEntry(name: string): boolean {
  return name === '.git' || name === 'node_modules' || name === 'dist'
}

function matchesGlob(filePath: string, pattern: string): boolean {
  const normalizedFilePath = filePath.split(path.sep).join('/')
  const normalizedPattern = pattern.split(path.sep).join('/')

  if (!normalizedPattern.includes('/')) {
    return matchesGlobSegment(path.basename(normalizedFilePath), normalizedPattern)
  }

  return globToRegExp(normalizedPattern).test(normalizedFilePath)
}

function matchesGlobSegment(value: string, pattern: string): boolean {
  return globToRegExp(pattern).test(value)
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')

  return new RegExp(`^${escaped}$`)
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
