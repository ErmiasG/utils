import { LOG_DETAIL_CHARS, LogIndex, logLevel, logValue, matchesLog, summarizeLogEntry, walkLogLines } from './logs.js'

export const CI_RESULT_LIMIT = 200
const clean = (text) => text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
const snippet = (text) => clean(text).slice(0, 1600)

export function ciFileMetadata(path, size = 0, id = 0) {
  path = path.replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = path.split('/'), name = parts.at(-1)
  let namespace = '', workload = '', container = '', kind = 'Other'
  if (parts[0] === 'pods' && ['logs', 'describe'].includes(parts[1])) {
    namespace = parts[2] || ''; workload = (parts[3] || '').replace(/\.txt$/, '')
    if (parts[1] === 'logs') { kind = 'Container log'; container = name.replace(/(?:\.previous)?\.log$/, '') }
    else kind = 'Pod description'
  } else if (['jobs', 'deployments', 'statefulsets', 'pvc'].includes(parts[0]) && parts.length >= 3) {
    namespace = parts[1]; workload = name.replace(/\.txt$/, '')
    kind = { jobs: 'Job', deployments: 'Deployment', statefulsets: 'StatefulSet', pvc: 'Volume' }[parts[0]]
  } else if (parts[0] === 'rondb-on-disk') {
    kind = 'Database log'; namespace = 'hopsworks'; workload = parts[2] || ''
  } else if (/^(?:events|pods|all|top)\./.test(name)) {
    const scope = name.split('.')[1]
    namespace = ['all', 'txt'].includes(scope) ? '' : scope
    kind = name.startsWith('events.') ? 'Events' : 'Cluster snapshot'
  } else if (/\.(?:log|out|err)$/i.test(name)) kind = 'Log'
  return { id, path, name, size, namespace, workload, container, kind, previous: /\.previous\./.test(name), signals: 0, lines: 0, dependencies: [], commandRanges: [], outcome: '' }
}

const rules = [
  { id: 'job-failed', title: 'Job exhausted retries or its deadline', priority: 100, category: 'failure', explanation: 'This is a terminal Job failure. Inspect its container logs and dependencies.', test: /\b(?:BackoffLimitExceeded|DeadlineExceeded)\b|Job has reached the specified backoff limit|Job was active longer than specified deadline/ },
  { id: 'ci-failed', title: 'CI command or test failed', priority: 100, category: 'failure', explanation: 'The runner or test output reports a failure. Inspect the preceding output for the first cause.', test: /##\[error\]|Process completed with exit code [1-9]|\bTests run:.*\b(?:Failures|Errors):\s*[1-9]|^\s*(?:FAIL:|FAILED\s+\S+::|AssertionError:)/i },
  { id: 's3-checksum', title: 'S3 request is missing a required checksum', priority: 90, category: 'failure', explanation: 'The S3 endpoint rejected a request missing Content-Md5. Check the client and endpoint checksum compatibility.', test: /Missing required header[^\r\n]*Content-Md5/i },
  { id: 'oom', title: 'Process ran out of memory', priority: 90, category: 'failure', explanation: 'Check memory limits, usage, and the last terminated container state.', test: /\bOOMKilled\b|\bOutOfMemoryError(?::|\s*$)|\bCannot allocate memory\b|\bKilled process \d+.*out of memory/i },
  { id: 'fatal', title: 'Fatal application failure', priority: 85, category: 'failure', explanation: 'A fatal message usually explains why this process stopped.', test: /\bFATAL\s*:|\[FATAL\s*\]|(?:^|\s)panic:/i },
  { id: 'repository', title: 'Snapshot repository verification failed', priority: 80, category: 'failure', explanation: 'Repository setup could not complete verification. Inspect nested exceptions and storage errors.', test: /RepositoryVerificationException|failed to (?:finish|complete) repository verification/i },
  { id: 'access', title: 'Access or authentication was denied', priority: 75, category: 'failure', explanation: 'Check the identity, permissions, and operation named in the message.', test: /\bAccess denied\b|\bPermission denied\b|\bauthentication failed\b|\bUnauthorized\b|\bForbidden\b/i },
  { id: 'pod-failed', title: 'Failed pod in the collected snapshot', priority: 75, category: 'failure', explanation: 'Check the owning Job and newer attempts; failed pods may remain after a successful retry.', test: /^\S+\s+\d+\/\d+\s+(?:Error|Init:Error|CrashLoopBackOff|ImagePullBackOff|ErrImagePull|Evicted)\b/ },
  { id: 'exit-code', title: 'Container exited with a nonzero code', priority: 70, category: 'failure', explanation: 'Inspect this container’s logs and whether a later attempt succeeded.', test: /^\s*Exit Code:\s*[1-9]\d*\s*$/ },
  { id: 'exception', title: 'Application exception', priority: 60, category: 'failure', explanation: 'Inspect the exception cause and surrounding log entries.', test: /^(?:Caused by:\s*)?(?:[\w$]+\.)+[\w$]*(?:Exception|Error):|^\s*Traceback \(most recent call last\):/ },
  { id: 'startup', title: 'Kubernetes scheduling, mount, or probe warning', priority: 35, category: 'warning', explanation: 'These warnings often occur during startup. Check the final pod state before treating them as blockers.', test: /\bWarning\s+(?:FailedMount|FailedScheduling|Unhealthy|BackOff|Failed|FailedCreate)\b/ },
]

export function ciLineSignal(entry, file) {
  const raw = clean(entry.raw)
  // Collection diagnostics and embedded deployment scripts are not runtime errors.
  if (/previous terminated container .*not found|Error from server \(NotFound\)|unable to retrieve container logs/i.test(raw)) {
    return { id: 'collection', title: 'Some source logs could not be collected', priority: 5, category: 'collection', explanation: 'This is a collection gap, not evidence that the workload failed.' }
  }
  if (/^\s*#/.test(raw) || file?.commandRanges?.some(([start, end]) => entry.line >= start && entry.line <= end)) return null
  const message = entry.format === 'json' ? summarizeLogEntry(entry).message : raw
  for (const rule of rules) if (rule.test.test(message)) {
    const workload = rule.id === 'pod-failed' ? message.trim().split(/\s/)[0].replace(/^pod\//, '') : ''
    return workload ? { ...rule, workload } : rule
  }
  const tail = entry.timestamp ? raw.slice(raw.indexOf(entry.timestamp) + entry.timestamp.length) : raw
  const level = logLevel(entry) || (/\[(ERROR|SEVERE|WARN|WARNING)\s*\]/i.exec(raw)?.[1] || /^[\s\]|]*(ERROR|SEVERE|FATAL|WARN|WARNING)\b/i.exec(tail)?.[1] || '').toUpperCase()
  if (level === 'FATAL') return rules.find((rule) => rule.id === 'fatal')
  if (['ERROR', 'SEVERE', 'FATAL'].includes(level)) return { id: 'error', title: 'Application logged an error', priority: 55, category: 'failure', explanation: 'Inspect the message and context to decide whether the error caused the run to fail.' }
  if (['WARN', 'WARNING'].includes(level)) return { id: 'warning', title: 'Application warning', priority: 20, category: 'warning', explanation: 'Warnings are lower priority unless supported by a failed resource or test.' }
  return null
}

function lowerBound(index, line) {
  let low = 0, high = index.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (index.get(middle)[2] < line) low = middle + 1
    else high = middle
  }
  return low
}

function ownerJob(file, files) {
  if (!file.workload || file.kind === 'Job') return null
  return files.find((job) => job.kind === 'Job' && job.namespace === file.namespace && file.workload.startsWith(job.workload + '-'))
}

export function correlateCiFindings(findings, files) {
  for (const file of files) file.recovered = ownerJob(file, files)?.outcome === 'completed'
  for (const finding of findings) {
    const file = files[finding.fileId]
    const recovered = file.recovered || ownerJob({ ...file, workload: finding.workload }, files)?.outcome === 'completed'
    finding.category = recovered && finding.category === 'failure' ? 'recovered' : finding.category
    if (finding.category === 'recovered') {
      finding.priority = Math.min(finding.priority, 25)
      finding.explanation += ' The owning Job completed in this bundle, so this attempt recovered.'
    }
    finding.related = []
  }
  for (const finding of findings) {
    const file = files[finding.fileId]
    if (finding.ruleId === 'job-failed' && file.kind === 'Job') {
      const candidates = findings.filter((other) => {
        const source = files[other.fileId]
        return source.namespace === file.namespace && other.category === 'failure' && source.id !== file.id
          && file.dependencies.some((name) => source.workload === name || source.workload.startsWith(name + '-'))
      }).sort((a, b) => b.priority - a.priority)
      finding.related = candidates.filter((other) => other.priority >= (candidates[0]?.priority || 0) - 20).slice(0, 3).map((other) => other.id)
    }
  }
  return findings.sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path) || a.line - b.line)
}

export async function scanCiBundle(sources, { onProgress = () => {}, isCurrent = () => true, chunkBytes } = {}) {
  const files = sources.map(({ path, file }, id) => ciFileMetadata(path, file.size, id))
  const indexes = [], grouped = new Map(), failures = []
  const total = files.reduce((sum, file) => sum + file.size, 0)
  let loaded = 0
  for (const meta of files) {
    if (!isCurrent()) return null
    // Small blocks avoid reserving 768 KiB for each tiny file in a CI bundle.
    const source = sources[meta.id].file, index = new LogIndex(3, 1024), dependencies = new Set()
    let command = null, commandIndent = 0
    indexes[meta.id] = index
    try {
      const done = await walkLogLines(source, (entry) => {
        if (entry.raw.includes('\u0000')) throw new Error('Binary file skipped; choose UTF-8 text.')
        index.push(entry.start, entry.end, entry.line); meta.lines = entry.line
        meta.truncated ||= entry.truncated
        if (['Job', 'Deployment', 'StatefulSet', 'Pod description'].includes(meta.kind)) {
          const header = /^(\s*)(?:Command|Args):\s*$/.exec(entry.raw)
          if (header) {
            if (command) command[1] = entry.line - 1
            commandIndent = header[1].length; command = [entry.line, Infinity]; meta.commandRanges.push(command)
          } else if (command && entry.raw.trim() && /^\s*/.exec(entry.raw)[0].length <= commandIndent) {
            command[1] = entry.line - 1; command = null
          }
        }
        if (meta.kind === 'Job') {
          if (/^Pods Statuses:.*\b[1-9]\d* Succeeded\b/.test(entry.raw) || /\bNormal\s+Completed\b.*Job completed/.test(entry.raw)) meta.outcome = 'completed'
          if (/\bBackoffLimitExceeded\b|\bDeadlineExceeded\b/.test(entry.raw) && !/^\s*#/.test(entry.raw)) meta.outcome = 'failed'
          for (const match of entry.raw.matchAll(/(?:statefulset|deployment|job)(?:\.apps)?\/([\w.-]+)/g)) dependencies.add(match[1])
        }
        const signal = ciLineSignal(entry, meta)
        if (!signal) return
        meta.signals++
        const key = `${meta.id}:${signal.id}:${signal.workload || ''}`
        const evidence = { fileId: meta.id, path: meta.path, line: entry.line, text: snippet(entry.raw), timestamp: String(logValue(entry, 'timestamp') || '') }
        const prior = grouped.get(key)
        if (prior) {
          prior.count++; prior.lastLine = entry.line
          if (prior.evidence.length < 3) prior.evidence.push(evidence)
          prior.lastEvidence = evidence
        } else {
          grouped.set(key, { id: key, ruleId: signal.id, title: signal.title, explanation: signal.explanation, priority: signal.priority, category: signal.category,
            fileId: meta.id, path: meta.path, namespace: meta.namespace, workload: signal.workload || meta.workload, line: entry.line, lastLine: entry.line, count: 1, evidence: [evidence], lastEvidence: evidence, related: [] })
        }
      }, { chunkBytes, isCurrent, onProgress: (bytes) => onProgress(loaded + bytes, total, meta.path) })
      if (!done) return null
      if (command) command[1] = meta.lines
      meta.dependencies = [...dependencies]
    } catch (error) {
      meta.error = error.message; failures.push({ path: meta.path, error: error.message })
      indexes[meta.id] = new LogIndex(3, 1024); meta.signals = 0; meta.lines = 0; meta.outcome = ''
      for (const key of grouped.keys()) if (key.startsWith(`${meta.id}:`)) grouped.delete(key)
    }
    loaded += source.size
    onProgress(loaded, total, meta.path)
  }
  const findings = correlateCiFindings([...grouped.values()], files)
  const stats = { files: files.length, bytes: total, empty: files.filter((file) => !file.size).length,
    signals: files.reduce((sum, file) => sum + file.signals, 0), findings: findings.length, failedJobs: files.filter((file) => file.kind === 'Job' && file.outcome === 'failed').length }
  return { sources, files, indexes, findings, failures, stats }
}

export function matchesCiFile(file, filters = {}) {
  return (!filters.namespace || file.namespace === filters.namespace)
    && (filters.fileId == null || file.id === filters.fileId)
    && (filters.includePrevious !== false || !file.previous)
}

export async function searchCiBundle(bundle, query, filters = {}, { onProgress = () => {}, isCurrent = () => true, limit = CI_RESULT_LIMIT } = {}) {
  const needle = query.toLowerCase(), rows = []
  const selected = bundle.files.filter((file) => !file.error && matchesCiFile(file, filters))
  const totalBytes = selected.reduce((sum, file) => sum + file.size, 0)
  let count = 0, loaded = 0
  for (const file of selected) {
    const done = await walkLogLines(bundle.sources[file.id].file, (entry) => {
      if (!clean(entry.raw).toLowerCase().includes(needle) && !matchesLog(entry, { query })) return
      const signal = ciLineSignal(entry, file)
      const recovered = file.recovered || signal?.workload && ownerJob({ ...file, workload: signal.workload }, bundle.files)?.outcome === 'completed'
      const category = recovered && signal?.category === 'failure' ? 'recovered' : signal?.category
      if (filters.category && category !== filters.category) return
      count++
      if (rows.length < limit) rows.push({ fileId: file.id, path: file.path, line: entry.line, text: snippet(entry.raw), category: category || '', timestamp: String(logValue(entry, 'timestamp') || '') })
    }, { isCurrent, onProgress: (bytes) => onProgress(loaded + bytes, totalBytes, file.path) })
    if (!done) return null
    loaded += file.size
  }
  return { rows, total: count, limited: count > rows.length }
}

export async function readCiContext(bundle, fileId, line = 1, radius = 10) {
  const file = bundle.files[fileId], index = bundle.indexes[fileId]
  if (!file) throw new Error('File is out of range.')
  if (file.error) throw new Error(file.error)
  const rows = [], lastLine = index.length ? index.get(index.length - 1)[2] : 0
  line = Math.max(1, Math.min(Number(line) || 1, lastLine || 1))
  const first = Math.max(1, line - radius), last = Math.min(lastLine, line + radius)
  let position = lowerBound(index, first)
  const maxChars = Math.floor(LOG_DETAIL_CHARS / (2 * radius + 1))
  for (let number = first; number <= last; number++) {
    if (position < index.length && index.get(position)[2] === number) {
      const [start, end] = index.get(position++)
      const raw = new TextDecoder().decode(await bundle.sources[fileId].file.slice(start, Math.min(end, start + maxChars)).arrayBuffer()).replace(/\r$/, '')
      rows.push({ line: number, text: clean(raw), clipped: end - start > maxChars })
    } else rows.push({ line: number, text: '', clipped: false })
  }
  return { fileId, path: file.path, line, rows, lastLine }
}

export function ciReport(bundle) {
  const parts = [`# CI log findings\n\n${bundle.stats.files} files · ${bundle.stats.signals} detected signals · ${bundle.stats.failedJobs} failed Jobs\n\nPattern matches are investigation leads. Dependency links are inferred from Job commands; the runner log is needed to confirm which failure ended CI.\n`]
  for (const finding of bundle.findings) {
    parts.push(`\n## ${finding.title}\n\n${finding.category} · ${finding.count} occurrences · ${finding.path}:${finding.line}\n\n${finding.explanation}\n`)
    for (const evidence of finding.evidence) parts.push(`\n${evidence.path}:${evidence.line}\n\n\`\`\`text\n${evidence.text.replace(/```/g, "''' ")}\n\`\`\`\n`)
    if (finding.related.length) parts.push('\nRelated dependency findings: ' + finding.related.map((id) => {
      const related = bundle.findings.find((item) => item.id === id)
      return `${related.title} (${related.path}:${related.line})`
    }).join('; ') + '\n')
  }
  if (bundle.failures.length) parts.push('\n## Files skipped\n\n' + bundle.failures.map((file) => `${file.path}: ${file.error}`).join('\n'))
  return parts.join('')
}
