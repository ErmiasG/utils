import { LOG_DETAIL_CHARS, LOG_PAGE_SIZE, LogIndex, decodedLogText, logContextRange, logFields, logLevel, logThread, matchesLog, readLogEntry, stackTraceSegments, summarizeLogEntry, walkLogEntries } from './logs.js'

let file, index, matches = null, mapping = {}, queryVersion = 0, detailVersion = 0, contextVersion = 0
let filterValues = { level: [], threadName: [], threadId: [] }, suggestionMapping = ''
const send = (type, request, data) => self.postMessage({ type, request, ...data })
const suggestionKey = (fields = {}) => JSON.stringify([fields.level || '', fields.threadName || '', fields.threadId || ''])

async function page(request, requestedPage = 0, anchorId = null) {
  const total = matches ? matches.length : index.length
  const pageNumber = Math.max(0, Math.min(requestedPage, Math.ceil(total / LOG_PAGE_SIZE) - 1))
  const rows = []
  for (let position = pageNumber * LOG_PAGE_SIZE; position < Math.min(total, (pageNumber + 1) * LOG_PAGE_SIZE); position++) {
    if (request !== queryVersion) return
    const id = matches ? matches.get(position)[0] : position
    rows.push(summarizeLogEntry(await readLogEntry(file, index, id), mapping))
  }
  if (request === queryVersion) send('page', request, { rows, total, page: pageNumber, anchorId, filterValues })
}

async function handle(data) {
  if (data.type === 'load') {
    file = data.file; index = new LogIndex(4); matches = null
    const fields = new Set(), levels = new Set(), threads = { threadName: new Set(), threadId: new Set() }, counts = { json: 0, text: 0, invalid: 0, truncated: 0 }
    let lastProgress = 0, fieldsLimited = false, levelsLimited = false
    await walkLogEntries(file, (entry) => {
      index.push(entry.start, entry.end, entry.line, entry.endLine)
      counts[entry.format]++; if (entry.truncated) counts.truncated++
      for (const field of logFields(entry)) { if (fields.size < 256) fields.add(field); else if (!fields.has(field)) fieldsLimited = true }
      const level = logLevel(entry)
      if (level) { if (levels.size < 256) levels.add(level); else if (!levels.has(level)) levelsLimited = true }
      for (const role of Object.keys(threads)) {
        const value = logThread(entry, role)
        if (value && value.length <= 256 && threads[role].size < 256) threads[role].add(value)
      }
    }, { onProgress: (loaded, total) => {
      if (Date.now() - lastProgress > 100 || loaded === total) { send('progress', data.request, { loaded, total }); lastProgress = Date.now() }
    } })
    filterValues = { level: [...levels].sort(), ...Object.fromEntries(Object.entries(threads).map(([role, values]) => [role, [...values].sort()])) }
    suggestionMapping = suggestionKey()
    send('ready', data.request, { count: index.length, counts, fields: [...fields].sort(), filterValues, fieldsLimited, levelsLimited })
  } else if (data.type === 'query') {
    queryVersion = data.request; detailVersion++; contextVersion++
    const request = data.request
    const nextMapping = data.mapping || {}
    const filters = data.filters || {}
    const result = new LogIndex(1)
    const hasFilters = Boolean(filters.query || filters.level || filters.format || filters.threadName || filters.threadId)
    const key = suggestionKey(nextMapping), rebuildSuggestions = key !== suggestionMapping
    if (hasFilters || rebuildSuggestions) {
      let id = 0, lastProgress = 0
      const suggestions = { level: new Set(), threadName: new Set(), threadId: new Set() }
      const done = await walkLogEntries(file, (entry) => {
        if (entry.matches) result.push(id)
        id++
        if (rebuildSuggestions) {
          for (const role of Object.keys(suggestions)) {
            const value = role === 'level' ? logLevel(entry, nextMapping.level) : logThread(entry, role, nextMapping[role])
            if (value && value.length <= 256 && suggestions[role].size < 256) suggestions[role].add(value)
          }
        }
      }, {
        shouldMatch: hasFilters ? (entry) => matchesLog(entry, filters, nextMapping) : undefined,
        isCurrent: () => request === queryVersion,
        onProgress: (loaded, total) => { if (Date.now() - lastProgress > 100 || loaded === total) { send('progress', request, { loaded, total }); lastProgress = Date.now() } },
      })
      if (!done || request !== queryVersion) return
      matches = hasFilters ? result : null
      if (rebuildSuggestions) {
        filterValues = Object.fromEntries(Object.entries(suggestions).map(([role, values]) => [role, [...values].sort()]))
        suggestionMapping = key
      }
    } else matches = null
    mapping = nextMapping
    const anchorId = matches === null && Number.isInteger(data.anchorId) && data.anchorId >= 0 && data.anchorId < index.length ? data.anchorId : null
    await page(request, anchorId === null ? 0 : Math.floor(anchorId / LOG_PAGE_SIZE), anchorId)
  } else if (data.type === 'page') {
    queryVersion = data.request; detailVersion++; contextVersion++
    await page(data.request, data.page)
  } else if (data.type === 'detail') {
    detailVersion = data.request; contextVersion++
    const entry = await readLogEntry(file, index, data.id)
    if (data.request !== detailVersion) return
    const formatted = entry.format === 'json' ? JSON.stringify(entry.value, null, 2) : entry.raw
    const decoded = decodedLogText(entry)
    const focus = decoded.text || entry.raw.slice(0, LOG_DETAIL_CHARS)
    send('detail', data.request, {
      id: entry.id, line: entry.line, endLine: entry.endLine, format: entry.format, start: entry.start, end: entry.end,
      raw: entry.raw.slice(0, LOG_DETAIL_CHARS), formatted: formatted.slice(0, LOG_DETAIL_CHARS),
      decoded: decoded.text,
      focus, stack: stackTraceSegments(focus),
      threadName: logThread(entry, 'threadName', mapping.threadName).slice(0, 2000),
      threadId: logThread(entry, 'threadId', mapping.threadId).slice(0, 2000),
      clipped: entry.truncated || entry.raw.length > LOG_DETAIL_CHARS || formatted.length > LOG_DETAIL_CHARS || decoded.clipped,
    })
  } else if (data.type === 'context') {
    contextVersion = data.request
    const request = data.request, currentMapping = mapping
    const range = logContextRange(index.length, data.id, data.radius)
    const rows = []
    for (let id = range.start; id < range.end; id++) {
      if (request !== contextVersion) return
      rows.push(summarizeLogEntry(await readLogEntry(file, index, id), currentMapping))
    }
    if (request === contextVersion) send('context', request, { rows, anchorId: data.id })
  }
}

self.onmessage = ({ data }) => {
  handle(data).catch((error) => {
    if (['query', 'page'].includes(data.type) && data.request !== queryVersion) return
    send('error', data.request, { error: error.message || 'Could not read the log file.' })
  })
}
