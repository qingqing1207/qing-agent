export type InputReader = {
  question(label: string): Promise<string>
  close(): void
}

export type Renderer = {
  line(text?: string): void
  write(text: string): void
}
