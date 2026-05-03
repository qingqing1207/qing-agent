import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeTool } from '../../../src/tools/write/index.js'

describe('writeTool', () => {
  let tempRoot: string
  let workspaceRoot: string
  let outsideRoot: string

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qing-agent-write-'))
    workspaceRoot = path.join(tempRoot, 'workspace')
    outsideRoot = path.join(tempRoot, 'outside')

    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
    await fs.mkdir(outsideRoot, { recursive: true })
    await fs.writeFile(path.join(workspaceRoot, 'src', 'existing.ts'), 'old\n')
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('is disabled unless write tools are explicitly enabled', () => {
    const previous = process.env.QING_ENABLE_WRITE_TOOLS

    try {
      delete process.env.QING_ENABLE_WRITE_TOOLS
      expect(writeTool.isEnabled()).toBe(false)

      process.env.QING_ENABLE_WRITE_TOOLS = '1'
      expect(writeTool.isEnabled()).toBe(true)
    } finally {
      restoreEnv('QING_ENABLE_WRITE_TOOLS', previous)
    }
  })

  it('creates a new file', async () => {
    const result = await writeTool.call(
      {
        file_path: 'src/new.ts',
        content: 'export const value = 1\n'
      },
      { cwd: workspaceRoot }
    )

    await expect(fs.readFile(path.join(workspaceRoot, 'src', 'new.ts'), 'utf8')).resolves.toBe(
      'export const value = 1\n'
    )
    expect(result).toEqual({
      content: 'Wrote src/new.ts\nBytes: 23'
    })
  })

  it('creates parent directories automatically', async () => {
    const result = await writeTool.call(
      {
        file_path: 'src/generated/nested.ts',
        content: 'nested\n'
      },
      { cwd: workspaceRoot }
    )

    await expect(
      fs.readFile(path.join(workspaceRoot, 'src', 'generated', 'nested.ts'), 'utf8')
    ).resolves.toBe('nested\n')
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Wrote src/generated/nested.ts')
  })

  it('does not overwrite an existing file', async () => {
    const result = await writeTool.call(
      {
        file_path: 'src/existing.ts',
        content: 'new\n'
      },
      { cwd: workspaceRoot }
    )

    await expect(fs.readFile(path.join(workspaceRoot, 'src', 'existing.ts'), 'utf8')).resolves.toBe(
      'old\n'
    )
    expect(result).toEqual({
      content: 'Error: file already exists: src/existing.ts',
      isError: true
    })
  })

  it('allows empty file content', async () => {
    const result = await writeTool.call(
      {
        file_path: 'empty.txt',
        content: ''
      },
      { cwd: workspaceRoot }
    )

    await expect(fs.readFile(path.join(workspaceRoot, 'empty.txt'), 'utf8')).resolves.toBe('')
    expect(result).toEqual({
      content: 'Wrote empty.txt\nBytes: 0'
    })
  })

  it('rejects paths outside the workspace', async () => {
    const result = await writeTool.call(
      {
        file_path: '../outside/new.ts',
        content: 'secret\n'
      },
      { cwd: workspaceRoot }
    )

    await expect(fs.readdir(outsideRoot)).resolves.toEqual([])
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error running Write')
    expect(result.content).toContain('Path is outside the workspace')
  })

  it('returns an error for invalid input', async () => {
    const result = await writeTool.call(
      {
        file_path: '',
        content: 'value\n'
      },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error: invalid Write input')
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
