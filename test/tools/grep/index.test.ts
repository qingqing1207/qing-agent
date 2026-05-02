import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grepTool } from '../../../src/tools/grep/index.js'

describe('grepTool', () => {
  let tempRoot: string
  let workspaceRoot: string
  let outsideRoot: string

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qing-agent-grep-'))
    workspaceRoot = path.join(tempRoot, 'workspace')
    outsideRoot = path.join(tempRoot, 'outside')

    await fs.mkdir(path.join(workspaceRoot, 'src', 'agent'), { recursive: true })
    await fs.mkdir(path.join(workspaceRoot, 'src', 'cli'), { recursive: true })
    await fs.mkdir(path.join(workspaceRoot, 'node_modules', 'pkg'), { recursive: true })
    await fs.mkdir(outsideRoot, { recursive: true })

    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'agent', 'agent-loop.ts'),
      ['export async function runAgentTurn() {', '  return "agent"', '}'].join('\n')
    )
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'cli', 'repl.ts'),
      ['export function runRepl() {', '  return "repl"', '}'].join('\n')
    )
    await fs.writeFile(path.join(workspaceRoot, 'README.md'), 'runAgentTurn docs\n')
    await fs.writeFile(
      path.join(workspaceRoot, 'node_modules', 'pkg', 'index.ts'),
      'runAgentTurn dependency\n'
    )
    await fs.writeFile(path.join(outsideRoot, 'secret.ts'), 'runAgentTurn secret\n')
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('finds matching lines by regex pattern', async () => {
    const result = await grepTool.call(
      { pattern: 'runAgentTurn', path: 'src' },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain(path.join('src', 'agent', 'agent-loop.ts'))
    expect(result.content).toContain('runAgentTurn')
  })

  it('uses workspace root when path is omitted', async () => {
    const result = await grepTool.call({ pattern: 'runAgentTurn' }, { cwd: workspaceRoot })

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('README.md')
    expect(result.content).not.toContain('node_modules')
  })

  it('limits returned matching lines', async () => {
    const result = await grepTool.call(
      { pattern: 'return', path: 'src', limit: 1 },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBeUndefined()
    expect(result.content.split(/\r?\n/)).toHaveLength(1)
  })

  it('returns a friendly message when no lines match', async () => {
    const result = await grepTool.call({ pattern: 'missing-pattern' }, { cwd: workspaceRoot })

    expect(result).toEqual({ content: 'No matches found' })
  })

  it('returns an error for invalid input', async () => {
    const result = await grepTool.call({ pattern: '' }, { cwd: workspaceRoot })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error: invalid Grep input')
  })

  it('returns an error for invalid regex patterns', async () => {
    const result = await grepTool.call({ pattern: '[' }, { cwd: workspaceRoot })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error running Grep')
  })

  it('rejects paths outside the workspace', async () => {
    const result = await grepTool.call(
      { pattern: 'runAgentTurn', path: '../outside' },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error running Grep')
  })
})
