import fs from 'node:fs/promises'
import path from 'node:path'

// 例子1
// await resolveWorkspacePath('src/index.ts', '/Users/me/project')
// workspaceRoot     = '/Users/me/project'
// candidatePath     = '/Users/me/project/src/index.ts'
// realCandidatePath = '/Users/me/project/src/index.ts'
// 返回 '/Users/me/project/src/index.ts'

// 例子2
// await resolveWorkspacePath('../secret.txt', '/Users/me/project')
// workspaceRoot     = '/Users/me/project'
// candidatePath     = '/Users/me/secret.txt'
// realCandidatePath = '/Users/me/secret.txt'
// 抛错：Path is outside the workspace

// 例子3，符号链接逃逸
// /Users/me/project/link.txt -> /Users/me/.ssh/id_rsa
// await resolveWorkspacePath('link.txt', '/Users/me/project')
// workspaceRoot     = '/Users/me/project'
// candidatePath     = '/Users/me/project/link.txt'
// realCandidatePath = '/Users/me/.ssh/id_rsa'
// 抛错：Path is outside the workspace

export async function resolveExistingWorkspacePath(filePath: string, cwd: string): Promise<string> {
  const workspaceRoot = await fs.realpath(cwd)
  const candidatePath = path.resolve(workspaceRoot, filePath)
  const realCandidatePath = await fs.realpath(candidatePath)

  if (!isInsideWorkspace(realCandidatePath, workspaceRoot)) {
    throw new Error(`Path is outside the workspace: ${filePath}`)
  }

  return realCandidatePath
}

function isInsideWorkspace(candidatePath: string, workspaceRoot: string): boolean {
  const relativePath = path.relative(workspaceRoot, candidatePath)

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}
