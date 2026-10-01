import { formatBytes } from '../lib/text'

// Covers the viewer while a large document is being formatted or rendered.
// The stage label is the honest one — there is no meaningful percentage to
// report for a synchronous parse, so it names the step instead of faking a bar.
export default function Loading({ stage, name, bytes }) {
  if (!stage) return null
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading__card">
        <div className="loading__spinner" aria-hidden="true" />
        <div className="loading__text">
          <strong>{stage}</strong>
          <span>{name}{bytes ? ` · ${formatBytes(bytes)}` : ''}</span>
        </div>
      </div>
    </div>
  )
}
