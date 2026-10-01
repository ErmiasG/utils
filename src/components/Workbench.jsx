import { useRef, useState } from 'react'
import Icon from './Icon'
import { copyText, downloadText, formatBytes } from '../lib/text'

export function Notice({ children, tone = 'danger' }) {
  return children ? <div className={`notice ${tone}`} role="status">{children}</div> : null
}

export function Action({ icon, children, primary = false, ...props }) {
  return <button type="button" className={`button${primary ? ' primary' : ''}`} {...props}>{icon && <Icon name={icon} size={15} />}{children}</button>
}

export function CopyButton({ value, notify, label = 'Copy', disabled = false }) {
  return <Action icon="copy" disabled={disabled || !value} onClick={async () => notify(await copyText(value) ? 'Copied to clipboard' : 'Could not copy. Select and copy the text manually.')}>{label}</Action>
}

export function useTextFile({ onChange, onFile, notify, maxFileBytes = 5_000_000 }) {
  const sequence = useRef(0)
  const [reading, setReading] = useState(false)
  const read = async (file) => {
    if (!file) return
    const id = ++sequence.current
    setReading(true)
    try {
      if (maxFileBytes != null && file.size > maxFileBytes) throw new Error(`Choose a text file smaller than ${maxFileBytes / 1_000_000} MB.`)
      const text = await file.text()
      if (id !== sequence.current) return
      if (text.includes('\u0000')) throw new Error('This looks like a binary file. Choose a UTF-8 text file.')
      onChange(text)
      onFile?.(file.name)
      notify?.(`Opened ${file.name}`)
    } catch (error) { if (id === sequence.current) notify?.(error.message) }
    finally { if (id === sequence.current) setReading(false) }
  }
  const cancelRead = () => { sequence.current++; setReading(false) }
  return { read, reading, cancelRead }
}

export function Editor({ label, value, onChange, placeholder, onFile, filename, readOnly = false, children, notify, rows = 13, fileReader, maxFileBytes = 5_000_000 }) {
  const ref = useRef(null)
  const fallbackReader = useTextFile({ onChange, onFile, notify, maxFileBytes })
  const { read, reading, cancelRead } = fileReader || fallbackReader
  const [dragging, setDragging] = useState(false)
  return <section className={`editor panel${dragging ? ' dragging' : ''}`} onDragOver={readOnly ? undefined : (e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={readOnly ? undefined : (e) => { e.preventDefault(); setDragging(false); read(e.dataTransfer.files[0]) }}>
    <div className="panel-head"><span className="panel-label">{label}</span><div className="panel-actions">{children}{!readOnly && <Action icon="upload" onClick={() => ref.current?.click()} disabled={reading}>{reading ? 'Reading…' : 'Open file'}</Action>}</div></div>
    {!readOnly && <input ref={ref} type="file" hidden onChange={(e) => { read(e.target.files[0]); e.target.value = '' }} />}
    <textarea aria-label={label} value={value} readOnly={readOnly} onChange={(e) => { cancelRead(); onChange?.(e.target.value) }} placeholder={placeholder} rows={rows} spellCheck="false" autoCapitalize="off" autoCorrect="off" />
    <div className="editor-foot"><span>{filename || (readOnly ? 'Output' : 'Plain text · UTF-8')}</span><span>{value.length.toLocaleString()} chars <span className="dot">·</span> {formatBytes(new Blob([value]).size)}</span></div>
  </section>
}

export function Output({ value, notify, filename = 'output.txt', label = 'Result' }) {
  return <Editor label={label} value={value} readOnly><CopyButton value={value} notify={notify} /><Action icon="download" disabled={!value} onClick={() => downloadText(filename, value, 'text')}>Save</Action></Editor>
}

export function EmptyResult({ icon = 'code', title = 'Your result will appear here', children }) {
  return <div className="empty-result"><span className="empty-icon"><Icon name={icon} size={25} /></span><strong>{title}</strong><p>{children}</p></div>
}
