import { describe, expect, it } from 'vitest'
import { addLineNumbers } from '../../../src/tools/read/line-numbers.js'

describe('addLineNumbers', () => {
  it('starts at line 1 by default', () => {
    expect(addLineNumbers('alpha\nbeta')).toBe('1\talpha\n2\tbeta')
  })

  it('can start from a specified line number', () => {
    expect(addLineNumbers('alpha\nbeta', 10)).toBe('10\talpha\n11\tbeta')
  })

  it('handles Windows line endings', () => {
    expect(addLineNumbers('alpha\r\nbeta\r\ngamma')).toBe('1\talpha\n2\tbeta\n3\tgamma')
  })

  it('right-aligns multi-digit line numbers', () => {
    expect(addLineNumbers('a\nb\nc', 9)).toBe(' 9\ta\n10\tb\n11\tc')
  })
})
