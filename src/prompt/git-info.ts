import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type GitInfo = {
  branch: string
  status: string
}

export async function getGitInfo(cwd: string): Promise<GitInfo | null> {
  try {
    const [branch, status] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }),
      execFileAsync('git', ['status', '--short'], { cwd })
    ])

    return {
      branch: branch.stdout.trim(),
      status: status.stdout.trim()
    }
  } catch {
    return null
  }
}
