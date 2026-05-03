import os from 'node:os'
import path from 'node:path'
import { getGitInfo } from './git-info.js'
import { readAgentMd } from './agent-md.js'

export type BuildSystemPromptInput = {
  cwd: string
  additionalInstructions?: string
}

export async function buildSystemPrompt(input: BuildSystemPromptInput): Promise<string> {
  const { cwd, additionalInstructions } = input

  const staticSection = [
    '<SYSTEM_STATIC_CONTEXT>',
    'You are Qing Agent, a terminal-native coding assistant.',
    'Be concise, practical, and action-oriented.',
    'Prefer specialized tools before using Bash.',
    'Understand the code before changing it.',
    '</SYSTEM_STATIC_CONTEXT>'
  ].join('\n')

  const parts: string[] = []

  parts.push('- Current working directory: ' + cwd)
  parts.push('- Current date: ' + new Date().toISOString())
  parts.push('- OS: ' + os.platform() + ' ' + os.release() + ' (' + os.arch() + ')')

  const gitInfo = await getGitInfo(cwd)
  if (gitInfo) {
    parts.push('- Git branch: ' + gitInfo.branch)
    parts.push('- Git status:\n' + (gitInfo.status || 'clean'))
  } else {
    parts.push('- Git: not available')
  }

  if (additionalInstructions) {
    parts.push('- Session instructions:\n' + additionalInstructions)
  }

  const agentMd = await readAgentMd(cwd)
  if (agentMd) {
    parts.push('# Source: ' + path.join(cwd, 'AGENT.md') + '\n' + agentMd)
  }

  return [
    staticSection,
    '<SYSTEM_DYNAMIC_CONTEXT>',
    parts.join('\n\n'),
    '</SYSTEM_DYNAMIC_CONTEXT>'
  ].join('\n\n')
}
