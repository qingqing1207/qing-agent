import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { InputReader } from './types.js'

export function createReadlineInputReader(): InputReader {
  return readline.createInterface({ input, output })
}
