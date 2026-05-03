import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAgentMd } from '../../src/prompt/agent-md.js'

describe('readAgentMd', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qing-agent-agent-md-'))
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('returns file content when AGENT.md exists', async () => {
    await fs.writeFile(path.join(tempRoot, 'AGENT.md'), '# Project Notes\nSome context.')

    const result = await readAgentMd(tempRoot)

    expect(result).toBe('# Project Notes\nSome context.')
  })

  it('returns null when AGENT.md does not exist', async () => {
    const result = await readAgentMd(tempRoot)

    expect(result).toBeNull()
  })

  it('returns empty string when AGENT.md is empty', async () => {
    await fs.writeFile(path.join(tempRoot, 'AGENT.md'), '')

    const result = await readAgentMd(tempRoot)

    expect(result).toBe('')
  })

  it('trims whitespace from content', async () => {
    await fs.writeFile(path.join(tempRoot, 'AGENT.md'), '  \n  content  \n  ')

    const result = await readAgentMd(tempRoot)

    expect(result).toBe('content')
  })
})
