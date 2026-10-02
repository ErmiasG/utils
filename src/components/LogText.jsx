import { useMemo } from 'react'

export default function LogText({ text }) {
  return useMemo(() => text.split(/((?<![\w$.])io\.hops\.hopsworks\.[\w$]+(?:\.[\w$]+)*)/g).map((part, index) =>
    index % 2 ? <mark className="log-hopsworks-reference" key={index}>{part}</mark> : part
  ), [text])
}

export function FocusedStackTrace({ segments }) {
  return <div className="log-stack-focus" aria-label="Focused stack trace">
    {segments.map((segment, index) => segment.kind === 'frames' ? <details key={index}>
      <summary>{segment.count} third-party {segment.count === 1 ? 'frame' : 'frames'}</summary>
      <pre><LogText text={segment.text} /></pre>
    </details> : <pre key={index} className={segment.kind === 'cause' ? 'log-stack-cause' : undefined}><LogText text={segment.text} /></pre>)}
  </div>
}
