import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { globTool } from '../../../src/tools/glob/index.js'

describe('globTool', () => {
  let tempRoot: string
  let workspaceRoot: string
  let outsideRoot: string

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qing-agent-glob-'))
    workspaceRoot = path.join(tempRoot, 'workspace')
    outsideRoot = path.join(tempRoot, 'outside')

    await fs.mkdir(path.join(workspaceRoot, 'src', 'llm'), { recursive: true })
    await fs.mkdir(outsideRoot, { recursive: true })

    await fs.writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'export {}\n')
    await fs.writeFile(path.join(workspaceRoot, 'src', 'llm', 'types.ts'), 'export {}\n')
    await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# test\n')
    await fs.writeFile(path.join(outsideRoot, 'secret.ts'), 'secret\n')
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('finds files by glob pattern', async () => {
    const result = await globTool.call({ pattern: '*.ts', path: 'src' }, { cwd: workspaceRoot })

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('index.ts')
    expect(result.content).toContain(path.join('llm', 'types.ts'))
  })

  it('uses workspace root when path is omitted', async () => {
    const result = await globTool.call({ pattern: '*.md' }, { cwd: workspaceRoot })

    expect(result.content).toBe('README.md')
  })

  it('limits returned paths', async () => {
    const result = await globTool.call(
      { pattern: '*.ts', path: 'src', limit: 1 },
      { cwd: workspaceRoot }
    )

    expect(result.content.split(/\r?\n/)).toHaveLength(1)
  })

  it('returns a friendly message when no files match', async () => {
    const result = await globTool.call({ pattern: '*.missing' }, { cwd: workspaceRoot })

    expect(result).toEqual({ content: 'No files matched' })
  })

  it('returns an error for invalid input', async () => {
    const result = await globTool.call({ pattern: '' }, { cwd: workspaceRoot })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error: invalid Glob input')
  })

  it('rejects paths outside the workspace', async () => {
    const result = await globTool.call(
      { pattern: '*.ts', path: '../outside' },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error running Glob')
  })
})
