// Work out what kind of document we are looking at, from the file name first
// and the content second. Everything here is a best guess that the user can
// override from the toolbar.

const EXT_MAP = {
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  mdx: 'markdown',
  json: 'json',
  jsonc: 'json',
  geojson: 'json',
  ipynb: 'json',
  map: 'json',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  vue: 'html',
  svg: 'xml',
  xml: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  rss: 'xml',
  atom: 'xml',
  plist: 'xml',
  pom: 'xml',
  txt: 'text',
  text: 'text',
  log: 'text',
  csv: 'text',
}

export const KINDS = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'json', label: 'JSON' },
  { id: 'html', label: 'HTML' },
  { id: 'xml', label: 'XML' },
  { id: 'text', label: 'Plain text' },
]

export function extensionOf(name = '') {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export function kindFromName(name) {
  return EXT_MAP[extensionOf(name)] || null
}

export function kindFromContent(source) {
  const text = source.trim()
  if (!text) return 'text'

  const first = text[0]
  if ((first === '{' || first === '[') && looksLikeJson(text)) return 'json'

  if (first === '<') {
    if (/^<!doctype\s+html/i.test(text) || /<html[\s>]/i.test(text)) return 'html'
    if (/^<\?xml[\s?]/i.test(text) || /^<!doctype\s+[a-z]/i.test(text)) return 'xml'
    // A bare tag soup with common HTML-only elements is probably HTML.
    if (/<(div|span|p|body|head|script|style|table|ul|ol|li|a|img|br|h[1-6])[\s>/]/i.test(text)) return 'html'
    return 'xml'
  }

  // Markdown signals: headings, fences, lists, links, tables.
  const markdownHits = [
    /^#{1,6}\s+\S/m,
    /^```/m,
    /^\s*[-*+]\s+\S/m,
    /^\s*\d+\.\s+\S/m,
    /\[[^\]]+\]\([^)]+\)/,
    /^\s*>\s+\S/m,
    /^\|.+\|\s*$/m,
  ].filter((re) => re.test(text)).length

  return markdownHits >= 1 ? 'markdown' : 'text'
}

export function detectKind(name, source) {
  return kindFromName(name) || kindFromContent(source)
}

function looksLikeJson(text) {
  try {
    JSON.parse(text)
    return true
  } catch {
    // Unparseable JSON is still JSON as far as the formatter is concerned —
    // it will show the syntax error instead of silently treating it as text.
    return /^[[{][\s\S]*[\]}]$/.test(text)
  }
}
