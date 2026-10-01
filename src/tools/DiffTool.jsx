import { useEffect, useRef, useState } from 'react'
import { Action, Editor, EmptyResult, Notice } from '../components/Workbench'
import { downloadText } from '../lib/text'

const example = ['{\n  "name": "local-utils",\n  "version": "1.0.0",\n  "private": true\n}\n', '{\n  "name": "local-utils",\n  "version": "1.1.0",\n  "private": true,\n  "offline": true\n}\n']

export default function DiffTool({ notify }) {
  const [before, setBefore] = useState('')
  const [after, setAfter] = useState('')
  const [oldName, setOldName] = useState('original.txt')
  const [newName, setNewName] = useState('modified.txt')
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
  const [ignoreLineEndings, setIgnoreLineEndings] = useState(true)
  const [changesOnly, setChangesOnly] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const worker = useRef(null)
  const invalidate = () => { worker.current?.terminate(); worker.current = null; setBusy(false); setResult(null); setError('') }
  useEffect(() => () => worker.current?.terminate(), [])
  const compare = () => {
    invalidate()
    setBusy(true)
    const task = new Worker(new URL('../lib/diff.worker.js', import.meta.url), { type: 'module' })
    worker.current = task
    task.onmessage = ({ data }) => { setResult(data.result || null); setError(data.error || ''); setBusy(false); task.terminate(); worker.current = null }
    task.onerror = () => { setError('Comparison failed. Try a smaller file or reload the app.'); setBusy(false); task.terminate(); worker.current = null }
    task.postMessage({ before, after, options: { oldName, newName, ignoreWhitespace, ignoreLineEndings } })
  }
  const rows = result?.rows.filter((row) => !changesOnly || row.type !== 'same') || []
  return <>
    <div className="tool-actions"><span className="hint">Paste text or drop a file into each pane.</span><Action onClick={() => { invalidate(); setBefore(example[0]); setAfter(example[1]); setOldName('original.json'); setNewName('modified.json') }}>Load example</Action><Action onClick={() => { invalidate(); setBefore(''); setAfter(''); setOldName('original.txt'); setNewName('modified.txt') }}>Clear</Action></div>
    <div className="two-columns"><Editor label="Original" value={before} filename={oldName} onChange={(value) => { invalidate(); setBefore(value) }} onFile={setOldName} placeholder="Original text or file…" notify={notify} /><Editor label="Modified" value={after} filename={newName} onChange={(value) => { invalidate(); setAfter(value) }} onFile={setNewName} placeholder="Modified text or file…" notify={notify} /></div>
    <div className="diff-actions"><div className="options"><label><input type="checkbox" checked={ignoreWhitespace} onChange={(e) => { invalidate(); setIgnoreWhitespace(e.target.checked) }} />Ignore edge whitespace</label><label><input type="checkbox" checked={ignoreLineEndings} onChange={(e) => { invalidate(); setIgnoreLineEndings(e.target.checked) }} />Normalize CRLF</label></div><div className="actions"><Action icon="swap" onClick={() => { invalidate(); setBefore(after); setAfter(before); setOldName(newName); setNewName(oldName) }}>Swap</Action><Action primary icon="diff" onClick={compare} disabled={busy}>{busy ? 'Comparing…' : 'Compare'}</Action></div></div>
    <Notice>{error}</Notice>
    <section className="panel diff-result"><div className="panel-head"><span className="panel-label">Comparison{result && <small><span className="added-text">+{result.added} added</span><span className="removed-text">−{result.removed} removed</span></small>}</span><div className="panel-actions">{result && <label className="checkbox-label"><input type="checkbox" checked={changesOnly} onChange={(e) => setChangesOnly(e.target.checked)} />Changes only</label>}<Action icon="download" disabled={!result?.patch} onClick={() => downloadText('comparison.patch', result.patch, 'text')}>Save patch</Action></div></div>
      {busy ? <EmptyResult icon="diff" title="Comparing your files…">The comparison runs in a background worker.</EmptyResult> : result ? <><div className="diff-caption">{result.identical ? 'No differences with these options.' : 'Unified line comparison'}<span>Patch export preserves exact input, including whitespace and line endings.</span></div>{!result.patch && <Notice tone="warning">The exact patch exceeded the computation limit. Display options may have simplified the comparison; compare a smaller section to export a patch.</Notice>}{rows.length ? <div className="diff-lines" role="table" aria-label="Line differences">{rows.slice(0, 10_000).map((row, index) => <div className={`diff-line ${row.type}`} role="row" key={index}><span className="line-number" role="cell">{row.oldLine}</span><span className="line-number" role="cell">{row.newLine}</span><span className="line-sign" role="cell">{row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ' '}</span><code role="cell">{row.text || ' '}</code></div>)}</div> : <EmptyResult icon="check" title="No changed lines">The texts match with your current comparison options.</EmptyResult>}{rows.length > 10_000 && <Notice tone="warning">Showing the first 10,000 lines. Save the patch to see the full comparison.</Notice>}</> : <EmptyResult icon="diff" title="Spot the difference">Add two versions above, then compare to see additions and removals.</EmptyResult>}
    </section>
  </>
}
