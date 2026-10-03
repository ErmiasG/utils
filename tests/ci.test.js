import test from 'node:test'
import assert from 'node:assert/strict'
import { ciFileMetadata, ciLineSignal, ciReport, readCiContext, scanCiBundle, searchCiBundle } from '../src/lib/ci.js'
import { parseLogLine } from '../src/lib/logs.js'

const source = (path, text) => ({ path, file: new Blob([text]) })
const fixture = () => [
  source('jobs/hopsworks/create-repos-r1.txt', 'Name: create-repos-r1\n  Containers:\n    Command:\n      /bin/bash\n      echo "FATAL: this is script source, not runtime evidence"\n      kubectl rollout status statefulset/opensearch\n    Environment:\n      MODE: test\nEvents:\n  Warning BackoffLimitExceeded 10m job-controller Job has reached the specified backoff limit'),
  source('pods/logs/hopsworks/opensearch-0/opensearch.log', '[2026-10-03T09:24:38,464][ERROR] Failed to complete delete batches\r\njava.lang.RuntimeException: Missing required header for this request: Content-Md5.\r\n\r\n\tat example.Client.delete(Client.java:1)\r\n[2026-10-03T09:24:39Z][WARN ] failed to finish repository verification\r\nCaused by: Missing required header for this request: Content-Md5.'),
  source('jobs/hopsworks/migrate-r1.txt', 'Pods Statuses: 0 Active (0 Ready) / 1 Succeeded / 2 Failed\n Normal Completed 5m job-controller Job completed'),
  source('pods/logs/hopsworks/migrate-r1-old/migrate.log', '[rondb] FATAL: tables missing after conversion: task_reschedule'),
  source('pods.hopsworks.txt', 'NAME READY STATUS\nmigrate-r1-old 0/1 Error 0 5m\nservice 1/1 Running 0 5m'),
  source('pods/logs/other/opensearch-0/opensearch.log', 'FATAL: unrelated namespace'),
  source('pods/logs/hopsworks/opensearch-0/opensearch.previous.log', 'previous terminated container "opensearch" in pod "opensearch-0" not found'),
  source('empty.txt', ''),
]

test('CI metadata identifies Kubernetes sources and keeps current and previous containers distinct', () => {
  const file = ciFileMetadata('pods\\logs\\hopsworks\\opensearch-0\\opensearch.previous.log', 123, 7)
  assert.equal(file.path, 'pods/logs/hopsworks/opensearch-0/opensearch.previous.log')
  assert.equal(file.id, 7); assert.equal(file.namespace, 'hopsworks'); assert.equal(file.workload, 'opensearch-0')
  assert.equal(file.container, 'opensearch'); assert.equal(file.previous, true)
  assert.equal(ciFileMetadata('jobs/hopsworks/create-repos.txt').kind, 'Job')
  assert.equal(ciFileMetadata('events.hopsworks.txt').namespace, 'hopsworks')
  assert.equal(ciFileMetadata('events.all.txt').namespace, '')
  assert.equal(ciFileMetadata('runner.log').kind, 'Log')
})

test('CI analysis links terminal Jobs to dependency errors and demotes completed attempts', async () => {
  const bundle = await scanCiBundle(fixture(), { chunkBytes: 7 })
  assert.equal(bundle.stats.files, 8); assert.equal(bundle.stats.failedJobs, 1); assert.equal(bundle.stats.empty, 1)
  const lead = bundle.findings[0]
  assert.equal(lead.ruleId, 'job-failed'); assert.equal(lead.fileId, 0)
  assert.deepEqual(bundle.files[0].dependencies, ['opensearch'])
  const related = lead.related.map((id) => bundle.findings.find((finding) => finding.id === id))
  assert.equal(related[0].ruleId, 's3-checksum')
  assert.ok(related.every((finding) => finding.namespace === 'hopsworks'))
  const checksum = related[0]
  assert.equal(checksum.count, 2); assert.equal(checksum.line, 2); assert.equal(checksum.lastLine, 6)
  assert.equal(bundle.findings.find((finding) => finding.fileId === 3).category, 'recovered')
  assert.equal(bundle.findings.find((finding) => finding.fileId === 4).category, 'recovered')
  assert.equal(bundle.findings.find((finding) => finding.fileId === 6).category, 'collection')
  assert.equal(bundle.findings.some((finding) => finding.fileId === 0 && finding.ruleId === 'fatal'), false)
  assert.equal(bundle.findings.some((finding) => 'raw' in finding), false)
  assert.ok(bundle.indexes[0].blocks[0].byteLength <= 32 * 1024, 'Small files must not each reserve a large index block')
})

test('CI context preserves physical source lines, Unicode, blank lines, and stack traces', async () => {
  const bundle = await scanCiBundle([source('runner.log', '\uFEFFstart 👋\r\n\r\n2026-10-03T09:24:38Z ERROR failed\r\n\tat Client.run\r\nlast')], { chunkBytes: 1 })
  const context = await readCiContext(bundle, 0, 3, 1)
  assert.deepEqual(context.rows, [
    { line: 2, text: '', clipped: false },
    { line: 3, text: '2026-10-03T09:24:38Z ERROR failed', clipped: false },
    { line: 4, text: '\tat Client.run', clipped: false },
  ])
  assert.equal(context.lastLine, 5)
  assert.equal((await readCiContext(bundle, 0, 1)).rows[0].text, 'start 👋')
  assert.equal((await readCiContext(await scanCiBundle([source('empty.txt', '')]), 0)).rows.length, 0)
})

test('Cross-file search scans complete files, counts beyond its result cap, and applies scope filters', async () => {
  const bundle = await scanCiBundle(fixture())
  const result = await searchCiBundle(bundle, 'OPENSEARCH', {}, { limit: 1 })
  assert.equal(result.rows.length, 1); assert.equal(result.limited, true); assert.equal(result.total, 2)
  const current = await searchCiBundle(bundle, 'opensearch', { includePrevious: false })
  assert.equal(current.total, 1)
  assert.equal((await searchCiBundle(bundle, 'Content-Md5', { fileId: 1 })).total, 2)
  assert.equal((await searchCiBundle(bundle, 'FATAL', { category: 'recovered' })).total, 1)
  assert.equal((await searchCiBundle(bundle, 'FATAL', { namespace: 'other' })).total, 1)
  assert.equal((await searchCiBundle(bundle, 'FATAL', { fileId: 0, category: 'failure' })).total, 0)
  assert.equal((await searchCiBundle(bundle, 'migrate-r1-old', { fileId: 4, category: 'recovered' })).total, 1)
  const escaped = await scanCiBundle([source('escaped.log', '{"message":"Missing required header: Content\\u002dMd5","detail":"\\u00c5sa"}')])
  assert.equal((await searchCiBundle(escaped, 'Content-Md5')).total, 1)
  assert.equal((await searchCiBundle(escaped, 'åsa')).total, 1)
})

test('CI scans bound reads, skip binary sources, and cancel scans and searches', async () => {
  const blob = new Blob([('line ' + 'x'.repeat(1000) + '\n').repeat(1500) + 'last marker'])
  const bounded = { size: blob.size, slice: (start, end) => { assert.ok(end - start <= 1024 * 1024); return blob.slice(start, end) } }
  const bundle = await scanCiBundle([{ path: 'large.log', file: bounded }, source('binary.bin', 'bad\u0000bytes')])
  assert.equal(bundle.failures.length, 1); assert.match(bundle.files[1].error, /Binary/)
  assert.equal((await searchCiBundle(bundle, 'last marker')).rows[0].line, 1501)
  await assert.rejects(readCiContext(bundle, 1), /Binary/)
  assert.equal(await scanCiBundle(fixture(), { isCurrent: () => false }), null)
  let current = true
  assert.equal(await searchCiBundle(bundle, 'line', {}, { isCurrent: () => current, onProgress: () => { current = false } }), null)
})

test('CI rules use structured levels and report concrete source evidence', async () => {
  assert.equal(ciLineSignal(parseLogLine('{"Level":"SEVERE","LogMessage":"failed"}')).category, 'failure')
  assert.equal(ciLineSignal(parseLogLine('[INFO] JVM -XX:+HeapDumpOnOutOfMemoryError')), null)
  assert.equal(ciLineSignal(parseLogLine('Failed to fetch remote logs; will retry')), null)
  assert.equal(ciLineSignal(parseLogLine('FAILED tests/test_service.py::test_connect - AssertionError')).id, 'ci-failed')
  assert.equal(ciLineSignal(parseLogLine('# backoffLimit=0 and FATAL: comments are not runtime failures')), null)
  const bundle = await scanCiBundle(fixture())
  const report = ciReport(bundle)
  assert.match(report, /Job exhausted retries/)
  assert.match(report, /jobs\/hopsworks\/create-repos-r1.txt:10/)
  assert.match(report, /Content-Md5/)
  assert.match(report, /Related dependency findings/)
  assert.match(report, /recovered/)
})
