import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'
import { addLineNumbers } from './line-numbers.js'
import { resolveWorkspacePath } from './workspace-path.js'

export const readToolInputSchema = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'Workspace-relative path of the text file to read.'
    },
    offset: {
      type: 'integer',
      minimum: 1,
      description: '1-based line number to start reading from.'
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 2000,
      description: 'Maximum number of lines to return.'
    }
  },
  required: ['file_path'],
  additionalProperties: false
} satisfies ToolInputSchema

const readToolInputValidator = z
  .object({
    file_path: z.string().min(1),
    offset: z.number().int().min(1).optional().default(1),
    limit: z.number().int().min(1).max(2000).optional()
  })
  .strict()

export const readTool: AgentTool = {
  name: 'Read',
  description: 'Read a text file from the current workspace. Supports offset and limit.',
  inputSchema: readToolInputSchema,

  isReadOnly() {
    return true
  },

  isEnabled() {
    return true
  },

  async call(input: JsonObject, context): Promise<ToolCallResult> {
    const parsed = readToolInputValidator.safeParse(input)

    if (!parsed.success) {
      return errorResult(`Error: invalid Read input: ${formatZodError(parsed.error)}`)
    }

    try {
      const resolvedPath = await resolveWorkspacePath(parsed.data.file_path, context.cwd)
      const raw = await fs.readFile(resolvedPath, 'utf8')
      const allLines = raw.split(/\r?\n/)
      const startIndex = parsed.data.offset - 1
      const endIndex =
        parsed.data.limit === undefined ? allLines.length : startIndex + parsed.data.limit
      const selectedLines = allLines.slice(startIndex, endIndex)
      const workspaceRoot = await fs.realpath(context.cwd)
      const relativePath = normalizePath(path.relative(workspaceRoot, resolvedPath))

      return {
        content: [
          `File: ${relativePath}`,
          `Lines: ${startIndex + 1}-${startIndex + selectedLines.length} / ${allLines.length}`,
          addLineNumbers(selectedLines.join('\n'), startIndex + 1)
        ].join('\n')
      }
    } catch (error) {
      return errorResult(`Error reading file: ${formatError(error)}`)
    }
  }
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

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}
