import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AgentTool, JsonObject, ToolCallResult, ToolInputSchema } from '../types.js'
import { resolveNewWorkspacePath } from '../workspace-path.js'

const MAX_WRITE_BYTES = 1_000_000

export const writeToolInputSchema = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'Workspace-relative path of the new text file to create.'
    },
    content: {
      type: 'string',
      description: 'Complete text content to write into the new file.'
    }
  },
  required: ['file_path', 'content'],
  additionalProperties: false
} satisfies ToolInputSchema

const writeInputValidator = z
  .object({
    file_path: z.string().min(1),
    content: z.string()
  })
  .strict()

export const writeTool: AgentTool = {
  name: 'Write',
  description: 'Create a new text file in the current workspace. Existing files are not overwritten.',
  inputSchema: writeToolInputSchema,

  isReadOnly() {
    return false
  },

  isEnabled() {
    return process.env.QING_ENABLE_WRITE_TOOLS === '1'
  },

  async call(input: JsonObject, context): Promise<ToolCallResult> {
    const parsed = writeInputValidator.safeParse(input)

    if (!parsed.success) {
      return errorResult(`Error: invalid Write input: ${formatZodError(parsed.error)}`)
    }

    try {
      const contentBytes = Buffer.byteLength(parsed.data.content, 'utf8')

      if (contentBytes > MAX_WRITE_BYTES) {
        return errorResult(
          `Error: content is too large to write: ${parsed.data.file_path} (${contentBytes} bytes)`
        )
      }

      const resolvedPath = await resolveNewWorkspacePath(parsed.data.file_path, context.cwd)
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
      await fs.writeFile(resolvedPath, parsed.data.content, { encoding: 'utf8', flag: 'wx' })

      const workspaceRoot = await fs.realpath(context.cwd)
      const relativePath = normalizePath(path.relative(workspaceRoot, resolvedPath))

      return {
        content: [`Wrote ${relativePath}`, `Bytes: ${contentBytes}`].join('\n')
      }
    } catch (error) {
      if (isFileExistsError(error)) {
        return errorResult(`Error: file already exists: ${parsed.data.file_path}`)
      }

      return errorResult(`Error running Write: ${formatError(error)}`)
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

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}
