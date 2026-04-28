export function addLineNumbers(text: string, startLine = 1): string {
  const lines = text.split(/\r?\n/)
  const width = String(startLine + lines.length - 1).length

  return lines
    .map((line, index) => `${String(startLine + index).padStart(width, ' ')}\t${line}`)
    .join('\n')
}
