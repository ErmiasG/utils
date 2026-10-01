import { diffLines, createTwoFilesPatch } from 'diff'

export function compareTexts(before, after, options = {}) {
  if (before.length + after.length > 4_000_000) throw new Error('Compare up to 4 million characters combined. Split larger files into smaller sections.')
  const parts = diffLines(before, after, { ignoreWhitespace: options.ignoreWhitespace, stripTrailingCr: options.ignoreLineEndings, timeout: 3000, maxEditLength: 20_000 })
  if (!parts) throw new Error('These files are too different to compare within the time limit. Try a smaller section.')
  let oldLine = 1
  let newLine = 1
  let added = 0
  let removed = 0
  const rows = []
  for (const part of parts) {
    const lines = part.value.split('\n')
    if (lines.at(-1) === '') lines.pop()
    for (const text of lines) {
      const type = part.added ? 'added' : part.removed ? 'removed' : 'same'
      rows.push({ text, type, oldLine: part.added ? null : oldLine++, newLine: part.removed ? null : newLine++ })
      if (part.added) added++
      if (part.removed) removed++
    }
  }
  // The patch always preserves exact input bytes, independently of display filters.
  const patch = createTwoFilesPatch(options.oldName || 'original.txt', options.newName || 'modified.txt', before, after, '', '', { timeout: 3000, maxEditLength: 20_000 })
  return { rows, added, removed, identical: added === 0 && removed === 0, patch: patch ?? null }
}
