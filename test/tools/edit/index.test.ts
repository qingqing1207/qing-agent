import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editTool } from '../../../src/tools/edit/index.js'

describe('editTool', () => {
  let tempRoot: string
  let workspaceRoot: string
  let outsideRoot: string

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qing-agent-edit-'))
    workspaceRoot = path.join(tempRoot, 'workspace')
    outsideRoot = path.join(tempRoot, 'outside')

    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
    await fs.mkdir(outsideRoot, { recursive: true })

    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'index.ts'),
      ['const value = "old"', 'console.log(value)', ''].join('\n')
    )
    await fs.writeFile(path.join(outsideRoot, 'secret.ts'), 'const value = "old"\n')
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('is disabled unless write tools are explicitly enabled', () => {
    const previous = process.env.QING_ENABLE_WRITE_TOOLS

    try {
      delete process.env.QING_ENABLE_WRITE_TOOLS
      expect(editTool.isEnabled()).toBe(false)

      process.env.QING_ENABLE_WRITE_TOOLS = '1'
      expect(editTool.isEnabled()).toBe(true)
    } finally {
      restoreEnv('QING_ENABLE_WRITE_TOOLS', previous)
    }
  })

  it('replaces a unique string in an existing file', async () => {
    const result = await editTool.call(
      {
        file_path: 'src/index.ts',
        old_string: 'const value = "old"',
        new_string: 'const value = "new"'
      },
      { cwd: workspaceRoot }
    )

    await expect(fs.readFile(path.join(workspaceRoot, 'src', 'index.ts'), 'utf8')).resolves.toContain(
      'const value = "new"'
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Edited src/index.ts')
    expect(result.content).toContain('-const value = "old"')
    expect(result.content).toContain('+const value = "new"')
  })

  it('returns an error when old_string is empty', async () => {
    const result = await editTool.call(
      {
        file_path: 'src/index.ts',
        old_string: '',
        new_string: 'replacement'
      },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error: invalid Edit input')
  })

  it('returns an error when old_string does not exist', async () => {
    const result = await editTool.call(
      {
        file_path: 'src/index.ts',
        old_string: 'missing',
        new_string: 'replacement'
      },
      { cwd: workspaceRoot }
    )

    expect(result).toEqual({ content: 'Error: expected exactly 1 match, got 0', isError: true })
  })

  it('returns an error when old_string appears multiple times', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'old\nold\n')

    const result = await editTool.call(
      {
        file_path: 'src/index.ts',
        old_string: 'old',
        new_string: 'new'
      },
      { cwd: workspaceRoot }
    )

    expect(result).toEqual({ content: 'Error: expected exactly 1 match, got 2', isError: true })
  })

  it('rejects paths outside the workspace', async () => {
    const result = await editTool.call(
      {
        file_path: '../outside/secret.ts',
        old_string: 'old',
        new_string: 'new'
      },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error running Edit')
  })

  it('returns an error when the file does not exist', async () => {
    const result = await editTool.call(
      {
        file_path: 'src/missing.ts',
        old_string: 'old',
        new_string: 'new'
      },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error running Edit')
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
