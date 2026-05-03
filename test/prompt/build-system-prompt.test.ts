import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/prompt/git-info.js', () => ({
  getGitInfo: vi.fn()
}))

vi.mock('../../src/prompt/agent-md.js', () => ({
  readAgentMd: vi.fn()
}))

import { getGitInfo } from '../../src/prompt/git-info.js'
import { readAgentMd } from '../../src/prompt/agent-md.js'
import { buildSystemPrompt } from '../../src/prompt/build-system-prompt.js'

const mockGetGitInfo = vi.mocked(getGitInfo)
const mockReadAgentMd = vi.mocked(readAgentMd)

describe('buildSystemPrompt', () => {
  it('contains the static section with Qing Agent', async () => {
    mockGetGitInfo.mockResolvedValue(null)
    mockReadAgentMd.mockResolvedValue(null)

    const result = await buildSystemPrompt({ cwd: '/workspace' })

    expect(result).toContain('<SYSTEM_STATIC_CONTEXT>')
    expect(result).toContain('</SYSTEM_STATIC_CONTEXT>')
    expect(result).toContain('You are Qing Agent, a terminal-native coding assistant.')
  })

  it('contains cwd', async () => {
    mockGetGitInfo.mockResolvedValue(null)
    mockReadAgentMd.mockResolvedValue(null)

    const result = await buildSystemPrompt({ cwd: '/my/project' })

    expect(result).toContain('- Current working directory: /my/project')
  })

  it('contains current date', async () => {
    mockGetGitInfo.mockResolvedValue(null)
    mockReadAgentMd.mockResolvedValue(null)

    const result = await buildSystemPrompt({ cwd: '/workspace' })

    expect(result).toMatch(/- Current date: \d{4}-\d{2}-\d{2}T/)
  })

  it('contains OS information', async () => {
    mockGetGitInfo.mockResolvedValue(null)
    mockReadAgentMd.mockResolvedValue(null)

    const result = await buildSystemPrompt({ cwd: '/workspace' })

    expect(result).toContain('- OS:')
  })

  it('contains git info when available', async () => {
    mockGetGitInfo.mockResolvedValue({ branch: 'main', status: 'M src/index.ts' })
    mockReadAgentMd.mockResolvedValue(null)

    const result = await buildSystemPrompt({ cwd: '/workspace' })

    expect(result).toContain('- Git branch: main')
    expect(result).toContain('- Git status:\nM src/index.ts')
  })

  it('shows clean when git status is empty', async () => {
    mockGetGitInfo.mockResolvedValue({ branch: 'main', status: '' })
    mockReadAgentMd.mockResolvedValue(null)

    const result = await buildSystemPrompt({ cwd: '/workspace' })

    expect(result).toContain('- Git status:\nclean')
  })

  it('shows Git: not available when git is unavailable', async () => {
    mockGetGitInfo.mockResolvedValue(null)
    mockReadAgentMd.mockResolvedValue(null)

    const result = await buildSystemPrompt({ cwd: '/workspace' })

    expect(result).toContain('- Git: not available')
  })

  it('includes additionalInstructions when provided', async () => {
    mockGetGitInfo.mockResolvedValue(null)
    mockReadAgentMd.mockResolvedValue(null)

    const result = await buildSystemPrompt({
      cwd: '/workspace',
      additionalInstructions: 'Be extra careful with edits.'
    })

    expect(result).toContain('- Session instructions:\nBe extra careful with edits.')
  })

  it('does not include additionalInstructions when omitted', async () => {
    mockGetGitInfo.mockResolvedValue(null)
    mockReadAgentMd.mockResolvedValue(null)

    const result = await buildSystemPrompt({ cwd: '/workspace' })

    expect(result).not.toContain('Session instructions')
  })

  it('includes AGENT.md content when file exists', async () => {
    mockGetGitInfo.mockResolvedValue(null)
    mockReadAgentMd.mockResolvedValue('Project-specific context.')

    const result = await buildSystemPrompt({ cwd: '/workspace' })

    expect(result).toContain('# Source: /workspace/AGENT.md')
    expect(result).toContain('Project-specific context.')
  })

  it('does not include AGENT.md when file does not exist', async () => {
    mockGetGitInfo.mockResolvedValue(null)
    mockReadAgentMd.mockResolvedValue(null)

    const result = await buildSystemPrompt({ cwd: '/workspace' })

    expect(result).not.toContain('AGENT.md')
  })

  it('separates sections with double newlines', async () => {
    mockGetGitInfo.mockResolvedValue(null)
    mockReadAgentMd.mockResolvedValue(null)

    const result = await buildSystemPrompt({ cwd: '/workspace' })

    expect(result).toContain('</SYSTEM_STATIC_CONTEXT>\n\n<SYSTEM_DYNAMIC_CONTEXT>')
    expect(result).toContain('</SYSTEM_DYNAMIC_CONTEXT>')
  })
})
