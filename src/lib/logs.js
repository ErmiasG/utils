export const LOG_CHUNK_BYTES = 1024 * 1024
export const MAX_LOG_LINE_BYTES = 8 * 1024 * 1024
export const LOG_PAGE_SIZE = 100
export const LOG_DETAIL_CHARS = 200_000

const aliases = {
  timestamp: ['timestamp', '@timestamp', 'time', 'ts', 'datetime', 'date', 'timemillis'],
  level: ['level', 'severity', 'loglevel', 'log_level', 'log.level', 'severitytext'],
  message: ['logmessage', 'message', 'msg', 'messageid', 'text', 'event', 'exception', 'error', 'err', 'throwable'],
  logger: ['loggername', 'logger', 'log.logger', 'name', 'source', 'component'],
  threadName: ['threadname', 'thread_name', 'thread.name', 'thread'],
  threadId: ['threadid', 'thread_id', 'thread.id', 'tid'],
}

export function parseLogLine(raw, truncated = false) {
  if (truncated) return { raw, format: 'text', value: null, truncated: true }
  try {
    const value = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (value === null || typeof value !== 'object') return { raw, format: 'text', value: null, truncated: false }
    return { raw, format: 'json', value, truncated: false }
  }
  catch {
    const trimmed = raw.trimStart()
    const arrayLike = trimmed.startsWith('[') && /^(?:\]|\{|\[|"|-?\d|true\b|false\b|null\b)/.test(trimmed.slice(1).trimStart())
    return { raw, format: trimmed.startsWith('{') || arrayLike ? 'invalid' : 'text', value: null, truncated: false }
  }
}

export function logFields(entry) {
  return entry.format === 'json' && entry.value !== null && typeof entry.value === 'object' && !Array.isArray(entry.value) ? Object.keys(entry.value) : []
}

export function logValue(entry, role, field = '') {
  const fields = logFields(entry)
  if (field) return fields.includes(field) ? entry.value[field] : undefined
  for (const alias of aliases[role] || []) {
    const key = fields.find((key) => key.toLowerCase() === alias)
    if (key !== undefined && entry.value[key] != null) return entry.value[key]
  }
  return undefined
}

export function displayLogValue(value) {
  return value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
}

export function logLevel(entry, field = '') { return displayLogValue(logValue(entry, 'level', field)).trim().toUpperCase() }

export function logThread(entry, role, field = '') {
  const value = logValue(entry, role, field)
  return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : ''
}

function containsValue(value, query) {
  const pending = [value]
  while (pending.length) {
    const current = pending.pop()
    if (current !== null && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        if (key.toLowerCase().includes(query)) return true
        pending.push(child)
      }
    } else if (String(current).toLowerCase().includes(query)) return true
  }
  return false
}

export function matchesLog(entry, filters = {}, mapping = {}) {
  if (filters.format && entry.format !== filters.format) return false
  const level = (filters.level || '').trim().toUpperCase()
  if (level && logLevel(entry, mapping.level) !== level) return false
  for (const role of ['threadName', 'threadId']) {
    const thread = (filters[role] || '').trim()
    if (thread && logThread(entry, role, mapping[role]) !== thread) return false
  }
  const query = (filters.query || '').toLowerCase()
  if (!query) return true
  if (filters.field) return logFields(entry).includes(filters.field) && containsValue(entry.value[filters.field], query)
  return entry.raw.toLowerCase().includes(query) || (entry.format === 'json' && containsValue(entry.value, query))
}

// Compact, growable arrays keep only byte positions and physical line numbers,
// not copies of the file or parsed entries. Float64 offsets also work above 4 GB.
export class LogIndex {
  constructor(width = 3) { this.width = width; this.blocks = []; this.length = 0; this.blockRows = 32768 }
  push(...values) {
    const block = Math.floor(this.length / this.blockRows)
    if (!this.blocks[block]) this.blocks.push(new Float64Array(this.blockRows * this.width))
    this.blocks[block].set(values, (this.length % this.blockRows) * this.width)
    this.length++
  }
  get(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new Error('Log entry is out of range.')
    const offset = (index % this.blockRows) * this.width
    return this.blocks[Math.floor(index / this.blockRows)].subarray(offset, offset + this.width)
  }
}

// Split bytes rather than decoded chunks so offsets remain exact with UTF-8,
// CRLF, a BOM, and multibyte characters straddling chunk boundaries.
export async function walkLogLines(file, visit, { chunkBytes = LOG_CHUNK_BYTES, maxLineBytes = MAX_LOG_LINE_BYTES, onProgress = () => {}, isCurrent = () => true } = {}) {
  const decoder = new TextDecoder('utf-8')
  let start = 0, line = 1, parts = [], kept = 0
  const append = (part) => {
    const count = Math.min(part.length, Math.max(0, maxLineBytes - kept))
    if (count) { parts.push(part.slice(0, count)); kept += count }
  }
  const emit = (end, tail) => {
    let bytes
    if (!parts.length) bytes = tail.subarray(0, maxLineBytes)
    else {
      append(tail)
      bytes = new Uint8Array(kept)
      let at = 0
      for (const part of parts) { bytes.set(part, at); at += part.length }
    }
    const raw = decoder.decode(bytes).replace(/\r$/, '')
    const truncated = end - start > maxLineBytes
    if (raw.trim() || truncated) visit({ start, end, line, ...parseLogLine(raw, truncated) })
    start = end + 1; line++; parts = []; kept = 0
  }
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    if (!isCurrent()) return false
    const bytes = new Uint8Array(await file.slice(offset, offset + chunkBytes).arrayBuffer())
    if (!isCurrent()) return false
    let segment = 0
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 10) { emit(offset + i, bytes.subarray(segment, i)); segment = i + 1 }
    }
    append(bytes.subarray(segment))
    onProgress(Math.min(file.size, offset + bytes.length), file.size)
  }
  if (start < file.size) emit(file.size, new Uint8Array())
  onProgress(file.size, file.size)
  return true
}

// Text blocks carry only source bounds, so even a block spanning the whole file
// does not accumulate in memory. The predicate checks every physical line,
// including lines beyond the detail preview limit. JSON entries remain separate.
export async function walkLogEntries(file, visit, { shouldMatch, ...options } = {}) {
  let text = null
  const flush = () => {
    if (!text) return
    text.truncated ||= text.end - text.start > MAX_LOG_LINE_BYTES
    visit(text); text = null
  }
  const done = await walkLogLines(file, (entry) => {
    const matches = shouldMatch ? shouldMatch(entry) : false
    if (entry.format === 'text') {
      if (!text) text = { start: entry.start, end: entry.end, line: entry.line, endLine: entry.line, format: 'text', value: null, truncated: entry.truncated, matches }
      else {
        text.end = entry.end; text.endLine = entry.line
        text.truncated ||= entry.truncated; text.matches ||= matches
      }
    } else {
      flush()
      visit({ ...entry, endLine: entry.line, matches })
    }
  }, options)
  if (!done) return false
  flush()
  return true
}

export async function readLogEntry(file, index, id) {
  const [start, end, line, endLine = line] = index.get(id)
  const raw = new TextDecoder().decode(await file.slice(start, Math.min(end, start + MAX_LOG_LINE_BYTES)).arrayBuffer()).replace(/\r$/, '')
  const truncated = end - start > MAX_LOG_LINE_BYTES
  const parsed = endLine > line ? { raw, format: 'text', value: null, truncated } : parseLogLine(raw, truncated)
  return { id, start, end, line, endLine, ...parsed }
}

export function summarizeLogEntry(entry, mapping = {}) {
  const preview = (value) => { const text = displayLogValue(value); return text.length > 2000 ? text.slice(0, 2000) + '…' : text }
  let message = logValue(entry, 'message', mapping.message)
  if (!mapping.message) {
    for (let depth = 0; depth < 4 && message !== null && typeof message === 'object'; depth++) {
      const nested = logValue({ format: 'json', value: message }, 'message')
      if (nested === undefined) break
      message = nested
    }
  }
  return {
    id: entry.id, line: entry.line, endLine: entry.endLine || entry.line, start: entry.start, end: entry.end, format: entry.format, truncated: entry.truncated,
    timestamp: preview(logValue(entry, 'timestamp', mapping.timestamp)), level: logLevel(entry, mapping.level).slice(0, 100),
    logger: preview(logValue(entry, 'logger', mapping.logger)), message: preview(message === undefined ? entry.format === 'text' && entry.endLine > entry.line ? entry.raw.replace(/\r?\n/g, ' ') : entry.raw : message),
    threadName: logThread(entry, 'threadName', mapping.threadName).slice(0, 2000),
    threadId: logThread(entry, 'threadId', mapping.threadId).slice(0, 2000),
  }
}

// A separate view decodes multiline JSON strings (including nested exceptions)
// while the formatted and original views retain their JSON representation.
export function decodedLogText(entry, maxChars = LOG_DETAIL_CHARS) {
  if (entry.format !== 'json') return { text: '', clipped: false }
  const pending = [{ value: entry.value, path: '' }], parts = []
  let length = 0
  while (pending.length) {
    const { value, path } = pending.pop()
    if (typeof value === 'string' && /[\r\n]/.test(value)) {
      const text = `${parts.length ? '\n\n' : ''}${path || 'Value'}\n${value}`
      const remaining = maxChars - length
      parts.push(text.slice(0, remaining)); length += text.length
      if (length >= maxChars) return { text: parts.join(''), clipped: length > maxChars || pending.length > 0 }
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value).reverse()) pending.push({ value: child, path: path ? `${path}.${key}` : key })
    }
  }
  return { text: parts.join(''), clipped: false }
}

export function logContextRange(length, id, radius = 10) {
  if (!Number.isInteger(id) || id < 0 || id >= length) throw new Error('Log entry is out of range.')
  const count = Math.min(50, Math.max(0, Math.floor(Number(radius) || 0)))
  return { start: Math.max(0, id - count), end: Math.min(length, id + count + 1) }
}

export function stackTraceSegments(text) {
  const segments = []
  let hasFrames = false
  for (const line of text.split(/(?<=\n)/)) {
    const frame = /^\s*at\s+\S+\([^)]*\)/.test(line)
    hasFrames ||= frame
    const kind = frame && !/(?<![\w$.])io\.hops\.hopsworks\./.test(line) ? 'frames'
      : /^\s*(?:Caused by:|Suppressed:)/.test(line) ? 'cause' : 'text'
    const previous = segments.at(-1)
    if (kind !== 'cause' && previous?.kind === kind) { previous.text += line; if (frame) previous.count++ }
    else segments.push({ kind, text: line, count: frame ? 1 : 0 })
  }
  return hasFrames ? segments : []
}
