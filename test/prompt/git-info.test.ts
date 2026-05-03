import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getGitInfo } from '../../src/prompt/git-info.js'

const execFileAsync = promisify(execFile)

describe('getGitInfo', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qing-agent-git-info-'))
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('returns branch and status in a git repository', async () => {
    await execFileAsync('git', ['init'], { cwd: tempRoot })
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempRoot })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: tempRoot })
    await fs.writeFile(path.join(tempRoot, 'file.txt'), 'hello')
    await execFileAsync('git', ['add', '.'], { cwd: tempRoot })
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: tempRoot })

    const info = await getGitInfo(tempRoot)

    expect(info).not.toBeNull()
    expect(['main', 'master']).toContain(info!.branch)
    expect(info!.status).toBe('')
  })

  it('includes modified files in status', async () => {
    await execFileAsync('git', ['init'], { cwd: tempRoot })
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempRoot })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: tempRoot })
    await fs.writeFile(path.join(tempRoot, 'file.txt'), 'hello')
    await execFileAsync('git', ['add', '.'], { cwd: tempRoot })
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: tempRoot })
    await fs.writeFile(path.join(tempRoot, 'file.txt'), 'changed')

    const info = await getGitInfo(tempRoot)

    expect(info).not.toBeNull()
    expect(info!.status).toContain('file.txt')
  })

  it('returns null for a non-git directory', async () => {
    const info = await getGitInfo(tempRoot)

    expect(info).toBeNull()
  })
})
