import { useEffect, useRef, useState } from 'react'
import { Action, CopyButton, Editor, EmptyResult, Notice, Output } from '../components/Workbench'
import { decodeBase64, encodeBase64, generateUuids, hashBytes, hashText, parseTimestamp } from '../lib/utilities'

export function EncodingTool({ kind, notify }) {
  const [source, setSource] = useState('')
  const [mode, setMode] = useState('encode')
  const [urlSafe, setUrlSafe] = useState(false)
  let value = ''
  let error = ''
  try {
    if (source.length > 2_000_000) throw new Error('Use text smaller than 2 million characters.')
    value = kind === 'base64' ? mode === 'encode' ? encodeBase64(source, urlSafe) : decodeBase64(source, urlSafe) : mode === 'encode' ? encodeURIComponent(source) : decodeURIComponent(source)
  } catch (err) { error = kind === 'url' && err instanceof URIError ? 'Invalid URL encoding. Check percent escapes and UTF-8 characters.' : err.message }
  return <><div className="tool-actions"><div className="segmented" role="group" aria-label="Conversion mode">{['encode', 'decode'].map((id) => <button type="button" key={id} className={mode === id ? 'selected' : ''} onClick={() => setMode(id)}>{id === 'encode' ? 'Encode' : 'Decode'}</button>)}</div>{kind === 'base64' && <label className="checkbox-label"><input type="checkbox" checked={urlSafe} onChange={(e) => setUrlSafe(e.target.checked)} />URL-safe alphabet</label>}<div className="actions"><Action onClick={() => setSource(mode === 'encode' ? 'Hello, world! 👋' : kind === 'base64' ? 'SGVsbG8sIHdvcmxkISDwn5GL' : 'Hello%2C%20world!%20%F0%9F%91%8B')}>Load example</Action><Action disabled={!source} onClick={() => setSource('')}>Clear</Action></div></div><div className="two-columns"><Editor label="Input" value={source} onChange={setSource} notify={notify} placeholder={`Text to ${mode}…`} /><Output value={error ? '' : value} notify={notify} /></div><Notice>{error}</Notice><div className="tool-actions"><span className="hint">{kind === 'base64' ? 'UTF-8 text, including accents and emoji.' : 'Encodes a URL component. Spaces become %20; literal + signs stay + when decoding.'}</span><Action icon="swap" disabled={!value || !!error} onClick={() => { setSource(value); setMode(mode === 'encode' ? 'decode' : 'encode') }}>Use result as input</Action></div></>
}

export function TimestampTool({ notify }) {
  const [source, setSource] = useState('')
  const [unit, setUnit] = useState('seconds')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  let result
  let error
  if (source.trim()) { try { result = parseTimestamp(source, unit) } catch (err) { error = err.message } }
  return <><section className="panel current-time"><span><span className="live-dot" />Current Unix time</span><code>{Math.floor(now / 1000)}</code><Action onClick={() => setSource(String(unit === 'seconds' ? Math.floor(Date.now() / 1000) : Date.now()))}>Use now</Action></section><div className="tool-actions"><div className="segmented" role="group" aria-label="Timestamp units">{['seconds', 'milliseconds'].map((id) => <button type="button" key={id} className={unit === id ? 'selected' : ''} onClick={() => setUnit(id)}>{id === 'seconds' ? 'Seconds' : 'Milliseconds'}</button>)}</div><span className="hint">Or paste an ISO 8601 date with a timezone.</span><Action disabled={!source} onClick={() => setSource('')}>Clear</Action></div><label className="input-label">Timestamp or ISO date<input className="text-input mono" value={source} onChange={(e) => setSource(e.target.value)} placeholder="1790856000 or 2026-10-01T12:00:00Z" /></label><Notice>{error}</Notice><section className="panel timestamp-result">{result ? Object.entries({ 'UTC / ISO 8601': result.iso, 'Local time': result.local, 'Unix seconds': result.seconds, 'Unix milliseconds': result.milliseconds }).map(([label, value]) => <div className="value-row" key={label}><span>{label}</span><code>{value}</code><CopyButton value={value} notify={notify} /></div>) : <EmptyResult icon="timestamp" title="Put a timestamp in perspective">Convert between Unix time, UTC, and your local timezone.</EmptyResult>}</section></>
}

export function HashTool({ notify }) {
  const [source, setSource] = useState('')
  const [algorithm, setAlgorithm] = useState('SHA-256')
  const [file, setFile] = useState(null)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  const sequence = useRef(0)
  useEffect(() => {
    const id = ++sequence.current
    setResult(''); setError(''); setBusy(true)
    const run = async () => {
      try {
        const value = file ? await hashBytes(await file.arrayBuffer(), algorithm) : await hashText(source, algorithm)
        if (id === sequence.current) setResult(value)
      } catch (err) { if (id === sequence.current) setError(err.message || 'Hashing failed. Use localhost in a modern browser.') }
      finally { if (id === sequence.current) setBusy(false) }
    }
    const timer = setTimeout(run, 180)
    return () => { sequence.current++; clearTimeout(timer) }
  }, [source, file, algorithm])
  return <><div className="tool-actions"><label className="inline-label">Algorithm <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)}>{['SHA-256', 'SHA-384', 'SHA-512', 'SHA-1'].map((value) => <option key={value}>{value}</option>)}</select></label><div className="actions"><input ref={ref} type="file" hidden onChange={(e) => { const incoming = e.target.files[0]; e.target.value = ''; if (incoming?.size > 100_000_000) { notify('Choose a file smaller than 100 MB.'); return }; if (incoming) setFile(incoming) }} /><Action icon="upload" onClick={() => ref.current?.click()}>Hash a file</Action><Action disabled={!source && !file} onClick={() => { setSource(''); setFile(null) }}>Clear</Action></div></div>{file ? <section className="panel file-hash"><strong>{file.name}</strong><span>{file.size.toLocaleString()} bytes · hashing exact file bytes</span><Action onClick={() => setFile(null)}>Use text instead</Action></section> : <Editor label="Text to hash" value={source} onChange={setSource} notify={notify} placeholder="Type or paste text. Empty input produces the hash of an empty string." />}<Notice>{error}</Notice>{algorithm === 'SHA-1' && <Notice tone="warning">SHA-1 is provided for legacy checksums; use SHA-256 or stronger for new work.</Notice>}<section className="panel hash-result"><div className="panel-head"><span className="panel-label">{algorithm} digest<small>Hexadecimal</small></span><CopyButton value={result} notify={notify} disabled={busy} /></div><pre>{busy ? 'Calculating…' : result}</pre></section><p className="footnote">Text is hashed as UTF-8, including every space and newline. File mode hashes the original bytes.</p></>
}

export function UuidTool({ notify }) {
  const [count, setCount] = useState('1')
  const [uppercase, setUppercase] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const generate = () => { try { setResult(generateUuids(Number(count))); setError('') } catch (err) { setError(err.message) } }
  return <><div className="tool-actions"><div className="options"><label className="inline-label">Quantity <input className="number-input" type="number" min="1" max="100" value={count} onChange={(e) => setCount(e.target.value)} /></label><label className="checkbox-label"><input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} />Uppercase</label></div><Action primary onClick={generate}>Generate UUIDs</Action></div><Notice>{error}</Notice>{result ? <Output value={uppercase ? result.toUpperCase() : result} notify={notify} filename="uuids.txt" label="UUIDs · version 4" /> : <section className="panel"><EmptyResult icon="uuid" title="A fresh identity">Generate up to 100 random version 4 UUIDs using your browser’s cryptographic random source.</EmptyResult></section>}<p className="footnote">UUIDs are generated locally with crypto.randomUUID().</p></>
}
