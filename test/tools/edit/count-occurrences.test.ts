import { describe, expect, it } from 'vitest'
import { countOccurrences } from '../../../src/tools/edit/count-occurrences.js'

describe('countOccurrences', () => {
  it('counts non-overlapping occurrences', () => {
    expect(countOccurrences('one two one two one', 'one')).toBe(3)
  })

  it('returns zero when the search string is missing', () => {
    expect(countOccurrences('one two three', 'missing')).toBe(0)
  })

  it('returns zero for an empty search string', () => {
    expect(countOccurrences('abc', '')).toBe(0)
  })

  it('does not count overlapping occurrences', () => {
    expect(countOccurrences('aaaa', 'aa')).toBe(2)
  })
})
