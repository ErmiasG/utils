import { useEffect, useMemo, useState } from 'react'
import { decodeJwt, encodeBase64, jwtTiming } from '../lib/utilities'
import CodeView from '../components/CodeView'
import { Action, CopyButton, Editor, EmptyResult, Notice } from '../components/Workbench'
import Icon from '../components/Icon'

function sampleToken() {
  const now = Math.floor(Date.now() / 1000)
  return `${encodeBase64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), true)}.${encodeBase64(JSON.stringify({ sub: '1234567890', name: 'Alex Morgan', role: 'developer', iat: now, exp: now + 3600 }), true)}.ZGVtby1zaWduYXR1cmU`
}

export default function JwtTool({ notify }) {
  const [source, setSource] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const decoded = useMemo(() => {
    if (!source.trim()) return {}
    try { return { result: decodeJwt(source) } } catch (error) { return { error: error.message } }
  }, [source])
  const timing = decoded.result && jwtTiming(decoded.result.payload, now)
  return <>
    <div className="tool-actions"><span className="hint">Inspect a token, one segment at a time.</span><Action onClick={() => setSource(sampleToken())}>Load example</Action><Action onClick={() => setSource('')} disabled={!source}>Clear</Action></div>
    <Editor label="Encoded token" value={source} onChange={setSource} notify={notify} rows={5} placeholder="Paste your JWT here, with or without the Bearer prefix…" />
    <Notice>{decoded.error}</Notice>
    <div className="notice neutral"><Icon name="lock" size={16} /><span>Decoded locally. The signature is <strong>not verified</strong>; decoding does not establish trust.</span></div>
    {decoded.result ? <>
      <div className="jwt-summary"><span className={`pill ${timing.tone}`}>{timing.label}</span><span>Algorithm <code>{String(decoded.result.header.alg ?? 'not specified')}</code></span><span>Type <code>{String(decoded.result.header.typ ?? 'not specified')}</code></span><span className="unverified">Signature unverified</span></div>
      <Notice tone="warning">{timing.issues.join(' ')}</Notice>
      <div className="two-columns">{[['Header', decoded.result.header, 'Token metadata'], ['Payload', decoded.result.payload, 'Token claims']].map(([label, value, subtitle]) => <section className="panel decoded" key={label}><div className="panel-head"><span className="panel-label">{label}<small>{subtitle}</small></span><CopyButton value={JSON.stringify(value, null, 2)} notify={notify} /></div><CodeView code={JSON.stringify(value, null, 2)} language="json" wrap /></section>)}</div>
      {['iat', 'nbf', 'exp'].some((key) => typeof decoded.result.payload[key] === 'number' && Math.abs(decoded.result.payload[key] * 1000) <= 8.64e15) && <section className="panel claims"><div className="panel-head"><span className="panel-label">Time claims</span><span className="hint">UTC</span></div>{[['iat', 'Issued at'], ['nbf', 'Not before'], ['exp', 'Expires at']].filter(([key]) => typeof decoded.result.payload[key] === 'number' && Math.abs(decoded.result.payload[key] * 1000) <= 8.64e15).map(([key, label]) => <div className="claim" key={key}><code>{key}</code><span>{label}</span><time>{new Date(decoded.result.payload[key] * 1000).toISOString()}</time></div>)}</section>}
      <section className="panel signature"><div className="panel-head"><span className="panel-label">Signature <small>Base64URL · unverified</small></span><CopyButton value={decoded.result.signature} notify={notify} /></div><pre>{decoded.result.signature || '(empty signature)'}</pre></section>
    </> : !decoded.error && <section className="panel"><EmptyResult icon="jwt" title="Take a look inside your token">Paste a JWT above to inspect its header, payload, and time claims.</EmptyResult></section>}
  </>
}
