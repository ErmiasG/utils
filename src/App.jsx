import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './components/Icon'
import JwtTool from './tools/JwtTool'
import DiffTool from './tools/DiffTool'
import DocumentTool from './tools/DocumentTool'
import { EncodingTool, HashTool, TimestampTool, UuidTool } from './tools/ConversionTools'

const tools = [
  { id: 'jwt', name: 'JWT decoder', description: 'Look inside a token. Decode headers, claims, and expiry times.', short: 'Inspect token headers and claims', category: 'Inspect & compare', color: 'violet', tag: 'Decode' },
  { id: 'diff', name: 'Text & file diff', description: 'Compare two versions and see exactly what changed.', short: 'Compare text or local files', category: 'Inspect & compare', color: 'orange', tag: 'Compare' },
  { id: 'json', name: 'JSON formatter', description: 'Format, minify, and validate JSON with precise error locations.', short: 'Format, minify, and validate JSON', category: 'Read & format', color: 'blue', tag: 'Format' },
  { id: 'markdown', name: 'Markdown reader', description: 'A clean preview for Markdown, code blocks, and Mermaid diagrams.', short: 'Read Markdown and Mermaid diagrams', category: 'Read & format', color: 'teal', tag: 'Preview' },
  { id: 'html', name: 'HTML formatter', description: 'Turn a wall of markup into readable, indented HTML.', short: 'Format and minify HTML markup', category: 'Read & format', color: 'orange', tag: 'Format' },
  { id: 'xml', name: 'XML formatter', description: 'Pretty-print XML documents or compact them for sharing.', short: 'Format and minify XML documents', category: 'Read & format', color: 'rose', tag: 'Format' },
  { id: 'base64', name: 'Base64 converter', description: 'Encode and decode UTF-8 text, with a URL-safe option.', short: 'Encode and decode UTF-8 text', category: 'Convert & generate', color: 'violet', tag: 'Convert' },
  { id: 'url', name: 'URL encoder', description: 'Encode URL components and decode percent-escaped text.', short: 'Encode and decode URL components', category: 'Convert & generate', color: 'blue', tag: 'Convert' },
  { id: 'timestamp', name: 'Timestamp converter', description: 'Make sense of Unix seconds, milliseconds, and ISO dates.', short: 'Convert Unix timestamps and ISO dates', category: 'Convert & generate', color: 'teal', tag: 'Convert' },
  { id: 'hash', name: 'Hash generator', description: 'Calculate SHA checksums for text or the exact bytes of a file.', short: 'Calculate SHA digests for text and files', category: 'Convert & generate', color: 'rose', tag: 'Generate' },
  { id: 'uuid', name: 'UUID generator', description: 'Create cryptographically random version 4 UUIDs in a click.', short: 'Generate random version 4 UUIDs', category: 'Convert & generate', color: 'orange', tag: 'Generate' },
]
const categories = ['Inspect & compare', 'Read & format', 'Convert & generate']
function currentTool() { const id = new URLSearchParams(location.search).get('tool'); return tools.some((tool) => tool.id === id) ? id : 'home' }
function initialTheme() { try { const stored = localStorage.getItem('utils.theme'); if (stored === 'light' || stored === 'dark') return stored } catch {} return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' }

export default function App() {
  const [active, setActive] = useState(currentTool)
  const [visited, setVisited] = useState(() => new Set([currentTool()]))
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState(initialTheme)
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')
  const timer = useRef(null)
  const search = useRef(null)
  const main = useRef(null)
  const notify = useCallback((message) => { setToast(message); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(''), 3000) }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('utils.theme', theme) } catch {} }, [theme])
  useEffect(() => { const pop = () => { const id = currentTool(); setActive(id); setVisited((previous) => new Set([...previous, id])) }; window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop) }, [])
  const navigate = useCallback((id) => {
    if (id !== active) { const url = new URL(location.href); if (id === 'home') url.searchParams.delete('tool'); else url.searchParams.set('tool', id); url.hash = ''; history.pushState(null, '', url) }
    setActive(id); setVisited((previous) => new Set([...previous, id])); setMobileNav(false); setQuery(''); main.current?.scrollTo({ top: 0 });
  }, [active])
  useEffect(() => { const key = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setMobileNav(true); search.current?.focus() } if (e.key === 'Escape') { setMobileNav(false); setQuery(''); search.current?.blur() } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [])
  const matches = tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()))
  const selected = tools.find((tool) => tool.id === active)
  useEffect(() => { document.title = `${selected?.name || 'Your developer workbench'} · utils` }, [selected])
  return <div className="shell">
    {mobileNav && <button type="button" className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`navigation${mobileNav ? ' open' : ''}`}>
      <button type="button" className="brand" onClick={() => navigate('home')} aria-label="utils home"><span className="brand-mark"><Icon name="code" size={23} /></span><span>utils<span className="brand-period">.</span><small>THE LOCAL WORKBENCH</small></span></button>
      <div className="nav-search"><Icon name="search" size={16} /><input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) navigate(matches[0].id) }} aria-label="Find a tool" placeholder="Find a tool…" /><kbd>⌘ K</kbd></div>
      <nav aria-label="Utilities"><button type="button" className={`nav-item overview${active === 'home' ? ' active' : ''}`} onClick={() => navigate('home')} aria-current={active === 'home' ? 'page' : undefined}><Icon name="home" /><span>Overview</span><span className="nav-count">11</span></button>{categories.map((category) => { const items = matches.filter((tool) => tool.category === category); return items.length ? <div className="nav-group" key={category}><p>{category}</p>{items.map((tool) => <button type="button" key={tool.id} className={`nav-item${active === tool.id ? ' active' : ''}`} onClick={() => navigate(tool.id)} aria-current={active === tool.id ? 'page' : undefined}><Icon name={tool.id} /><span>{tool.name}</span>{active === tool.id && <span className="active-dot" />}</button>)}</div> : null })}{!matches.length && <p className="nav-no-results">No tools found.</p>}</nav>
      <div className="nav-bottom"><div className="local-note"><span className="live-dot" /><span>All systems local<small>Your data stays in this browser.</small></span></div><button type="button" className="theme-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /><span>{theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}</span></button></div>
    </aside>
    <main className={`workspace${['markdown', 'diff'].includes(active) ? ' workspace-reader' : ''}${active === 'markdown' ? ' workspace-markdown' : active === 'diff' ? ' workspace-diff' : ''}`} ref={main}>
      <header className="topbar"><div className="breadcrumb"><button type="button" className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Icon name="menu" /></button><span>Workbench</span><span className="breadcrumb-slash">/</span><strong>{selected?.name || 'Overview'}</strong></div><span className="local-badge"><Icon name="lock" size={13} />Local only</span></header>
      <div className="workspace-body">{active === 'home' ? <>
        <div className="welcome"><div className="eyebrow"><span className="live-dot" />YOUR EVERYDAY DEVELOPER KIT</div><h1>A little less friction<span>.</span></h1><p>Decode, compare, format, and convert.<br />Useful little tools, right where you need them.</p><div className="welcome-meta"><span><Icon name="lock" size={15} />Private by default</span><span><Icon name="check" size={15} />No accounts. No uploads.</span></div><div className="hero-glyph" aria-hidden="true"><Icon name="code" size={82} /></div></div>
        <div className="section-heading"><div><h2>Your workbench</h2><p>Pick a tool and get straight to it.</p></div><span className="tool-count">11 utilities</span></div>
        <div className="tool-grid">{tools.map((tool) => <button type="button" className="tool-card" key={tool.id} onClick={() => navigate(tool.id)}><div className="card-top"><span className={`tool-icon ${tool.color}`}><Icon name={tool.id} size={23} /></span><span className="card-tag">{tool.tag}</span></div><h3>{tool.name}</h3><p>{tool.description}</p><div className="card-foot"><span>Open tool</span><Icon name="arrow" size={17} /></div></button>)}</div>
        <div className="privacy-strip"><span className="privacy-icon"><Icon name="lock" size={21} /></span><div><strong>Small tools. Your data. Your machine.</strong><p>All processing happens in this browser. Inputs stay in memory and clear when you reload.</p></div><span className="privacy-label">BUILT FOR LOCAL</span></div>
      </> : <><div className="tool-title"><span className={`tool-icon ${selected.color}`}><Icon name={selected.id} size={25} /></span><div><span className="eyebrow">{selected.category}</span><h1>{selected.name}</h1><p>{selected.short}</p></div></div></>}
      {tools.filter((tool) => visited.has(tool.id)).map((tool) => <div key={tool.id} hidden={active !== tool.id} className="tool-content">{tool.id === 'jwt' ? <JwtTool notify={notify} /> : tool.id === 'diff' ? <DiffTool notify={notify} /> : ['json', 'html', 'xml', 'markdown'].includes(tool.id) ? <DocumentTool kind={tool.id} notify={notify} theme={theme} /> : ['base64', 'url'].includes(tool.id) ? <EncodingTool kind={tool.id} notify={notify} /> : tool.id === 'timestamp' ? <TimestampTool notify={notify} /> : tool.id === 'hash' ? <HashTool notify={notify} /> : <UuidTool notify={notify} />}</div>)}
      <footer className="workspace-footer"><span>utils<span className="brand-period">.</span> <span className="footer-separator">/</span> Made for the little things.</span><span>Runs on your machine <span className="live-dot" /></span></footer>
      </div>
    </main>
    {toast && <div className="toast" role="status"><Icon name="check" size={17} />{toast}</div>}
  </div>
}
