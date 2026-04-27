export type ReplCommand =
  | { type: 'exit' }
  | { type: 'clear' }
  | { type: 'message'; text: string }
  | { type: 'empty' }

export function parseReplInput(input: string): ReplCommand {
  const text = input.trim()

  if (!text) return { type: 'empty' }
  if (text === '/exit') return { type: 'exit' }
  if (text === '/clear') return { type: 'clear' }

  return { type: 'message', text }
}
