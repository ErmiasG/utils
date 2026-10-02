import { useEffect, useRef, useState } from 'react'
import { Action, CopyButton, EmptyResult, Notice } from '../components/Workbench'
import LogText, { FocusedStackTrace } from '../components/LogText'
import { formatBytes } from '../lib/text'
import { LOG_PAGE_SIZE } from '../lib/logs'

const emptyFilters = { query: '', field: '', level: '', format: '', threadName: '', threadId: '' }
const emptyMapping = { timestamp: '', level: '', logger: '', message: '', threadName: '', threadId: '' }
const fieldLabels = { timestamp: 'Timestamp', level: 'Level', logger: 'Logger', message: 'Message', threadName: 'Thread name', threadId: 'Thread ID' }
const example = '[Entrypoint] Starting service\n' + [
  { Timestamp: '2026-10-02T18:45:36.515+0000', Level: 'INFO', LoggerName: 'PayaraMicro', LogMessage: 'Service started', ThreadName: 'main', ThreadID: '1' },
  { timestamp: '2026-10-02T18:45:37Z', severity: 'WARNING', message: 'Retrying connection', thread_name: 'worker', thread_id: 7, attempt: 2, context: { host: 'localhost' } },
  { time: '2026-10-02T18:45:38Z', level: 'ERROR', msg: 'Connection failed', thread_name: 'worker', thread_id: 7, Throwable: 'java.net.ConnectException: Connection refused\n\tat example.Client.connect(Client.java:42)\n\tat io.hops.hopsworks.api.Client.connect(Client.java:80)\nCaused by: java.net.SocketException: Connection reset\n\tat java.base/java.net.Socket.connect(Socket.java:600)' },
].map((entry) => JSON.stringify(entry)).join('\n')

function sourceLines(entry) {
  return entry.endLine > entry.line ? `${entry.line.toLocaleString()}–${entry.endLine.toLocaleString()}` : entry.line.toLocaleString()
}

function LogFilterSelect({ label, values, value, onChange, placeholder }) {
  const [custom, setCustom] = useState(false)
  const items = [...new Set([...values, ...(value ? [value] : [])])]
  let customOption = '__custom__'
  while (items.includes(customOption)) customOption += '_'
  return <label>{label}<select aria-label={label} value={custom ? customOption : value} onChange={(e) => {
    if (e.target.value === customOption) setCustom(true)
    else { setCustom(false); onChange(e.target.value) }
  }}><option value="">{placeholder}</option>{items.map((item) => <option key={item} value={item}>{item}</option>)}<option value={customOption}>Enter a value…</option></select>{custom && <input aria-label={`Custom ${label}`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`Enter ${label.toLowerCase()}…`} autoFocus />}</label>
}

function LogEntriesTable({ rows, selectedId, onInspect, onFollowThread, busy = false, context = false }) {
  return <table className={`log-table${context ? ' log-context-table' : ''}`}>
    <thead><tr><th>Line</th><th>Timestamp</th><th>Level</th><th>Logger</th><th>Thread</th><th>Message</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id} data-log-entry={row.id} className={selectedId === row.id ? 'selected' : ''}>
      <td><span title={`Source lines ${sourceLines(row)}`}>{sourceLines(row)}</span>{context && selectedId === row.id && <small className="log-context-anchor">Selected</small>}</td>
      <td><span title={row.timestamp}>{row.timestamp || '—'}</span></td>
      <td><span className={`log-level ${['ERROR', 'FATAL', 'SEVERE'].includes(row.level) ? 'error' : ['WARN', 'WARNING'].includes(row.level) ? 'warning' : ''}`}>{row.level || (row.format === 'json' ? 'JSON' : row.format === 'invalid' ? 'INVALID' : 'TEXT')}</span></td>
      <td><span title={row.logger}>{row.logger || '—'}</span></td>
      <td>{row.threadName && <button type="button" className="log-thread-value" title={row.threadName} aria-label={`Follow thread name ${row.threadName} at line ${row.line}`} disabled={Boolean(busy)} onClick={() => onFollowThread({ threadName: row.threadName })}>{row.threadName}</button>}{row.threadId && <button type="button" className="log-thread-value" title={`Thread ID ${row.threadId}`} aria-label={`Follow thread ID ${row.threadId} at line ${row.line}`} disabled={Boolean(busy)} onClick={() => onFollowThread({ threadId: row.threadId })}>#{row.threadId}</button>}{!row.threadName && !row.threadId && '—'}</td>
      <td><button type="button" aria-label={`Inspect ${row.endLine > row.line ? 'lines' : 'line'} ${row.line}${row.endLine > row.line ? `–${row.endLine}` : ''}`} aria-pressed={selectedId === row.id} onClick={() => onInspect(row)} disabled={Boolean(busy)}>{row.message || '(empty message)'}</button></td>
    </tr>)}</tbody>
  </table>
}

export default function LogTool({ notify }) {
  const worker = useRef(null), fileInput = useRef(null), source = useRef(null)
  const sequence = useRef(0), queryRequest = useRef(0), detailRequest = useRef(0)
  const contextRequest = useRef(0), pendingJump = useRef(null)
  const [filename, setFilename] = useState(''), [fileSize, setFileSize] = useState(0)
  const [meta, setMeta] = useState(null), [result, setResult] = useState(null), [detail, setDetail] = useState(null)
  const [filterValues, setFilterValues] = useState({ level: [], threadName: [], threadId: [] })
  const [filters, setFilters] = useState(emptyFilters), [mapping, setMapping] = useState(emptyMapping)
  const [filterReset, setFilterReset] = useState(0)
  const [busy, setBusy] = useState(''), [progress, setProgress] = useState(0), [error, setError] = useState('')
  const [detailMode, setDetailMode] = useState('formatted'), [detailBusy, setDetailBusy] = useState(false)
  const [context, setContext] = useState(null), [contextBusy, setContextBusy] = useState(false), [contextRadius, setContextRadius] = useState(10)
  const [pasteOpen, setPasteOpen] = useState(false), [paste, setPaste] = useState(''), [dragging, setDragging] = useState(false)
  const scroll = useRef(null), contextScroll = useRef(null)

  useEffect(() => () => worker.current?.terminate(), [])
  const clear = () => {
    worker.current?.terminate(); worker.current = null; source.current = null
    queryRequest.current = ++sequence.current; detailRequest.current = ++sequence.current
    contextRequest.current = ++sequence.current; pendingJump.current = null
    setMeta(null); setResult(null); setDetail(null); setFilename(''); setFileSize(0)
    setBusy(''); setDetailBusy(false); setError(''); setFilters(emptyFilters); setMapping(emptyMapping); setPaste('')
    setContext(null); setContextBusy(false); setContextRadius(10); setDetailMode('formatted')
  }
  const open = (file) => {
    if (!file) return
    clear(); source.current = file; setFilename(file.name); setFileSize(file.size); setPasteOpen(false); setBusy('Indexing'); setProgress(0)
    try {
      const task = new Worker(new URL('../lib/logs.worker.js', import.meta.url), { type: 'module' })
      worker.current = task
      const request = ++sequence.current; queryRequest.current = request
      task.onmessage = ({ data }) => {
        if (task !== worker.current) return
        if (data.type === 'detail') {
          if (data.request === detailRequest.current) { setDetail(data); setDetailBusy(false) }
          return
        }
        if (data.type === 'context') {
          if (data.request === contextRequest.current) { setContext(data); setContextBusy(false) }
          return
        }
        if (data.type === 'error' && data.request === contextRequest.current) { setError(data.error); setContextBusy(false); return }
        if (data.type === 'error' && data.request === detailRequest.current) { setError(data.error); setDetailBusy(false); return }
        if (data.request !== queryRequest.current) return
        if (data.type === 'progress') setProgress(data.total ? Math.round(data.loaded / data.total * 100) : 100)
        if (data.type === 'ready') { setMeta(data); setFilterValues(data.filterValues); setBusy(''); notify?.(`Opened ${file.name}`) }
        if (data.type === 'page') { setResult(data); setFilterValues(data.filterValues); setBusy('') }
        if (data.type === 'error') { setError(data.error); setBusy('') }
      }
      task.onerror = () => { if (task === worker.current) { setError('The log worker failed. Reopen the file to try again.'); setBusy(''); setDetailBusy(false); setContextBusy(false) } }
      task.postMessage({ type: 'load', file, request })
    } catch (error) { setError(error.message); setBusy('') }
  }

  // Each change cancels an older scan in the worker; only the latest request
  // can update the preview. File objects stay outside React state.
  useEffect(() => {
    if (!meta || !worker.current) return
    const request = ++sequence.current; queryRequest.current = request; detailRequest.current = ++sequence.current
    contextRequest.current = ++sequence.current
    const anchorId = pendingJump.current; pendingJump.current = null
    setBusy('Searching'); setProgress(0); setResult(null); setDetail(null); setDetailBusy(false); setError('')
    setContext(null); setContextBusy(false)
    const timer = setTimeout(() => worker.current?.postMessage({ type: 'query', request, filters, mapping, anchorId }), 250)
    return () => clearTimeout(timer)
  }, [meta, filters, mapping])

  useEffect(() => {
    if (!result) return
    if (result.anchorId !== null) scroll.current?.querySelector(`[data-log-entry="${result.anchorId}"]`)?.scrollIntoView({ block: 'center' })
    else scroll.current?.scrollTo({ top: 0 })
  }, [result])

  useEffect(() => {
    if (context) contextScroll.current?.querySelector(`[data-log-entry="${context.anchorId}"]`)?.scrollIntoView({ block: 'center' })
  }, [context])

  useEffect(() => {
    if (detailMode !== 'context' || !detail || !worker.current) return
    const request = ++sequence.current; contextRequest.current = request
    setContext(null); setContextBusy(true); setError('')
    worker.current.postMessage({ type: 'context', request, id: detail.id, radius: contextRadius })
    return () => { contextRequest.current = ++sequence.current }
  }, [detailMode, detail, contextRadius])

  const goToPage = (page) => {
    const request = ++sequence.current; queryRequest.current = request; detailRequest.current = ++sequence.current
    contextRequest.current = ++sequence.current
    setBusy('Reading page'); setDetail(null); setDetailBusy(false); setError('')
    setContext(null); setContextBusy(false)
    worker.current?.postMessage({ type: 'page', request, page })
  }
  const inspect = (row) => {
    const request = ++sequence.current; detailRequest.current = request
    contextRequest.current = ++sequence.current
    setDetail(null); setDetailBusy(true); setDetailMode('formatted'); setError('')
    setContext(null); setContextBusy(false)
    worker.current?.postMessage({ type: 'detail', request, id: row.id })
  }
  const replaceFilters = (value) => { setFilterReset((previous) => previous + 1); setFilters(value) }
  const followThread = (thread) => replaceFilters({ ...emptyFilters, ...thread })
  const jumpToOriginal = (id) => { pendingJump.current = id; replaceFilters({ ...emptyFilters }) }
  const saveEntry = () => {
    if (!detail || !source.current) return
    const url = URL.createObjectURL(source.current.slice(detail.start, detail.end))
    const link = document.createElement('a'); link.href = url; link.download = detail.endLine > detail.line ? `log-lines-${detail.line}-${detail.endLine}.txt` : `log-line-${detail.line}.txt`
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const updateFilter = (key, value) => setFilters((previous) => ({ ...previous, [key]: value }))
  const pages = result ? Math.max(1, Math.ceil(result.total / LOG_PAGE_SIZE)) : 1
  return <div className={`log-tool${dragging ? ' dragging' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }} onDrop={(e) => { e.preventDefault(); setDragging(false); open(e.dataTransfer.files[0]) }}>
    <div className="tool-actions"><span className="hint">Open or drop a UTF-8 log file. JSON lines stay separate; consecutive plain text is grouped.</span><div className="actions">
      <Action icon="upload" primary onClick={() => fileInput.current?.click()}>Open file</Action>
      <Action onClick={() => setPasteOpen(!pasteOpen)}>Paste logs</Action>
      <Action onClick={() => open(new File([example], 'example.log', { type: 'text/plain' }))}>Load example</Action>
      <Action onClick={clear}>{busy ? 'Cancel / clear' : 'Clear'}</Action>
    </div><input ref={fileInput} type="file" hidden onChange={(e) => { open(e.target.files[0]); e.target.value = '' }} /></div>
    {pasteOpen && <section className="panel log-paste"><label htmlFor="pasted-logs" className="panel-head">Log text</label><textarea id="pasted-logs" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste JSON lines or mixed text…" spellCheck="false" /><div className="panel-head"><span className="hint">For large logs, open a file.</span><Action primary disabled={!paste.trim()} onClick={() => open(new File([paste], 'pasted.log', { type: 'text/plain' }))}>View logs</Action></div></section>}
    {filename && <div className="log-file-info"><strong>{filename}</strong><span>{formatBytes(fileSize)}</span>{meta && <span>{meta.count.toLocaleString()} entries · {meta.counts.json.toLocaleString()} JSON · {meta.counts.text.toLocaleString()} text · {meta.counts.invalid.toLocaleString()} invalid JSON</span>}</div>}
    <Notice>{error}</Notice>
    {meta?.counts.truncated > 0 && <Notice tone="warning">{meta.counts.truncated} entries exceed 8 MiB. Details preview the first 8 MiB. Text groups are searched line by line; individual lines over 8 MiB use their first 8 MiB. Save entry reads the complete original text.</Notice>}
    {(meta?.fieldsLimited || meta?.levelsLimited) && <Notice tone="warning">Field and level suggestions show up to 256 unique values each. All properties remain available in entry details and full-text search.</Notice>}
    {meta && <>
      <div className="log-filters">
        <label className="log-search">Search<input type="search" value={filters.query} onChange={(e) => updateFilter('query', e.target.value)} placeholder="Search messages and properties…" /></label>
        <label>Search field<select aria-label="Search field" value={filters.field} onChange={(e) => updateFilter('field', e.target.value)}><option value="">All properties & text</option>{meta.fields.map((field) => <option key={field}>{field}</option>)}</select></label>
        <LogFilterSelect key={`level-${filterReset}`} label="Level" values={filterValues.level} value={filters.level} onChange={(value) => updateFilter('level', value.toUpperCase())} placeholder="All levels" />
        <label>Format<select aria-label="Format" value={filters.format} onChange={(e) => updateFilter('format', e.target.value)}><option value="">All entries</option><option value="json">JSON</option><option value="text">Plain text</option><option value="invalid">Invalid JSON</option></select></label>
        {['threadName', 'threadId'].map((role) => <LogFilterSelect key={`${role}-${filterReset}`} label={fieldLabels[role]} values={filterValues[role]} value={filters[role]} onChange={(value) => updateFilter(role, value)} placeholder="All threads" />)}
        <Action onClick={() => replaceFilters(emptyFilters)}>Reset filters</Action>
      </div>
      <details className="log-mapping"><summary>Display fields</summary><div className="log-filters">{Object.keys(emptyMapping).map((role) => <label key={role}>{fieldLabels[role]} field<select aria-label={`${fieldLabels[role]} field`} value={mapping[role]} onChange={(e) => setMapping((previous) => ({ ...previous, [role]: e.target.value }))}><option value="">Auto detect</option>{meta.fields.map((field) => <option key={field}>{field}</option>)}</select></label>)}</div></details>
    </>}
    {busy && <div className="log-progress" role="status"><span>{busy}…{busy !== 'Reading page' && ` ${progress}%`}</span>{busy !== 'Reading page' && <progress max="100" value={progress} aria-label={`${busy} progress`} />}</div>}
    <div className={`log-panels${detail || detailBusy ? ' has-detail' : ''}`}>
      <section className="panel log-result" aria-busy={Boolean(busy)}>
        <div className="panel-head"><span className="panel-label">Entries{result && <small>{result.total.toLocaleString()} matching</small>}</span><div className="panel-actions"><Action disabled={busy || !result || result.page === 0} onClick={() => goToPage(0)}>First</Action><Action disabled={busy || !result || result.page === 0} onClick={() => goToPage(result.page - 1)}>Previous</Action><span className="hint">{result ? `${result.page + 1} / ${pages.toLocaleString()}` : '—'}</span><Action disabled={busy || !result || result.page + 1 >= pages} onClick={() => goToPage(result.page + 1)}>Next</Action><Action disabled={busy || !result || result.page + 1 >= pages} onClick={() => goToPage(pages - 1)}>Last</Action></div></div>
        <div className="log-scroll" ref={scroll}>
          {result?.rows.length ? <LogEntriesTable rows={result.rows} selectedId={detail?.id ?? result.anchorId} onInspect={inspect} onFollowThread={followThread} busy={busy} /> : <EmptyResult icon="logs" title={busy ? `${busy} your log…` : meta ? 'No matching entries' : 'Read your logs'}>{busy ? 'Scanning locally in a background worker.' : meta ? 'Change the search or filters to see more entries.' : 'Open a log file to browse messages, filter levels, and inspect every property.'}</EmptyResult>}
        </div>
      </section>
      {(detail || detailBusy) && <section className="panel log-detail"><div className="panel-head"><span className="panel-label">{detail ? `${detail.endLine > detail.line ? 'Lines' : 'Line'} ${sourceLines(detail)}` : 'Reading entry…'}</span><Action onClick={() => { detailRequest.current = ++sequence.current; contextRequest.current = ++sequence.current; setDetail(null); setDetailBusy(false); setContext(null); setContextBusy(false) }}>Close details</Action></div>{detail && <>
        <div className="log-detail-actions">
          <Action onClick={() => setDetailMode(detailMode === 'raw' ? 'formatted' : 'raw')}>{detailMode === 'raw' ? 'Formatted' : 'Original'}</Action>
          {detail.decoded && <Action onClick={() => setDetailMode(detailMode === 'decoded' ? 'formatted' : 'decoded')}>{detailMode === 'decoded' ? 'Formatted' : 'Decoded text'}</Action>}
          {detail.stack.length > 0 && <Action aria-pressed={detailMode === 'focus'} onClick={() => setDetailMode(detailMode === 'focus' ? detail.decoded ? 'decoded' : 'raw' : 'focus')}>{detailMode === 'focus' ? 'Full stack trace' : 'Stack focus'}</Action>}
          <Action aria-pressed={detailMode === 'context'} onClick={() => setDetailMode(detailMode === 'context' ? 'formatted' : 'context')}>{detailMode === 'context' ? 'Hide context' : 'Show context'}</Action>
          {(detail.threadName || detail.threadId) && <Action onClick={() => followThread({ threadName: detail.threadName, threadId: detail.threadId })}>Follow thread</Action>}
          <Action onClick={() => jumpToOriginal(detail.id)}>Jump to original position</Action>
          <CopyButton value={detail[detailMode]} notify={notify} disabled={detail.clipped} />
          <Action icon="download" onClick={saveEntry}>Save entry</Action>
        </div>
        {detail.format === 'invalid' && <Notice tone="warning">This line is not valid JSON. Its original text is preserved.</Notice>}
        {detail.clipped && <Notice tone="warning">The detail preview is truncated. Save entry downloads the complete original {detail.endLine > detail.line ? 'text block' : 'line'}.</Notice>}
        {detailMode === 'context' ? <div className="log-context-view">
          <div className="log-context-toolbar"><label>Entries each side<select aria-label="Entries each side" value={contextRadius} onChange={(e) => setContextRadius(Number(e.target.value))}>{[10, 25, 50].map((count) => <option key={count} value={count}>{count}</option>)}</select></label><span>Includes entries outside active filters.</span></div>
          <div className="log-scroll" ref={contextScroll} aria-label="Surrounding context" aria-busy={contextBusy}>{contextBusy ? <EmptyResult icon="logs" title="Reading context…">Loading nearby entries from the original file.</EmptyResult> : context && <LogEntriesTable rows={context.rows} selectedId={context.anchorId} onInspect={inspect} onFollowThread={followThread} context />}</div>
        </div> : detailMode === 'focus' ? <FocusedStackTrace segments={detail.stack} /> : <pre aria-label="Entry details"><LogText text={detail[detailMode]} /></pre>}
      </>}</section>}
    </div>
  </div>
}
