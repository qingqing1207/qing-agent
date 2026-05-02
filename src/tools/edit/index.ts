import fs from 'node:fs/promises'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { z } from 'zod'
import { resolveExistingWorkspacePath } from '../workspace-path.js'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'
import { countOccurrences } from './count-occurrences.js'

const MAX_EDIT_FILE_BYTES = 1_000_000
const MAX_DIFF_CHARS = 20_000

export const editToolInputSchema = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'Workspace-relative path of the existing text file to edit.'
    },
    old_string: {
      type: 'string',
      description: 'Exact string to replace. It must appear exactly once.'
    },
    new_string: {
      type: 'string',
      description: 'Replacement string.'
    }
  },
  required: ['file_path', 'old_string', 'new_string'],
  additionalProperties: false
} satisfies ToolInputSchema

const editInputValidator = z
  .object({
    file_path: z.string().min(1),
    old_string: z.string().min(1),
    new_string: z.string()
  })
  .strict()

export const editTool: AgentTool = {
  name: 'Edit',
  description: 'Replace one unique string inside an existing workspace text file.',
  inputSchema: editToolInputSchema,

  isReadOnly() {
    return false
  },

  isEnabled() {
    return process.env.QING_ENABLE_WRITE_TOOLS === '1'
  },

  async call(input: JsonObject, context): Promise<ToolCallResult> {
    const parsed = editInputValidator.safeParse(input)

    if (!parsed.success) {
      return errorResult(`Error: invalid Edit input: ${formatZodError(parsed.error)}`)
    }

    try {
      const resolvedPath = await resolveExistingWorkspacePath(parsed.data.file_path, context.cwd)
      const stat = await fs.stat(resolvedPath)

      if (!stat.isFile()) {
        return errorResult(`Error: Edit target is not a file: ${parsed.data.file_path}`)
      }

      if (stat.size > MAX_EDIT_FILE_BYTES) {
        return errorResult(
          `Error: file is too large to edit: ${parsed.data.file_path} (${stat.size} bytes)`
        )
      }

      const original = await fs.readFile(resolvedPath, 'utf8')
      const matches = countOccurrences(original, parsed.data.old_string)

      if (matches !== 1) {
        return errorResult(`Error: expected exactly 1 match, got ${matches}`)
      }

      const updated = original.replace(parsed.data.old_string, parsed.data.new_string)
      await fs.writeFile(resolvedPath, updated, 'utf8')

      const workspaceRoot = await fs.realpath(context.cwd)
      const relativePath = normalizePath(path.relative(workspaceRoot, resolvedPath))

      return {
        content: [
          `Edited ${relativePath}`,
          '',
          formatDiff(relativePath, original, updated)
        ].join('\n')
      }
    } catch (error) {
      return errorResult(`Error running Edit: ${formatError(error)}`)
    }
  }
}

function formatDiff(filePath: string, original: string, updated: string): string {
  const diff = createTwoFilesPatch(filePath, filePath, original, updated, 'before', 'after')

  if (diff.length <= MAX_DIFF_CHARS) {
    return diff
  }

  return `${diff.slice(0, MAX_DIFF_CHARS).trimEnd()}\n[diff truncated]`
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
