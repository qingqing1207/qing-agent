import fs from 'node:fs/promises'
import path from 'node:path'

export async function readAgentMd(cwd: string): Promise<string | null> {
  try {
    const content = await fs.readFile(path.join(cwd, 'AGENT.md'), 'utf8')
    return content.trim()
  } catch {
    return null
  }
}
