import { useCallback, useEffect, useRef, useState } from 'react'
import { Action, CopyButton, Editor, EmptyResult, Notice, useTextFile } from '../components/Workbench'
import CodeView from '../components/CodeView'
import MarkdownView from '../components/MarkdownView'
import Loading from '../components/Loading'
import { formatDocument, minifyDocument } from '../lib/format'
import { downloadText } from '../lib/text'
import { nextPaint } from '../lib/schedule'

const examples = {
  json: '{"name":"local-utils","private":true,"tools":["JWT decoder","File diff","Markdown"],"settings":{"theme":"light","indent":2}}',
  html: '<!doctype html><html><head><title>Hello, local.</title></head><body><main><h1>A little less friction.</h1><p>Your everyday tools, <strong>in one place</strong>.</p></main></body></html>',
  xml: '<?xml version="1.0" encoding="UTF-8"?><workbench><name>local-utils</name><tools><tool id="jwt">JWT decoder</tool><tool id="diff">File diff</tool></tools></workbench>',
  markdown: '# A little less friction.\n\nYour everyday developer tools, in one local workbench.\n\n## A quick checklist\n\n- [x] Keep data in your browser\n- [x] Format and compare files\n- [ ] Make something great\n\n```json\n{ "hello": "world" }\n```\n\n## From input to insight\n\n```mermaid\ngraph LR\n  A[Your input] --> B[Local processing]\n  B --> C[Your result]\n```\n\n| Tool | Purpose |\n| --- | --- |\n| JWT | Inspect token claims |\n| Diff | Compare two versions |\n',
}

export default function DocumentTool({ kind, notify, theme }) {
  const [source, setSource] = useState('')
  const [filename, setFilename] = useState('')
  const [view, setView] = useState(kind === 'markdown' ? 'preview' : 'pretty')
  const [indent, setIndent] = useState(2)
  const [wrap, setWrap] = useState(true)
  const [wide, setWide] = useState(kind === 'markdown')
  const [result, setResult] = useState({ output: '', error: null })
  const [stage, setStage] = useState(null)
  const [pending, setPending] = useState(false)
  const fileInput = useRef(null)
  const fileReader = useTextFile({ onChange: setSource, onFile: setFilename, notify, maxFileBytes: kind === 'markdown' ? null : 5_000_000 })
  const onStage = useCallback(setStage, [])
  useEffect(() => {
    let cancelled = false
    setStage(null)
    setPending(true)
    const run = async () => {
      if (kind !== 'markdown' && source.length > 2_000_000) {
        setResult({ output: '', error: { message: 'Use a document smaller than 2 million characters.' } }); setStage(null); setPending(false); return
      }
      if (source.length >= 250_000 && kind !== 'markdown') { setStage('Preparing document…'); await nextPaint() }
      if (cancelled) return
      const next = view === 'min' ? minifyDocument(kind, source) : view === 'pretty' ? formatDocument(kind, source, { indent }) : { output: source, error: null }
      if (cancelled) return
      setResult(next)
      setPending(false)
      if (kind !== 'markdown' || view !== 'preview') setStage(null)
    }
    const timer = setTimeout(run, 180)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [source, view, kind, indent])
  const extension = kind === 'markdown' ? 'md' : kind
  return <>
    <div className="tool-actions"><span className="hint">{kind === 'markdown' ? 'GitHub-flavored Markdown, with Mermaid diagrams.' : 'The familiar MdReader formatter, with an editable source.'}</span>{kind === 'markdown' && wide && <><input ref={fileInput} type="file" hidden onChange={(e) => { fileReader.read(e.target.files[0]); e.target.value = '' }} /><Action icon="upload" disabled={fileReader.reading} onClick={() => fileInput.current?.click()}>{fileReader.reading ? 'Reading…' : 'Open file'}</Action></>}<Action onClick={() => { fileReader.cancelRead(); setSource(examples[kind]); setFilename(`example.${extension}`) }}>Load example</Action><Action disabled={!source && !fileReader.reading} onClick={() => { fileReader.cancelRead(); setSource(''); setFilename('') }}>Clear</Action></div>
    <div className={`two-columns document-columns${wide ? ' full-preview' : ''}`} onDragOver={kind === 'markdown' && wide ? (e) => e.preventDefault() : undefined} onDrop={kind === 'markdown' && wide ? (e) => { e.preventDefault(); fileReader.read(e.dataTransfer.files[0]) } : undefined}>
      <Editor label="Source" value={source} filename={filename} onChange={setSource} onFile={setFilename} notify={notify} fileReader={fileReader} placeholder={`Paste ${kind === 'markdown' ? 'Markdown' : kind.toUpperCase()} here, or drop a file…`} rows={24} />
      <section className="panel document-result"><div className="panel-head"><span className="panel-label">{kind === 'markdown' ? 'Preview' : 'Output'}</span><div className="panel-actions"><CopyButton value={result.output} disabled={pending || !!stage || !!result.error} notify={notify} /><Action icon="download" disabled={!result.output || pending || !!stage || !!result.error} onClick={() => downloadText(filename || `formatted.${extension}`, result.output, kind)}>Save</Action></div></div>
        <div className="document-toolbar"><div className="segmented" role="group" aria-label="Output view">{(kind === 'markdown' ? [['preview', 'Preview'], ['raw', 'Source']] : [['pretty', 'Formatted'], ['min', 'Minified'], ['raw', 'Original']]).map(([id, label]) => <button type="button" key={id} className={view === id ? 'selected' : ''} onClick={() => setView(id)}>{label}</button>)}</div>{kind !== 'markdown' && <label className="indent-label">Indent <select aria-label="Indent size" value={indent} onChange={(e) => setIndent(Number(e.target.value))}>{[2, 4, 8].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>}<label className="checkbox-label"><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />Wrap</label><Action onClick={() => setWide(!wide)}>{wide ? 'Split view' : 'Full width'}</Action></div>
        <Notice>{result.error && `${result.error.message}${result.error.line != null ? ` (line ${result.error.line}, column ${result.error.column})` : ''}`}</Notice>
        <div className="document-preview">{!source ? <EmptyResult icon={kind} title={kind === 'markdown' ? 'A fresh page awaits' : 'Make your data readable'}>{kind === 'markdown' ? 'Start writing or open a Markdown file to see the preview.' : 'Paste a document to format, minify, or inspect its source.'}</EmptyResult> : pending ? <EmptyResult title="Preparing your document…" /> : kind === 'markdown' && view === 'preview' && !result.error ? <MarkdownView source={source} wide theme={theme} onStage={onStage} /> : <CodeView code={result.output} language={kind === 'markdown' ? 'markdown' : kind === 'json' ? 'json' : 'xml'} wrap={wrap} />}<Loading stage={stage} name={filename || 'Document'} /></div>
        <div className="editor-foot"><span>{kind === 'markdown' ? filename || 'Sanitized preview' : `${indent}-space indentation`}</span><span>{pending ? 'Preparing…' : `${result.output ? result.output.split('\n').length.toLocaleString() : 0} lines`}</span></div>
      </section>
    </div>
    {kind === 'html' || kind === 'xml' ? <p className="footnote">Markup formatting uses MdReader’s tolerant indenter. Unbalanced tags produce warnings; minifying removes comments and can change significant whitespace.</p> : null}
  </>
}
