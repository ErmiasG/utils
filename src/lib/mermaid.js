// Mermaid diagrams in ```mermaid fences.
//
// Mermaid is by far the heaviest thing this app can load — several times the
// size of everything else put together — so it is code-split behind a dynamic
// import and fetched the first time a document actually contains a diagram.
// Markdown without one never pays for it.

import { sanitizeSvg } from './markdown'
import { nextPaint } from './schedule'

// Fence languages that mean "this is a diagram, not code".
const FENCE_LANGUAGES = ['mermaid', 'mmd']

// Each diagram is a full parse plus a layout pass, and they are drawn one at a
// time so the window stays responsive. Past this many the cost outruns any
// reader's patience, so the rest are left as the code blocks they came in as.
const MAX_DIAGRAMS = 100

// Mermaid measures text against a real font, so this has to be a concrete
// stack rather than the `--sans` custom property: the element it measures in
// is not always somewhere that a `var()` would resolve.
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

const MERMAID_THEME = { dark: 'dark', light: 'default' }

let pendingImport = null
let configuredTheme = null
let nextDiagramId = 1

function load() {
  if (!pendingImport) {
    pendingImport = import('mermaid').then((module) => module.default)
  }
  return pendingImport
}

async function configure(theme) {
  const mermaid = await load()
  if (configuredTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      // Labels are sanitised and `click` directives are inert. Diagrams come
      // from whatever file was dropped in, so they get no more trust than the
      // surrounding markdown.
      securityLevel: 'strict',
      // Without this a broken diagram both throws *and* draws mermaid's own
      // error graphic, and leaks its scratch element into the page. We report
      // the failure ourselves, so we want the clean throw.
      suppressErrorRendering: true,
      theme: MERMAID_THEME[theme] || 'default',
      fontFamily: FONT_FAMILY,
      // Let a wide diagram shrink to the column instead of overflowing it.
      flowchart: { useMaxWidth: true },
      sequence: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
    })
    configuredTheme = theme
  }
  return mermaid
}

// Swaps every mermaid fence in a freshly rendered document for a figure that
// can hold the drawing, keeping the fence itself as the hidden original — it
// is what a redraw reads, and what is put back on screen if drawing fails.
export function extractDiagrams(root) {
  const figures = []

  for (const code of root.querySelectorAll('pre > code')) {
    if (!FENCE_LANGUAGES.some((lang) => code.classList.contains(`language-${lang}`))) continue

    const pre = code.parentElement
    if (figures.length >= MAX_DIAGRAMS) {
      // Over budget: leave the block alone, but say why it is not a picture.
      pre.dataset.mermaidSkipped = 'true'
      continue
    }

    const figure = document.createElement('figure')
    figure.className = 'mermaid'
    figure.dataset.state = 'pending'

    const canvas = document.createElement('div')
    canvas.className = 'mermaid__canvas'
    figure.append(canvas)

    pre.replaceWith(figure)
    pre.classList.add('mermaid__source')
    pre.hidden = true
    figure.append(pre)

    figures.push(figure)
  }

  return figures
}

// Draws the collected figures in order, reporting progress as it goes. Unlike
// parsing, this one has an honest count to show.
export async function drawDiagrams(figures, { theme, onProgress, isCancelled }) {
  for (let i = 0; i < figures.length; i += 1) {
    if (isCancelled?.()) return
    onProgress?.(i, figures.length)
    // Yield so the count on the overlay is the one being worked on, not the
    // one before it.
    await nextPaint()
    if (isCancelled?.()) return
    await drawDiagram(figures[i], theme)
  }
}

async function drawDiagram(figure, theme) {
  const source = figure.querySelector('.mermaid__source')?.textContent ?? ''
  const canvas = figure.querySelector('.mermaid__canvas')
  if (!canvas) return

  try {
    const mermaid = await configure(theme)
    const { svg } = await mermaid.render(`mermaid-diagram-${nextDiagramId++}`, source)
    canvas.innerHTML = sanitizeSvg(svg)
    figure.dataset.state = 'done'
    figure.querySelector('.mermaid__source').hidden = true
  } catch (error) {
    // A diagram that will not draw is still text the reader wants to see, so
    // the fence comes back with the reason above it.
    canvas.textContent = describe(error)
    figure.dataset.state = 'error'
    figure.querySelector('.mermaid__source').hidden = false
  }
}

// Mermaid parse errors are multi-line and can carry the whole diagram in them;
// the first couple of lines are the useful part.
function describe(error) {
  const message = (error?.message || String(error || 'Unknown error')).trim()
  const short = message.split('\n').slice(0, 2).join(' — ')
  return `Diagram could not be drawn: ${short.slice(0, 300)}`
}
