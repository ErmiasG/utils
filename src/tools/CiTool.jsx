import { useEffect, useRef, useState } from 'react'
import { Action, EmptyResult, Notice } from '../components/Workbench'
import LogText from '../components/LogText'
import { downloadText, formatBytes } from '../lib/text'
import { matchesCiFile } from '../lib/ci'

const emptyFilters = { namespace: '', category: '', fileId: null, includePrevious: true }
const categories = { failure: 'Failures', warning: 'Warnings', recovered: 'Recovered attempts', collection: 'Collection gaps' }
const PAGE_SIZE = 100

// Directory drops preserve the same relative paths as the folder picker.
async function droppedSources(items) {
  const sources = []
  async function walk(entry, prefix = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
      sources.push({ file, path: prefix + file.name })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      for (;;) {
        const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
        if (!children.length) break
        for (const child of children) await walk(child, prefix + entry.name + '/')
      }
    }
  }
  const captured = items.map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }))
  for (const { entry, file } of captured) {
    if (entry) await walk(entry)
    else if (file) sources.push({ file, path: file.name })
  }
  return sources
}

function stripDirectoryRoot(sources) {
  const root = sources[0]?.path.split('/')[0]
  return root && sources.every((source) => source.path.startsWith(root + '/'))
    ? sources.map((source) => ({ ...source, path: source.path.slice(root.length + 1) })) : sources
}

export default function CiTool({ notify, onOpenLog }) {
  const folderInput = useRef(null), filesInput = useRef(null), worker = useRef(null), sources = useRef([])
  const sequence = useRef(0), loadRequest = useRef(0), searchRequest = useRef(0), detailRequest = useRef(0), intakeRequest = useRef(0)
  const contextScroll = useRef(null)
  const [bundle, setBundle] = useState(null), [detail, setDetail] = useState(null), [results, setResults] = useState(null)
  const [filters, setFilters] = useState(emptyFilters), [query, setQuery] = useState(''), [fileQuery, setFileQuery] = useState('')
  const [page, setPage] = useState(0), [busy, setBusy] = useState(''), [detailBusy, setDetailBusy] = useState(false)
  const [progress, setProgress] = useState({ loaded: 0, total: 0, path: '' }), [error, setError] = useState(''), [dragging, setDragging] = useState(false)
  useEffect(() => () => worker.current?.terminate(), [])

  function clear() {
    intakeRequest.current++; worker.current?.terminate(); worker.current = null; sources.current = []
    loadRequest.current = ++sequence.current; searchRequest.current = ++sequence.current; detailRequest.current = ++sequence.current
    setBundle(null); setDetail(null); setResults(null); setFilters(emptyFilters); setQuery(''); setFileQuery(''); setPage(0)
    setBusy(''); setDetailBusy(false); setError('')
  }
  function open(input) {
    if (!input.length) { setError('This folder contains no files.'); setBusy(''); return }
    clear(); sources.current = input; setBusy('Analyzing'); setProgress({ loaded: 0, total: input.reduce((sum, source) => sum + source.file.size, 0), path: '' })
    try {
      const task = new Worker(new URL('../lib/ci.worker.js', import.meta.url), { type: 'module' })
      worker.current = task
      const request = ++sequence.current; loadRequest.current = request
      task.onmessage = ({ data }) => {
        if (worker.current !== task) return
        if (data.type === 'report') { downloadText('ci-log-findings.md', data.text, 'markdown'); return }
        if (data.type === 'context' && data.request === detailRequest.current) { setDetail(data); setDetailBusy(false); return }
        if (data.type === 'ready' && data.request === loadRequest.current) { setBundle(data); setBusy(''); notify?.(`Analyzed ${data.stats.files.toLocaleString()} files`); return }
        if (data.type === 'search' && data.request === searchRequest.current) { setResults(data); setBusy(''); return }
        if (data.type === 'progress' && [loadRequest.current, searchRequest.current].includes(data.request)) setProgress(data)
        if (data.type === 'error' && [loadRequest.current, searchRequest.current, detailRequest.current].includes(data.request)) {
          setError(data.error)
          if (data.request === detailRequest.current) setDetailBusy(false)
          else setBusy('')
        }
      }
      task.onerror = () => { if (worker.current === task) { setError('Could not analyze the logs. Reopen the folder to try again.'); setBusy(''); setDetailBusy(false) } }
      task.postMessage({ type: 'load', request, sources: input })
    } catch (error) { setError(error.message); setBusy('') }
  }
  function inspect(evidence) {
    const request = ++sequence.current; detailRequest.current = request
    setDetail(null); setDetailBusy(true); setError('')
    worker.current?.postMessage({ type: 'context', request, fileId: evidence.fileId, line: evidence.line })
  }
  useEffect(() => {
    if (!bundle || !worker.current) return
    setPage(0); setResults(null)
    const request = ++sequence.current; searchRequest.current = request
    worker.current.postMessage({ type: 'cancel-search', request })
    if (!query.trim()) { setBusy(''); return }
    setBusy('Searching'); setProgress({ loaded: 0, total: 0, path: '' })
    const timer = setTimeout(() => worker.current?.postMessage({ type: 'search', request, query: query.trim(), filters }), 250)
    return () => clearTimeout(timer)
  }, [bundle, query, filters])
  useEffect(() => { contextScroll.current?.querySelector('.ci-source-line.selected')?.scrollIntoView({ block: 'center' }) }, [detail])

  const updateFilter = (key, value) => setFilters((previous) => ({ ...previous, [key]: value }))
  const namespaces = bundle ? [...new Set(bundle.files.map((file) => file.namespace).filter(Boolean))].sort() : []
  const visibleFiles = bundle?.files.filter((file) => (!filters.namespace || file.namespace === filters.namespace) && file.path.toLowerCase().includes(fileQuery.toLowerCase())) || []
  const findings = bundle?.findings.filter((finding) => matchesCiFile(bundle.files[finding.fileId], filters) && (!filters.category || finding.category === filters.category)) || []
  const visibleFindings = findings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const selectedFile = detail ? bundle?.files[detail.fileId] : null
  const pages = Math.max(1, Math.ceil(findings.length / PAGE_SIZE))
  const lead = bundle?.findings.find((finding) => finding.ruleId === 'job-failed' && bundle.files[finding.fileId].kind === 'Job') || bundle?.findings.find((finding) => finding.category === 'failure')
  function sourceButton(evidence, label) {
    return <button type="button" className="ci-evidence" key={`${evidence.fileId}:${evidence.line}`} onClick={() => inspect(evidence)} aria-label={`Inspect ${evidence.path} line ${evidence.line}`}><span>{label || `${evidence.path}:${evidence.line}`}</span><code>{evidence.text}</code></button>
  }

  return <div className={`ci-tool${dragging ? ' dragging' : ''}`} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={async (event) => {
    event.preventDefault(); setDragging(false)
    const items = [...event.dataTransfer.items].filter((item) => item.kind === 'file')
    clear(); const request = ++intakeRequest.current; setBusy('Reading folder'); setError('')
    try { const input = await droppedSources(items); if (intakeRequest.current === request) open(stripDirectoryRoot(input)) }
    catch (error) { if (intakeRequest.current === request) { setError(error.message); setBusy('') } }
  }}>
    <div className="tool-actions"><span className="hint">Open an extracted CI log folder or drop it here. Search across files and follow failure evidence.</span><div className="actions">
      <Action icon="upload" primary onClick={() => folderInput.current?.click()}>Open folder</Action>
      <Action onClick={() => filesInput.current?.click()}>Open files</Action>
      <Action icon="download" disabled={!bundle || busy === 'Analyzing'} onClick={() => worker.current?.postMessage({ type: 'report', request: ++sequence.current })}>Save findings</Action>
      <Action onClick={clear}>{busy ? 'Cancel / clear' : 'Clear'}</Action>
    </div><input ref={folderInput} aria-label="CI log folder" type="file" webkitdirectory="" multiple hidden onChange={(event) => { open(stripDirectoryRoot([...event.target.files].map((file) => ({ file, path: file.webkitRelativePath || file.name })))); event.target.value = '' }} /><input ref={filesInput} aria-label="CI log files" type="file" multiple hidden onChange={(event) => { open([...event.target.files].map((file) => ({ file, path: file.name }))); event.target.value = '' }} /></div>
    <Notice>{error}</Notice>
    {busy && <div className="log-progress" role="status"><span>{busy}… {progress.total > 0 && `${Math.round(progress.loaded / progress.total * 100)}%`}</span><progress max={progress.total || 1} value={progress.loaded} aria-label="CI analysis progress" /><span className="ci-progress-path" title={progress.path}>{progress.path}</span></div>}
    {!bundle ? <section className="panel"><EmptyResult icon="ci" title="Explore a CI run">Import container logs, Kubernetes events, resource descriptions, and runner output together. All processing stays in this browser.</EmptyResult></section> : <>
      <div className="ci-summary"><span><strong>{bundle.stats.files.toLocaleString()}</strong> {bundle.stats.files === 1 ? 'file' : 'files'}</span><span>{formatBytes(bundle.stats.bytes)}</span><span><strong>{bundle.stats.findings.toLocaleString()}</strong> grouped findings</span><span><strong>{bundle.stats.failedJobs}</strong> failed {bundle.stats.failedJobs === 1 ? 'Job' : 'Jobs'}</span><span>{bundle.stats.empty.toLocaleString()} empty files</span></div>
      {bundle.failures.length > 0 && <Notice tone="warning">{bundle.failures.length} {bundle.failures.length === 1 ? 'file' : 'files'} could not be read. File details and the downloaded findings list the reason.</Notice>}
      {bundle.files.some((file) => file.truncated) && <Notice tone="warning">Individual lines over 8 MiB are analyzed and searched using their first 8 MiB. Save file preserves the complete source.</Notice>}
      <section className="ci-lead panel" aria-label="Investigation starting point"><div><span className="eyebrow">START HERE</span><strong>{lead?.title || 'No failure patterns detected'}</strong><p>{lead ? `${lead.path}:${lead.line}. ${lead.explanation}` : 'Try searching runner output and service logs. A clean scan does not establish that CI passed.'}</p></div>{lead && <Action onClick={() => inspect(lead.evidence[0])}>Inspect evidence</Action>}{lead?.related.length > 0 && <div className="ci-related"><span>Possible causes in its dependencies</span>{lead.related.map((id) => {
        const related = bundle.findings.find((finding) => finding.id === id)
        return <button type="button" key={id} onClick={() => inspect(related.evidence[0])}>{related.title} · {related.path}:{related.line}</button>
      })}</div>}<small>Findings are investigation leads. Dependency links are inferred from Job commands; runner output confirms which failure ended CI.</small></section>
      <div className="log-filters ci-filters">
        <label className="log-search">Search all logs<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search errors, resources, or messages…" /></label>
        <label>Namespace<select aria-label="Namespace" value={filters.namespace} onChange={(event) => { setFilters((previous) => ({ ...previous, namespace: event.target.value, fileId: null })) }}><option value="">All namespaces</option>{namespaces.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label>Evidence<select aria-label="Evidence" value={filters.category} onChange={(event) => updateFilter('category', event.target.value)}><option value="">All evidence</option>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="ci-checkbox"><input type="checkbox" checked={filters.includePrevious} onChange={(event) => updateFilter('includePrevious', event.target.checked)} />Include previous logs</label>
        <Action onClick={() => { setFilters(emptyFilters); setQuery(''); setFileQuery('') }}>Reset filters</Action>
      </div>
      {filters.fileId !== null && <div className="ci-scope"><span>Searching in {bundle.files[filters.fileId].path}</span><Action onClick={() => updateFilter('fileId', null)}>All files</Action></div>}
      <div className={`ci-panels${detail || detailBusy ? ' has-detail' : ''}`}>
        <section className="ci-files panel" aria-label="Collected files"><div className="panel-head"><span className="panel-label">Files<small>{visibleFiles.length.toLocaleString()} shown</small></span></div><label className="ci-file-search">Find files<input type="search" value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Path, pod, or container…" /></label><div className="ci-file-list">{visibleFiles.map((file) => <button type="button" key={file.id} className={detail?.fileId === file.id ? 'selected' : ''} title={file.path} onClick={() => { updateFilter('fileId', file.id); inspect({ fileId: file.id, line: 1 }) }}><span>{file.path}</span><small>{file.kind} · {formatBytes(file.size)} · {file.signals} signals{file.recovered ? ' · recovered Job' : ''}{file.error ? ' · unreadable' : ''}</small></button>)}{!visibleFiles.length && <p className="hint">No files match this path.</p>}</div></section>
        <section className="ci-results panel" aria-label={query.trim() ? 'Cross-file search results' : 'Failure findings'}><div className="panel-head"><span className="panel-label">{query.trim() ? 'Search results' : 'Findings'}<small>{query.trim() ? results ? `${results.total.toLocaleString()} matching lines${results.limited ? ' · first 200 shown' : ''}` : 'Searching…' : `${findings.length.toLocaleString()} findings`}</small></span>{!query.trim() && <div className="panel-actions"><Action disabled={page === 0} onClick={() => setPage(page - 1)}>Previous findings</Action><span className="hint">{page + 1} / {pages}</span><Action disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next findings</Action></div>}</div><div className="ci-findings">
          {query.trim() ? results?.rows.map((row) => <article className="ci-search-result" key={`${row.fileId}:${row.line}`}>{sourceButton(row)}{row.timestamp && <small>{row.timestamp}</small>}</article>) : visibleFindings.map((finding) => <article className="ci-finding" key={finding.id}><div className="ci-finding-heading"><strong>{finding.title}</strong><span className={`ci-category ${finding.category}`}>{categories[finding.category]}</span></div><p>{finding.explanation}</p><div className="ci-finding-meta">{finding.count.toLocaleString()} occurrences · {finding.path} · lines {finding.line.toLocaleString()}–{finding.lastLine.toLocaleString()}</div>{sourceButton(finding.evidence[0])}<details><summary>More evidence</summary>{finding.evidence.slice(1).map((evidence) => sourceButton(evidence))}{finding.lastLine !== finding.evidence.at(-1).line && sourceButton(finding.lastEvidence, 'Last occurrence')}{finding.related.length > 0 && <div className="ci-related"><span>Related dependency evidence</span>{finding.related.map((id) => { const related = bundle.findings.find((item) => item.id === id); return <button type="button" key={id} onClick={() => inspect(related.evidence[0])}>{related.title} · {related.path}:{related.line}</button> })}</div>}</details></article>)}
          {(query.trim() && results?.total === 0 || !query.trim() && !findings.length) && <EmptyResult icon="ci" title="No matching evidence">Change the search or filters to explore other files.</EmptyResult>}
        </div></section>
        {(detail || detailBusy) && <section className="ci-context panel" aria-label="Source context"><div className="panel-head"><span className="panel-label">{detail ? `${detail.path}:${detail.line}` : 'Reading source…'}{selectedFile && <small>{selectedFile.namespace || 'No namespace'} · {selectedFile.workload || selectedFile.kind} {selectedFile.container && `· ${selectedFile.container}`}</small>}</span><Action onClick={() => { detailRequest.current = ++sequence.current; setDetail(null); setDetailBusy(false) }}>Close source</Action></div>{detail && <><div className="ci-context-actions"><Action onClick={() => onOpenLog(sources.current[detail.fileId].file)}>Open in log viewer</Action><Action icon="download" onClick={() => {
          const file = sources.current[detail.fileId].file, url = URL.createObjectURL(file), link = document.createElement('a')
          link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
        }}>Save file</Action><span>{selectedFile.lines.toLocaleString()} source lines</span></div><div className="ci-source" ref={contextScroll} aria-label="Source lines">{detail.rows.length ? detail.rows.map((row) => <div key={row.line} className={`ci-source-line${row.line === detail.line ? ' selected' : ''}`}><span>{row.line}</span><pre><LogText text={row.text} />{row.clipped && <em>… line preview truncated</em>}</pre></div>) : <p className="hint">This file is empty.</p>}</div><div className="ci-context-pager"><Action disabled={detail.rows[0]?.line <= 1 || !detail.rows.length} onClick={() => inspect({ fileId: detail.fileId, line: Math.max(1, detail.line - 21) })}>Earlier lines</Action><span className="hint">{detail.rows[0]?.line || 0}–{detail.rows.at(-1)?.line || 0} / {detail.lastLine.toLocaleString()}</span><Action disabled={detail.rows.at(-1)?.line >= detail.lastLine || !detail.rows.length} onClick={() => inspect({ fileId: detail.fileId, line: Math.min(detail.lastLine, detail.line + 21) })}>Later lines</Action></div></>}</section>}
      </div>
    </>}
  </div>
}
