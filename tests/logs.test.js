import test from 'node:test'
import assert from 'node:assert/strict'
import { LogIndex, decodedLogText, logContextRange, logFields, logLevel, matchesLog, parseLogLine, readLogEntry, stackTraceSegments, summarizeLogEntry, walkLogEntries, walkLogLines } from '../src/lib/logs.js'

test('Logs support differing schemas, nested fields, malformed JSON, and plain scalar text', () => {
  const payara = parseLogLine('{"Timestamp":"now","Level":"WARNING","LoggerName":"CA","LogMessage":"retry\\nÅsa 👋","Throwable":{"reason":"refused"}}')
  assert.equal(logLevel(payara), 'WARNING')
  assert.equal(summarizeLogEntry(payara).message, 'retry\nÅsa 👋')
  assert.equal(summarizeLogEntry(payara).logger, 'CA')
  assert.ok(matchesLog(payara, { query: 'ÅSA 👋' }))
  assert.ok(matchesLog(payara, { query: 'refused', field: 'Throwable' }))
  assert.equal(matchesLog(payara, { query: 'refused', field: 'LogMessage' }), false)
  assert.equal(matchesLog(payara, { query: 'null', field: 'missing' }), false)
  const other = parseLogLine('{"ts":10,"severity":"error","msg":"failed","extra":true}')
  assert.equal(summarizeLogEntry(other).timestamp, '10')
  assert.ok(matchesLog(other, { level: 'ERROR', format: 'json' }))
  assert.ok(matchesLog(other, { level: ' error ' }))
  assert.equal(matchesLog(other, { level: 'WARNING' }), false)
  const custom = parseLogLine('{"priority":"high","body":{"text":"problem"},"when":false}')
  const view = summarizeLogEntry(custom, { message: 'body', level: 'priority', timestamp: 'when' })
  assert.equal(view.level, 'HIGH'); assert.equal(view.message, '{"text":"problem"}'); assert.equal(view.timestamp, 'false')
  assert.ok(matchesLog(custom, { level: 'HIGH' }, { level: 'priority' }))
  assert.equal(parseLogLine('{broken').format, 'invalid')
  assert.equal(parseLogLine('Starting service').format, 'text')
  assert.equal(parseLogLine('[Entrypoint] starting').format, 'text')
  for (const raw of ['null', 'true', 'false', '42', '"message"', '  true  ', '\uFEFFfalse']) {
    const entry = parseLogLine(raw)
    assert.equal(entry.format, 'text'); assert.deepEqual(logFields(entry), [])
    assert.equal(summarizeLogEntry(entry).message, raw)
  }
  assert.equal(parseLogLine('[1,{"x":"needle"}]').format, 'json')
  assert.equal(parseLogLine('{"enabled":true,"disabled":false}').format, 'json')
  assert.ok(matchesLog(parseLogLine('[{"x":"needle"}]'), { query: 'needle' }))
  const raw = '{"message":"x","id":9007199254740993}'
  assert.equal(parseLogLine(raw).raw, raw)
  const exception = parseLogLine(JSON.stringify({ Throwable: { Exception: 'Include failed', StackTrace: 'ClassNotFoundException\n\tat Client.connect' } }))
  assert.equal(summarizeLogEntry(exception).message, 'Include failed')
  assert.equal(decodedLogText(exception).text, 'Throwable.StackTrace\nClassNotFoundException\n\tat Client.connect')
  assert.equal(decodedLogText(exception, 20).text.length, 20)
  assert.equal(decodedLogText(exception, 20).clipped, true)
})

test('Streaming log offsets survive UTF-8 boundaries, CRLF, BOM, blank lines, and EOF', async () => {
  const source = '\uFEFF{"msg":"Åsa 👋"}\r\n\r\nplain text\n{bad}\n{"msg":"last"}'
  const file = new Blob([source])
  for (const chunkBytes of [1, 2, 7, 17, 1024]) {
    const entries = [], index = new LogIndex()
    await walkLogLines(file, (entry) => { entries.push(entry); index.push(entry.start, entry.end, entry.line) }, { chunkBytes })
    assert.deepEqual(entries.map((entry) => entry.line), [1, 3, 4, 5])
    assert.deepEqual(entries.map((entry) => entry.format), ['json', 'text', 'invalid', 'json'])
    for (let id = 0; id < entries.length; id++) {
      const reread = await readLogEntry(file, index, id)
      assert.equal(reread.raw, entries[id].raw)
      assert.equal(reread.line, entries[id].line)
      const exact = await file.slice(reread.start, reread.end).text()
      assert.equal(exact.replace(/\r$/, '').replace(/^\uFEFF/, ''), entries[id].raw.replace(/^\uFEFF/, ''))
    }
  }
  for (const source of ['', '\n', '  \r\n\t\n']) {
    let count = 0
    await walkLogLines(new Blob([source]), () => count++)
    assert.equal(count, 0)
  }
  const entries = []
  await walkLogLines(new Blob(['hello\n']), (entry) => entries.push(entry))
  assert.equal(entries.length, 1)
})

test('Large log scanning uses bounded slices, handles huge lines, and can cancel', async () => {
  const text = 'x'.repeat(200) + '\n{"msg":"after"}\n'
  const blob = new Blob([text]), reads = []
  const file = { size: blob.size, slice: (start, end) => { reads.push([start, end]); return blob.slice(start, end) }, text: () => assert.fail('Must not read the whole file') }
  const entries = []
  await walkLogLines(file, (entry) => entries.push(entry), { chunkBytes: 19, maxLineBytes: 64 })
  assert.ok(reads.every(([start, end]) => end - start === 19))
  assert.equal(entries[0].raw.length, 64); assert.equal(entries[0].truncated, true)
  assert.equal(entries[0].end, 200); assert.equal(entries[1].value.msg, 'after'); assert.equal(entries[1].line, 2)
  let current = true, visits = 0
  const done = await walkLogLines(new Blob(['x\n'.repeat(100)]), () => visits++, {
    chunkBytes: 10, isCurrent: () => current, onProgress: () => { current = false },
  })
  assert.equal(done, false); assert.equal(visits, 5)
})

test('Compact log index crosses block boundaries and preserves offsets above 4 GiB', () => {
  const index = new LogIndex()
  for (let i = 0; i < 32770; i++) index.push(5_000_000_000 + i * 100, 5_000_000_000 + i * 100 + 99, i + 1)
  assert.deepEqual([...index.get(32769)], [5_003_276_900, 5_003_276_999, 32770])
  assert.throws(() => index.get(-1)); assert.throws(() => index.get(index.length))
})

test('Thread filters use exact names and IDs across schemas, including numeric zero and overrides', () => {
  const payara = parseLogLine('{"ThreadName":"worker","ThreadID":"7"}')
  const alternate = parseLogLine('{"thread_name":"worker","thread_id":7}')
  const other = parseLogLine('{"thread":"worker","tid":17}')
  for (const entry of [payara, alternate]) assert.ok(matchesLog(entry, { threadName: 'worker', threadId: '7' }))
  assert.equal(matchesLog(other, { threadId: '7' }), false)
  assert.equal(matchesLog(payara, { threadName: 'Worker' }), false)
  assert.equal(matchesLog(parseLogLine('plain text worker'), { threadName: 'worker' }), false)
  const custom = parseLogLine('{"lane":"custom","execution":0}')
  const mapping = { threadName: 'lane', threadId: 'execution' }
  assert.ok(matchesLog(custom, { threadName: 'custom', threadId: '0' }, mapping))
  assert.equal(summarizeLogEntry(custom, mapping).threadId, '0')
})

test('Context reads source entries across blank lines and clamps at file boundaries', async () => {
  const file = new Blob(['first\n\n{"msg":"selected"}\n\nlast'])
  const index = new LogIndex()
  await walkLogLines(file, (entry) => index.push(entry.start, entry.end, entry.line))
  const { start, end } = logContextRange(index.length, 1, 10)
  const entries = []
  for (let id = start; id < end; id++) entries.push(await readLogEntry(file, index, id))
  assert.deepEqual(entries.map((entry) => entry.line), [1, 3, 5])
  assert.deepEqual(logContextRange(200, 0, 50), { start: 0, end: 51 })
  assert.deepEqual(logContextRange(200, 199, 50), { start: 149, end: 200 })
  assert.deepEqual(logContextRange(200, 100, 100000), { start: 50, end: 151 })
  assert.throws(() => logContextRange(200, 200))
})

test('Stack focus preserves complete traces and causes while grouping only third-party frames', () => {
  const trace = [
    'Throwable.StackTrace', 'java.lang.RuntimeException: Failed',
    '\tat org.example.Client.run(Client.java:1)', '\tat java.base/java.lang.Thread.run(Thread.java:840)',
    '\tat hopsworks@1.0/io.hops.hopsworks.api.Service.run(Service.java:50)',
    'Caused by: java.sql.SQLException: refused', '\tat com.io.hops.hopsworks.Fake.run(Fake.java:1)',
    '\tSuppressed: java.io.IOException: closed', '\tat io.hops.hopsworks.api.Service$Worker.close(Service.java:60)',
    '\t... 5 more', '',
  ].join('\r\n')
  const segments = stackTraceSegments(trace)
  assert.equal(segments.map((segment) => segment.text).join(''), trace)
  assert.deepEqual(segments.filter((segment) => segment.kind === 'frames').map((segment) => segment.count), [2, 1])
  assert.equal(segments.filter((segment) => segment.kind === 'cause').length, 2)
  assert.ok(segments.filter((segment) => segment.kind === 'text').some((segment) => segment.text.includes('Service$Worker')))
  assert.deepEqual(stackTraceSegments('An ordinary message\nwithout frames'), [])
})

test('Plain text groups cross chunks and blank lines without merging structured or malformed entries', async () => {
  const file = new Blob(['Starting 👋\r\nconfig\r\n\r\nready\r\n{"msg":"json"}\r\none\r\n  two\r\n{broken}\r\ntail'])
  for (const chunkBytes of [1, 7, 31, 1024]) {
    const entries = [], index = new LogIndex(4)
    await walkLogEntries(file, (entry) => { entries.push(entry); index.push(entry.start, entry.end, entry.line, entry.endLine) }, {
      chunkBytes, shouldMatch: (entry) => matchesLog(entry, { query: 'two' }),
    })
    assert.deepEqual(entries.map((entry) => [entry.line, entry.endLine, entry.format]), [[1, 4, 'text'], [5, 5, 'json'], [6, 7, 'text'], [8, 8, 'invalid'], [9, 9, 'text']])
    assert.deepEqual(entries.map((entry) => entry.matches), [false, false, true, false, false])
    assert.equal(entries[0].raw, undefined)
    const first = await readLogEntry(file, index, 0)
    assert.equal(first.raw, 'Starting 👋\r\nconfig\r\n\r\nready')
    assert.equal(first.endLine, 4)
    assert.equal(summarizeLogEntry(first).message, 'Starting 👋 config  ready')
    assert.equal((await readLogEntry(file, index, 4)).raw, 'tail')
  }
})

test('Text groups do not retain their contents and match lines beyond the 8 MiB preview', async () => {
  const blob = new Blob([('text ' + 'x'.repeat(700) + '\n').repeat(12_000) + 'last marker'])
  const file = { size: blob.size, slice: (start, end) => { assert.ok(end - start <= 1024 * 1024); return blob.slice(start, end) } }
  const entries = []
  await walkLogEntries(file, (entry) => entries.push(entry), { shouldMatch: (entry) => matchesLog(entry, { query: 'last marker' }) })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].end, blob.size)
  assert.equal(entries[0].endLine, 12001)
  assert.equal(entries[0].raw, undefined)
  assert.equal(entries[0].matches, true)
  assert.equal(entries[0].truncated, true)
})

test('Booleans and other standalone scalars stay inside surrounding text groups', async () => {
  const source = 'Checking flags\ntrue\nfalse\nnull\n42\n"done"\n{"enabled":true,"disabled":false}\n[true,false]'
  const file = new Blob([source]), entries = [], index = new LogIndex(4)
  await walkLogEntries(file, (entry) => { entries.push(entry); index.push(entry.start, entry.end, entry.line, entry.endLine) }, {
    chunkBytes: 3, shouldMatch: (entry) => matchesLog(entry, { query: 'false', format: 'text' }),
  })
  assert.deepEqual(entries.map((entry) => [entry.line, entry.endLine, entry.format, entry.matches]), [[1, 6, 'text', true], [7, 7, 'json', false], [8, 8, 'json', false]])
  assert.equal((await readLogEntry(file, index, 0)).raw, source.split('\n').slice(0, 6).join('\n'))
})
