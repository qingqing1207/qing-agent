import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bashTool } from '../../../src/tools/bash/index.js'

describe('bashTool', () => {
  let tempRoot: string
  let workspaceRoot: string

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qing-agent-bash-'))
    workspaceRoot = path.join(tempRoot, 'workspace')

    await fs.mkdir(workspaceRoot, { recursive: true })
    await fs.writeFile(path.join(workspaceRoot, 'hello.txt'), 'hello\n')
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('is disabled unless the Bash tool is explicitly enabled', () => {
    const previous = process.env.QING_ENABLE_BASH_TOOL

    try {
      delete process.env.QING_ENABLE_BASH_TOOL
      expect(bashTool.isEnabled()).toBe(false)

      process.env.QING_ENABLE_BASH_TOOL = '1'
      expect(bashTool.isEnabled()).toBe(true)
    } finally {
      restoreEnv('QING_ENABLE_BASH_TOOL', previous)
    }
  })

  it('executes a command in the workspace', async () => {
    const result = await bashTool.call({ command: 'pwd && ls' }, { cwd: workspaceRoot })

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Exit code: 0')
    expect(result.content).toContain(await fs.realpath(workspaceRoot))
    expect(result.content).toContain('hello.txt')
  })

  it('returns non-zero exit codes as normal command results', async () => {
    const result = await bashTool.call({ command: 'echo before && exit 7' }, { cwd: workspaceRoot })

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Exit code: 7')
    expect(result.content).toContain('before')
  })

  it('captures stderr and stdout together', async () => {
    const result = await bashTool.call(
      { command: 'echo out && echo err >&2' },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('out')
    expect(result.content).toContain('err')
  })

  it('does not expose non-whitelisted environment variables', async () => {
    const previousSecret = process.env.ANTHROPIC_AUTH_TOKEN

    try {
      process.env.ANTHROPIC_AUTH_TOKEN = 'secret-token'
      const result = await bashTool.call(
        {
          command:
            'node -e \'console.log(process.env.ANTHROPIC_AUTH_TOKEN === undefined ? "missing" : process.env.ANTHROPIC_AUTH_TOKEN)\''
        },
        { cwd: workspaceRoot }
      )

      expect(result.isError).toBeUndefined()
      expect(result.content).toContain('missing')
      expect(result.content).not.toContain('secret-token')
    } finally {
      restoreEnv('ANTHROPIC_AUTH_TOKEN', previousSecret)
    }
  })

  it('returns an error for invalid input', async () => {
    const result = await bashTool.call({ command: '' }, { cwd: workspaceRoot })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Error: invalid Bash input')
  })

  it('times out long running commands', async () => {
    const result = await bashTool.call(
      { command: 'node -e "setTimeout(() => {}, 1000)"', timeout_ms: 50 },
      { cwd: workspaceRoot }
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Timed out: true')
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
