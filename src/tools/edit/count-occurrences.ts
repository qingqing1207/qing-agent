export function countOccurrences(value: string, search: string): number {
  if (search.length === 0) {
    return 0
  }

  let count = 0
  let index = 0

  while (true) {
    const foundIndex = value.indexOf(search, index)

    if (foundIndex === -1) {
      return count
    }

    count += 1
    index = foundIndex + search.length
  }
}
