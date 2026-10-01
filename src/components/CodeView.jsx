import { useMemo } from 'react'
import { highlight } from '../lib/highlight'

// Past this size syntax highlighting costs more than it is worth, so the view
// falls back to plain monospace text and stays responsive.
const HIGHLIGHT_LIMIT = 400_000

// Rendering a gutter for a million lines costs more than the line numbers are
// worth, so past this point the numbers are dropped and the code stays.
const GUTTER_LIMIT = 50_000

export default function CodeView({ code, language, wrap }) {
  const html = useMemo(() => {
    if (!code) return ''
    if (code.length > HIGHLIGHT_LIMIT) return null
    return highlight(code, language)
  }, [code, language])

  const lineCount = useMemo(() => (code ? countLines(code) : 0), [code])
  const gutter = useMemo(
    () => (lineCount > GUTTER_LIMIT
      ? null
      : Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')),
    [lineCount],
  )

  return (
    <div className={`code${wrap ? ' is-wrapped' : ''}`}>
      {gutter !== null && <pre className="code__gutter" aria-hidden="true">{gutter}</pre>}
      <pre className="code__body">
        {html === null || html === '' ? (
          <code className="hljs">{code}</code>
        ) : (
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </pre>
    </div>
  )
}

// Counting newlines beats `split('\n').length`, which allocates an array of
// every line just to read its length.
function countLines(code) {
  let lines = 1
  for (let i = 0; i < code.length; i += 1) {
    if (code.charCodeAt(i) === 10) lines += 1
  }
  return lines
}
