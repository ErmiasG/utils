import { useEffect, useRef } from 'react'
import hljs from '../lib/highlight'
import { parseMarkdown, renderMarkdown, sanitizeHtml, slugify } from '../lib/markdown'
import { drawDiagrams, extractDiagrams } from '../lib/mermaid'
import { nextPaint, STAGE_THRESHOLD } from '../lib/schedule'

// Guard rails for pathological documents. A 15 MB markdown file can hold tens
// of thousands of headings and code blocks; decorating every one of them costs
// far more than it is worth.
const MAX_HIGHLIGHTED_BLOCKS = 400
const MAX_ANCHORED_HEADINGS = 1000

export default function MarkdownView({ source, wide, theme, onStage }) {
  const ref = useRef(null)

  // Which theme the diagrams on screen were drawn for. Mermaid bakes its
  // colours into the SVG, so a theme change has to redraw them — but only
  // them, never the whole document.
  const drawnTheme = useRef(null)

  // Read through a ref inside the render effect so switching theme does not
  // re-parse a multi-megabyte document.
  const themeRef = useRef(theme)
  themeRef.current = theme

  useEffect(() => {
    const root = ref.current
    if (!root) return undefined

    let cancelled = false
    const stage = (label) => { if (!cancelled) onStage(label) }

    // Nothing on screen belongs to this document yet, so a theme change in the
    // same commit must not try to redraw the previous document's diagrams.
    drawnTheme.current = null

    const run = async () => {
      if (source.length < STAGE_THRESHOLD) {
        // Small documents go straight through — staging them would only
        // flicker. Everything up to the first `await` still runs in this tick.
        root.innerHTML = renderMarkdown(source)
      } else {
        root.innerHTML = ''
        stage('Parsing markdown…')
        await nextPaint()
        if (cancelled) return

        const parsed = parseMarkdown(source)
        stage('Checking it over…')
        await nextPaint()
        if (cancelled) return

        const html = sanitizeHtml(parsed)
        stage('Building the page…')
        await nextPaint()
        if (cancelled) return

        root.innerHTML = html
        stage('Highlighting code…')
        await nextPaint()
        if (cancelled) return
      }

      const figures = extractDiagrams(root)
      decorate(root)

      if (!figures.length) {
        drawnTheme.current = null
        stage(null)
        return
      }

      // Drawing waits on the mermaid chunk and then on a layout pass per
      // diagram, so it gets its own step even for an otherwise small document.
      await drawDiagrams(figures, {
        theme: themeRef.current,
        isCancelled: () => cancelled,
        onProgress: (done, total) => stage(diagramStage(done, total)),
      })
      if (cancelled) return

      drawnTheme.current = themeRef.current
      stage(null)
    }

    run()
    return () => { cancelled = true }
  }, [source, onStage])

  useEffect(() => {
    const root = ref.current
    // `null` means the current document has no diagrams; equal means the ones
    // on screen already match. Either way there is nothing to redraw.
    if (!root || drawnTheme.current === null || drawnTheme.current === theme) return undefined

    let cancelled = false
    const figures = Array.from(root.querySelectorAll('figure.mermaid'))

    const run = async () => {
      await drawDiagrams(figures, {
        theme,
        isCancelled: () => cancelled,
        onProgress: (done, total) => { if (!cancelled) onStage(diagramStage(done, total)) },
      })
      if (cancelled) return
      drawnTheme.current = theme
      onStage(null)
    }

    run()
    return () => { cancelled = true }
  }, [theme, onStage])

  return <div className={`doc markdown${wide ? ' is-wide' : ''}`} ref={ref} />
}

// Diagrams are the one slow step with an honest count to report, so it does.
function diagramStage(done, total) {
  return total === 1 ? 'Drawing diagram…' : `Drawing diagrams… ${done + 1}/${total}`
}

function decorate(root) {
  // Mermaid fences are kept in the document as the hidden original of a
  // diagram, and are not code anyone reads — highlighting them would only
  // spend the block budget.
  const blocks = root.querySelectorAll('pre:not(.mermaid__source) code')
  for (let i = 0; i < Math.min(blocks.length, MAX_HIGHLIGHTED_BLOCKS); i += 1) {
    hljs.highlightElement(blocks[i])
  }

  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6')
  const seen = new Map()
  for (let i = 0; i < Math.min(headings.length, MAX_ANCHORED_HEADINGS); i += 1) {
    const heading = headings[i]
    const base = slugify(heading.textContent) || 'section'
    const count = (seen.get(base) || 0) + 1
    seen.set(base, count)
    heading.id = count === 1 ? base : `${base}-${count}`

    const anchor = document.createElement('a')
    anchor.className = 'anchor'
    anchor.href = `#${heading.id}`
    anchor.textContent = '#'
    anchor.setAttribute('aria-hidden', 'true')
    anchor.setAttribute('tabindex', '-1')
    heading.prepend(anchor)
  }
}
