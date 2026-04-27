import type { Renderer } from './types.js'

export const consoleRenderer: Renderer = {
  line(text = '') {
    console.log(text)
  },

  write(text: string) {
    process.stdout.write(text)
  }
}
