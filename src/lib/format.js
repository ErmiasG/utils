// Dependency-free pretty-printers / minifiers for JSON, HTML and XML.
//
// The markup formatter is a tokenizer + indenter rather than a real parser:
// it never rewrites your document, it only decides where the line breaks and
// the indentation go. That keeps it forgiving with the partial or slightly
// broken fragments people usually paste in.

const HTML_VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

// Elements whose children are text, not markup.
const HTML_RAW = new Set(['script', 'style', 'pre', 'textarea'])

// ...and of those, the ones whose whitespace is significant.
const VERBATIM_RAW = new Set(['pre', 'textarea'])

// Phrasing content: kept on one line with the surrounding text so that
// `Some <b>text</b> here.` does not lose its spaces.
const HTML_INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn',
  'em', 'i', 'img', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span',
  'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
])

const INLINE_MERGE_LIMIT = 100

/* ------------------------------------------------------------------ JSON */

export function formatJson(source, { indent = 2 } = {}) {
  const text = source.trim()
  if (!text) return { output: '', error: null }
  try {
    return { output: JSON.stringify(JSON.parse(text), null, indent), error: null }
  } catch (err) {
    return { output: source, error: jsonError(err, source) }
  }
}

export function minifyJson(source) {
  const text = source.trim()
  if (!text) return { output: '', error: null }
  try {
    return { output: JSON.stringify(JSON.parse(text)), error: null }
  } catch (err) {
    return { output: source, error: jsonError(err, source) }
  }
}

// V8's own message text is inconsistent across versions — sometimes it carries
// a character offset, sometimes only a snippet of surrounding text. Rather than
// reverse-engineer it, re-scan the document and report where our own scanner
// gives up, which is the same place `JSON.parse` did.
function jsonError(err, source) {
  const message = (err.message || String(err)).replace(/^JSON\.parse: /, '')
  const located = locateJsonError(source)
  if (!located) return { message, line: null, column: null }
  return { message: located.message || message, ...positionOf(source, located.index) }
}

function positionOf(text, index) {
  const before = text.slice(0, Math.max(0, Math.min(index, text.length)))
  const line = before.split('\n').length
  return { line, column: before.length - (before.lastIndexOf('\n') + 1) + 1 }
}

// A miniature JSON scanner. It does not build a value — it only walks the
// grammar and returns the offset of the first thing that does not belong.
function locateJsonError(source) {
  let i = 0
  const at = (message) => ({ index: i, message })

  const skipWhitespace = () => {
    while (i < source.length && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) i += 1
  }

  const scanString = () => {
    i += 1 // opening quote
    while (i < source.length) {
      const ch = source[i]
      if (ch === '\\') {
        const next = source[i + 1]
        if (next === undefined) return at('Unterminated escape sequence')
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(i + 2, i + 6))) {
            i += 1
            return at('Invalid \\u escape — four hex digits expected')
          }
          i += 6
          continue
        }
        if (!'"\\/bfnrt'.includes(next)) {
          i += 1
          return at(`Invalid escape sequence \\${next}`)
        }
        i += 2
        continue
      }
      if (ch === '"') { i += 1; return null }
      if (ch === '\n') return at('Unterminated string — strings cannot span lines')
      i += 1
    }
    return at('Unterminated string')
  }

  const scanNumber = () => {
    const start = i
    if (source[i] === '-') i += 1
    if (source[i] === '0') i += 1
    else if (/[1-9]/.test(source[i] || '')) { while (/[0-9]/.test(source[i] || '')) i += 1 }
    else return at('Expected a digit')
    if (source[i] === '.') {
      i += 1
      if (!/[0-9]/.test(source[i] || '')) return at('Expected a digit after the decimal point')
      while (/[0-9]/.test(source[i] || '')) i += 1
    }
    if (source[i] === 'e' || source[i] === 'E') {
      i += 1
      if (source[i] === '+' || source[i] === '-') i += 1
      if (!/[0-9]/.test(source[i] || '')) return at('Expected a digit in the exponent')
      while (/[0-9]/.test(source[i] || '')) i += 1
    }
    return i > start ? null : at('Expected a number')
  }

  const scanLiteral = (word) => {
    if (source.startsWith(word, i)) { i += word.length; return null }
    return at(`Expected ${word}`)
  }

  const scanValue = (depth) => {
    if (depth > 512) return at('Nesting is too deep')
    skipWhitespace()
    const ch = source[i]
    if (ch === undefined) return at('Unexpected end of input')
    if (ch === '"') return scanString()
    if (ch === '{') return scanObject(depth)
    if (ch === '[') return scanArray(depth)
    if (ch === 't') return scanLiteral('true')
    if (ch === 'f') return scanLiteral('false')
    if (ch === 'n') return scanLiteral('null')
    if (ch === '-' || /[0-9]/.test(ch)) return scanNumber()
    return at(`Unexpected character ${JSON.stringify(ch)}`)
  }

  function scanObject(depth) {
    i += 1 // {
    skipWhitespace()
    if (source[i] === '}') { i += 1; return null }
    for (;;) {
      skipWhitespace()
      if (source[i] !== '"') return at('Expected a double-quoted property name')
      const keyError = scanString()
      if (keyError) return keyError
      skipWhitespace()
      if (source[i] !== ':') return at("Expected ':' after the property name")
      i += 1
      const valueError = scanValue(depth + 1)
      if (valueError) return valueError
      skipWhitespace()
      if (source[i] === ',') { i += 1; continue }
      if (source[i] === '}') { i += 1; return null }
      return at(source[i] === undefined ? 'Unexpected end of input — missing }' : "Expected ',' or '}'")
    }
  }

  function scanArray(depth) {
    i += 1 // [
    skipWhitespace()
    if (source[i] === ']') { i += 1; return null }
    for (;;) {
      const valueError = scanValue(depth + 1)
      if (valueError) return valueError
      skipWhitespace()
      if (source[i] === ',') { i += 1; skipWhitespace(); continue }
      if (source[i] === ']') { i += 1; return null }
      return at(source[i] === undefined ? 'Unexpected end of input — missing ]' : "Expected ',' or ']'")
    }
  }

  const error = scanValue(0)
  if (error) return error
  skipWhitespace()
  if (i < source.length) return at('Unexpected content after the end of the document')
  return null
}

/* ---------------------------------------------------------------- markup */

export function formatMarkup(source, { indent = 2, kind = 'xml' } = {}) {
  const html = kind === 'html'
  const tokens = collapseInline(tokenize(source, html), html)
  const unit = ' '.repeat(indent)
  const lines = []
  let depth = 0

  const push = (value) => lines.push(depth ? unit.repeat(depth) + value : value)

  // Inline runs (`Some <b>text</b> here.`) accumulate here and are emitted as
  // a single line when the next block-level token shows up.
  let run = ''
  let pendingSpace = false

  const addToRun = (value, spaceBefore, spaceAfter) => {
    if (run && (pendingSpace || spaceBefore)) run += ' '
    run += value
    pendingSpace = spaceAfter
  }

  const flush = () => {
    if (run.trim()) push(run.trim())
    run = ''
    pendingSpace = false
  }

  for (const token of tokens) {
    const inline = html && isInlineToken(token)

    if (token.type === 'space') {
      if (run) pendingSpace = true
      continue
    }

    if (token.type === 'text') {
      if (html) {
        addToRun(token.value.replace(/\n/g, ' '), token.pre, token.post)
      } else {
        flush()
        for (const line of token.value.split('\n')) push(line)
      }
      continue
    }

    if (inline) {
      addToRun(token.value, false, false)
      continue
    }

    flush()

    switch (token.type) {
      case 'close':
        depth = Math.max(0, depth - 1)
        push(token.value)
        break
      case 'open':
        push(token.value)
        depth += 1
        break
      case 'raw':
        pushRaw(lines, token, unit, depth)
        break
      default: // void, comment, cdata, declaration, collapsed line
        push(token.value)
    }
  }
  flush()

  return { output: lines.join('\n'), error: unbalancedWarning(tokens) }
}

export function minifyMarkup(source, { kind = 'xml' } = {}) {
  const html = kind === 'html'
  let out = ''
  for (const token of tokenize(source, html)) {
    if (token.type === 'comment') continue
    if (token.type === 'space') {
      // Whitespace between inline content is meaningful in HTML.
      if (html && out && !out.endsWith(' ')) out += ' '
      continue
    }
    if (token.type === 'text') {
      if (html && token.pre && out && !out.endsWith(' ')) out += ' '
      out += token.value.replace(/\s+/g, ' ')
      if (html && token.post) out += ' '
      continue
    }
    out += token.value
  }
  return { output: out.trim(), error: null }
}

function isInlineToken(token) {
  if (token.type === 'open' || token.type === 'close' || token.type === 'void' || token.type === 'line') {
    return HTML_INLINE.has(token.element)
  }
  return false
}

function pushRaw(lines, token, unit, depth) {
  const pad = unit.repeat(depth)
  const body = token.value.replace(/^\n+|\s+$/g, '')
  if (!body) return
  const bodyLines = body.split('\n')
  const common = bodyLines
    .filter((line) => line.trim())
    .reduce((min, line) => Math.min(min, line.match(/^[ \t]*/)[0].length), Infinity)
  const strip = Number.isFinite(common) ? common : 0
  for (const line of bodyLines) lines.push(line.trim() ? pad + line.slice(strip) : '')
}

function unbalancedWarning(tokens) {
  const stack = []
  for (const token of tokens) {
    if (token.type === 'open') stack.push(token.element)
    else if (token.type === 'close') {
      const index = stack.lastIndexOf(token.element)
      if (index === -1) {
        return { message: `Unexpected closing tag </${token.element}> — indentation below may be off.`, line: null, column: null }
      }
      if (index !== stack.length - 1) {
        return { message: `Unclosed tag <${stack[stack.length - 1]}> before </${token.element}> — indentation below may be off.`, line: null, column: null }
      }
      stack.length = index
    }
  }
  if (stack.length) {
    return { message: `Unclosed tag <${stack[stack.length - 1]}> — indentation below may be off.`, line: null, column: null }
  }
  return null
}

/* ------------------------------------------------------------- tokenizer */

function tokenize(source, html) {
  const tokens = []
  let i = 0

  const pushText = (value) => {
    if (!value) return
    if (!value.trim()) {
      tokens.push({ type: 'space' })
      return
    }
    const pre = /^\s/.test(value)
    const post = /\s$/.test(value)
    const body = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n')
    tokens.push({ type: 'text', value: body, pre, post })
  }

  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt === -1) {
      pushText(source.slice(i))
      break
    }
    if (lt > i) pushText(source.slice(i, lt))
    i = lt

    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      const stop = end === -1 ? source.length : end + 3
      tokens.push({ type: 'comment', value: source.slice(i, stop) })
      i = stop
      continue
    }
    if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i + 9)
      const stop = end === -1 ? source.length : end + 3
      tokens.push({ type: 'cdata', value: source.slice(i, stop) })
      i = stop
      continue
    }
    if (source.startsWith('<!', i) || source.startsWith('<?', i)) {
      const stop = findTagEnd(source, i)
      tokens.push({ type: 'decl', value: source.slice(i, stop) })
      i = stop
      continue
    }

    const stop = findTagEnd(source, i)
    const value = source.slice(i, stop)
    i = stop

    const closing = value.startsWith('</')
    const element = (value.match(/^<\/?\s*([^\s/>]+)/) || [, ''])[1].toLowerCase()

    if (!element) {
      pushText(value)
      continue
    }
    if (closing) {
      tokens.push({ type: 'close', element, value })
      continue
    }
    if (/\/\s*>$/.test(value) || (html && HTML_VOID.has(element))) {
      tokens.push({ type: 'void', element, value })
      continue
    }

    if (html && VERBATIM_RAW.has(element)) {
      // <pre>/<textarea> keep their exact bytes, closing tag included, so the
      // formatter can never inject whitespace into rendered output.
      const closeAt = findClosingTag(source, i, element)
      const closeTag = source.slice(closeAt).match(new RegExp(`^</\\s*${element}\\s*>`, 'i'))
      const end = closeAt + (closeTag ? closeTag[0].length : 0)
      tokens.push({ type: 'verbatim', element, value: source.slice(lt, end) })
      i = end
      continue
    }

    tokens.push({ type: 'open', element, value })

    if (html && HTML_RAW.has(element)) {
      const closeAt = findClosingTag(source, i, element)
      tokens.push({ type: 'raw', element, value: source.slice(i, closeAt) })
      i = closeAt
    }
  }

  return tokens
}

// Scans to the tag's `>`, ignoring any that live inside a quoted attribute.
function findTagEnd(source, start) {
  let quote = null
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return i + 1
    }
  }
  return source.length
}

function findClosingTag(source, from, element) {
  const match = source.slice(from).match(new RegExp(`</\\s*${element}\\s*>`, 'i'))
  return match ? from + match.index : source.length
}

// `<title>Hi</title>` and `<p>a <b>short</b> line</p>` read better on one line
// than spread over three, so short balanced runs get folded back together.
function collapseInline(tokens, html) {
  const out = []

  for (let i = 0; i < tokens.length; i += 1) {
    const open = tokens[i]

    if (open?.type !== 'open') {
      out.push(open)
      continue
    }

    const folded = foldRun(tokens, i, open, html)
    if (folded) {
      out.push({ type: 'line', element: open.element, value: folded.value })
      i = folded.end
    } else {
      out.push(open)
    }
  }

  return out
}

// Looks ahead from an opening tag for its matching close, folding the run into
// a single string when everything between is short, inline and balanced.
function foldRun(tokens, start, open, html) {
  let value = open.value
  let hasContent = false
  let pendingSpace = false

  // Leading whitespace right after the opening tag is dropped; whitespace
  // between two pieces of content is kept as a single space.
  const append = (text, spaceBefore) => {
    if (hasContent && (pendingSpace || spaceBefore)) value += ' '
    value += text
    hasContent = true
    pendingSpace = false
  }

  for (let j = start + 1; j < tokens.length; j += 1) {
    const token = tokens[j]

    if (token.type === 'close' && token.element === open.element) {
      value += token.value
      return value.length <= INLINE_MERGE_LIMIT ? { value, end: j } : null
    }

    if (token.type === 'space') {
      if (!html) return null
      pendingSpace = true
      continue
    }

    if (token.type === 'text') {
      if (token.value.includes('\n')) return null
      append(token.value, html && token.pre)
      pendingSpace = html && token.post
    } else if (html && HTML_INLINE.has(token.element) && token.type !== 'raw') {
      append(token.value, false)
    } else {
      // Anything block-level means this element gets the multi-line treatment.
      return null
    }

    if (value.length > INLINE_MERGE_LIMIT) return null
  }

  return null
}

/* ----------------------------------------------------------- dispatchers */

export function formatDocument(kind, source, { indent = 2 } = {}) {
  switch (kind) {
    case 'json':
      return formatJson(source, { indent })
    case 'html':
    case 'xml':
      return formatMarkup(source, { indent, kind })
    default:
      return { output: source, error: null }
  }
}

export function minifyDocument(kind, source) {
  switch (kind) {
    case 'json':
      return minifyJson(source)
    case 'html':
    case 'xml':
      return minifyMarkup(source, { kind })
    default:
      return { output: source, error: null }
  }
}

export const isFormattable = (kind) => kind === 'json' || kind === 'html' || kind === 'xml'
