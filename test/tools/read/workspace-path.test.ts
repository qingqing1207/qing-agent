import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveWorkspacePath } from '../../../src/tools/read/workspace-path.js'

describe('resolveWorkspacePath', () => {
  let tempRoot: string
  let workspaceRoot: string
  let outsideRoot: string

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qing-agent-read-'))
    workspaceRoot = path.join(tempRoot, 'workspace')
    outsideRoot = path.join(tempRoot, 'outside')

    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
    await fs.mkdir(outsideRoot, { recursive: true })
    await fs.writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'export {}\n')
    await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'secret\n')
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('resolves a workspace-relative path', async () => {
    await expect(resolveWorkspacePath('src/index.ts', workspaceRoot)).resolves.toBe(
      path.join(workspaceRoot, 'src', 'index.ts')
    )
  })

  it('resolves a dot-prefixed workspace-relative path', async () => {
    await expect(resolveWorkspacePath('./src/index.ts', workspaceRoot)).resolves.toBe(
      path.join(workspaceRoot, 'src', 'index.ts')
    )
  })

  it('rejects parent-directory traversal outside the workspace', async () => {
    await expect(resolveWorkspacePath('../outside/secret.txt', workspaceRoot)).rejects.toThrow(
      'Path is outside the workspace'
    )
  })

  it('rejects an absolute path outside the workspace', async () => {
    await expect(
      resolveWorkspacePath(path.join(outsideRoot, 'secret.txt'), workspaceRoot)
    ).rejects.toThrow('Path is outside the workspace')
  })

  it('rejects a symlink that points outside the workspace', async () => {
    const linkPath = path.join(workspaceRoot, 'linked-secret.txt')

    await fs.symlink(path.join(outsideRoot, 'secret.txt'), linkPath)

    await expect(resolveWorkspacePath('linked-secret.txt', workspaceRoot)).rejects.toThrow(
      'Path is outside the workspace'
    )
  })
})
