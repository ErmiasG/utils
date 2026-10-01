import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPatch } from 'diff'
import { decodeBase64, decodeJwt, encodeBase64, generateUuids, hashText, jwtTiming, parseTimestamp } from '../src/lib/utilities.js'
import { compareTexts } from '../src/lib/compare.js'
import { formatDocument, minifyDocument } from '../src/lib/format.js'

test('Base64 round-trips multilingual UTF-8 and URL-safe values', () => {
  for (const value of ['', 'Hello, world! 👋', 'Åäö / 日本語 / العربية', 'a\n\tb\r\n']) {
    for (const safe of [false, true]) assert.equal(decodeBase64(encodeBase64(value, safe), safe), value)
  }
  for (const value of ['a', 'not*base64', 'abc===', '/w==', 'YQ=']) assert.throws(() => decodeBase64(value))
  assert.equal(decodeBase64(' YQ==\n'), 'a')
})

test('JWT decoder accepts Bearer, Unicode claims and unsecured tokens, rejects invalid structure', () => {
  const header = { alg: 'none', typ: 'JWT' }
  const payload = { name: 'Åsa 👋', exp: 2000 }
  const token = `${encodeBase64(JSON.stringify(header), true)}.${encodeBase64(JSON.stringify(payload), true)}.`
  assert.deepEqual(decodeJwt(` Bearer ${token} `), { header, payload, signature: '' })
  assert.throws(() => decodeJwt('a.b.c.d.e'), /encrypted JWE/)
  assert.throws(() => decodeJwt('a.b'), /three dot-separated/)
  assert.throws(() => decodeJwt('e30=.e30.signature'), /alphabet/)
  assert.throws(() => decodeJwt(`${encodeBase64('[]', true)}.e30.`), /JSON object/)
})

test('JWT timing treats expiry boundary as expired and nbf as not yet active', () => {
  assert.equal(jwtTiming({ exp: 2 }, 2000).label, 'Expired')
  assert.equal(jwtTiming({ exp: 2 }, 1999).label, 'Within time window')
  assert.equal(jwtTiming({ nbf: 3 }, 2000).label, 'Not active yet')
  assert.equal(jwtTiming({}, 2000).label, 'No expiry claim')
  for (const exp of ['2', Infinity, 9e15]) assert.equal(jwtTiming({ exp }).label, 'Invalid time claim')
})

test('Timestamp parsing supports units, pre-epoch and explicit timezone dates', () => {
  assert.equal(parseTimestamp('0').iso, '1970-01-01T00:00:00.000Z')
  assert.equal(parseTimestamp('1000', 'milliseconds').seconds, '1')
  assert.equal(parseTimestamp('-1').iso, '1969-12-31T23:59:59.000Z')
  assert.equal(parseTimestamp('2026-10-01T14:00:00+02:00').iso, '2026-10-01T12:00:00.000Z')
  assert.equal(parseTimestamp('2024-02-29T00:00:00Z').iso, '2024-02-29T00:00:00.000Z')
  for (const value of ['', '2026-10-01', '2026-02-29T00:00:00Z', '2026-02-30T00:00:00Z', '9999999999999999']) assert.throws(() => parseTimestamp(value))
})

test('SHA-256 matches known vectors and UUIDs have v4 and variant bits', async () => {
  assert.equal(await hashText('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(await hashText(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  const values = generateUuids(100).split('\n')
  assert.equal(new Set(values).size, 100)
  values.forEach((value) => assert.match(value, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/))
  for (const count of [0, 101, 1.2, NaN]) assert.throws(() => generateUuids(count))
})

test('Diff tracks insertion, deletion and line numbers, and exports an applicable patch', () => {
  const before = 'one\ntwo\nthree\n'
  const after = 'zero\none\nthree\nfour\n'
  const result = compareTexts(before, after)
  assert.equal(result.added, 2)
  assert.equal(result.removed, 1)
  assert.deepEqual(result.rows.find((row) => row.text === 'one'), { text: 'one', type: 'same', oldLine: 1, newLine: 2 })
  assert.equal(applyPatch(before, result.patch), after)
  assert.equal(compareTexts('', '').identical, true)
  assert.equal(compareTexts('', 'new\n').added, 1)
  assert.equal(compareTexts('old\n', '').removed, 1)
})

test('Diff display options preserve exact bytes in exported patch, including EOF and CRLF', () => {
  const before = '  same  \r\nlast\r\n'
  const after = 'same\nlast\n'
  const result = compareTexts(before, after, { ignoreWhitespace: true, ignoreLineEndings: true })
  assert.equal(result.identical, true)
  assert.equal(applyPatch(before, result.patch), after)
  assert.equal(compareTexts('same\n', 'same').identical, false)
  assert.equal(applyPatch('same\n', compareTexts('same\n', 'same').patch), 'same')
  assert.throws(() => compareTexts('a'.repeat(4_000_001), ''), /4 million/)
})

test('Copied formatters format JSON, locate syntax errors and preserve HTML preformatted content', () => {
  assert.equal(formatDocument('json', '{"a":1}', { indent: 4 }).output, '{\n    "a": 1\n}')
  assert.equal(minifyDocument('json', '{ "a": 1 }').output, '{"a":1}')
  const invalid = formatDocument('json', '{\n "a":\n}')
  assert.ok(invalid.error)
  assert.equal(invalid.error.line, 3)
  assert.equal(invalid.error.column, 1)
  const html = '<pre>  spaced\n    lines </pre>'
  assert.equal(formatDocument('html', html).output, html)
  assert.match(formatDocument('xml', '<a><b></a>').error.message, /Unclosed|Unexpected/)
})
