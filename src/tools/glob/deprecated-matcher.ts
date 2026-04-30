import fs from 'node:fs/promises'
import path from 'node:path'

// Deprecated: Glob 现在使用 fast-glob 提供文件遍历和 glob 匹配能力。
// 这份手写实现只保留作学习/历史参考，不要在正式工具逻辑中继续引用。
export async function deprecatedListFiles(root: string, current = root): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (deprecatedShouldSkipEntry(entry.name)) {
      continue
    }

    const fullPath = path.join(current, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await deprecatedListFiles(root, fullPath)))
      continue
    }

    if (entry.isFile()) {
      files.push(path.relative(root, fullPath))
    }
  }

  return files
}

export function deprecatedShouldSkipEntry(name: string): boolean {
  return name === '.git' || name === 'node_modules' || name === 'dist'
}

export function deprecatedMatchesGlob(filePath: string, pattern: string): boolean {
  const normalizedFilePath = filePath.split(path.sep).join('/')
  const normalizedPattern = pattern.split(path.sep).join('/')

  if (!normalizedPattern.includes('/')) {
    return deprecatedMatchesGlobSegment(path.basename(normalizedFilePath), normalizedPattern)
  }

  return deprecatedGlobToRegExp(normalizedPattern).test(normalizedFilePath)
}

export function deprecatedMatchesGlobSegment(value: string, pattern: string): boolean {
  return deprecatedGlobToRegExp(pattern).test(value)
}

export function deprecatedGlobToRegExp(pattern: string): RegExp {
  let regex = ''
  let index = 0

  while (index < pattern.length) {
    const char = pattern[index] as string
    const nextChar = pattern[index + 1]
    const charAfterNext = pattern[index + 2]

    if (char === '*' && nextChar === '*') {
      if (charAfterNext === '/') {
        regex += '(?:.*/)?'
        index += 3
        continue
      }

      regex += '.*'
      index += 2
      continue
    }

    if (char === '*') {
      regex += '[^/]*'
      index += 1
      continue
    }

    if (char === '?') {
      regex += '[^/]'
      index += 1
      continue
    }

    regex += deprecatedEscapeRegExpChar(char)
    index += 1
  }

  return new RegExp(`^${regex}$`)
}

function deprecatedEscapeRegExpChar(char: string): string {
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char
}
