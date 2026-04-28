import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTool } from '../../../src/tools/read/index.js'

describe('readTool', () => {
  let tempRoot: string
  let workspaceRoot: string
  let outsideRoot: string

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qing-agent-read-tool-'))
    workspaceRoot = path.join(tempRoot, 'workspace')
    outsideRoot = path.join(tempRoot, 'outside')

    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
    await fs.mkdir(outsideRoot, { recursive: true })
    await fs.writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'alpha\nbeta\ngamma')
    await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'secret')
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('reads a complete file with line numbers', async () => {
    const result = await readTool.call({ file_path: 'src/index.ts' }, { cwd: workspaceRoot })

    expect(result).toEqual({
      content: ['File: src/index.ts', 'Lines: 1-3 / 3', '1\talpha\n2\tbeta\n3\tgamma'].join('\n')
    })
  })

  it('starts reading from offset', async () => {
    const result = await readTool.call(
      { file_path: 'src/index.ts', offset: 2 },
      { cwd: workspaceRoot }
    )

    expect(result.content).toContain('Lines: 2-3 / 3')
    expect(result.content).toContain('2\tbeta\n3\tgamma')
  })

  it('limits the number of returned lines', async () => {
    const result = await readTool.call(
      { file_path: 'src/index.ts', limit: 2 },
      { cwd: workspaceRoot }
    )

    expect(result.content).toContain('Lines: 1-2 / 3')
    expect(result.content).toContain('1\talpha\n2\tbeta')
  })

  it('returns an error when file_path is missing', async () => {
    const result = await readTool.call({}, { cwd: workspaceRoot })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error: invalid Read input')
  })

  it('returns an error for invalid input', async () => {
    const result = await readTool.call(
      { file_path: 'src/index.ts', offset: 0 },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error: invalid Read input')
  })

  it('returns an error when the file does not exist', async () => {
    const result = await readTool.call({ file_path: 'missing.ts' }, { cwd: workspaceRoot })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error reading file')
  })

  it('returns an error for paths outside the workspace', async () => {
    const result = await readTool.call(
      { file_path: '../outside/secret.txt' },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Path is outside the workspace')
  })
})
