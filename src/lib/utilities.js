const encoder = new TextEncoder()

export function encodeBase64(text, urlSafe = false) {
  const bytes = encoder.encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = btoa(binary)
  return urlSafe ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded
}

export function decodeBase64(text, urlSafe = false) {
  let value = text.replace(/\s/g, '')
  if (urlSafe) value = value.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1 || (value.includes('=') && value.length % 4 !== 0)) {
    throw new Error('Invalid Base64. Check the alphabet and padding.')
  }
  try {
    const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Cannot decode this as Base64 UTF-8 text.')
  }
}

export function decodeJwt(source) {
  const token = source.trim().replace(/^Bearer\s+/i, '')
  const segments = token.split('.')
  if (segments.length === 5) throw new Error('This is an encrypted JWE token. Its payload cannot be decoded without a key.')
  if (segments.length !== 3 || !segments[0] || !segments[1]) throw new Error('A JWT must have three dot-separated segments: header.payload.signature.')
  if (segments.some((segment) => !/^[A-Za-z0-9_-]*$/.test(segment))) throw new Error('JWT segments must use the Base64URL alphabet.')
  const parse = (segment, label) => {
    try {
      const result = JSON.parse(decodeBase64(segment, true))
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error()
      return result
    } catch { throw new Error(`The ${label} is not a valid Base64URL JSON object.`) }
  }
  return { header: parse(segments[0], 'header'), payload: parse(segments[1], 'payload'), signature: segments[2] }
}

export function jwtTiming(payload, now = Date.now()) {
  const issues = []
  for (const claim of ['iat', 'nbf', 'exp']) {
    if (payload[claim] !== undefined && (typeof payload[claim] !== 'number' || !Number.isFinite(payload[claim]) || Math.abs(payload[claim] * 1000) > 8.64e15)) issues.push(`${claim} must be a valid NumericDate (seconds).`)
  }
  if (issues.length) return { label: 'Invalid time claim', tone: 'warning', issues }
  if (payload.exp !== undefined && now >= payload.exp * 1000) return { label: 'Expired', tone: 'danger', issues }
  if (payload.nbf !== undefined && now < payload.nbf * 1000) return { label: 'Not active yet', tone: 'warning', issues }
  return { label: payload.exp === undefined ? 'No expiry claim' : 'Within time window', tone: 'success', issues }
}

export function parseTimestamp(source, unit = 'seconds') {
  const value = source.trim()
  if (!value) throw new Error('Enter a Unix timestamp or an ISO 8601 date.')
  let milliseconds
  if (/^[+-]?\d+(\.\d+)?$/.test(value)) milliseconds = Number(value) * (unit === 'seconds' ? 1000 : 1)
  else {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error('Use an ISO date with a timezone, e.g. 2026-10-01T12:00:00Z.')
    const [year, month, day] = value.slice(0, 10).split('-').map(Number)
    const calendar = new Date(0)
    calendar.setUTCFullYear(year, month, 0)
    if (month < 1 || month > 12 || day < 1 || day > calendar.getUTCDate()) throw new Error('That calendar date does not exist.')
    milliseconds = Date.parse(value)
  }
  const date = new Date(milliseconds)
  if (!Number.isFinite(date.getTime())) throw new Error('This date is invalid or outside the supported range.')
  return { iso: date.toISOString(), seconds: String(Math.floor(date.getTime() / 1000)), milliseconds: String(date.getTime()), local: date.toLocaleString() }
}

export async function hashText(text, algorithm = 'SHA-256') {
  return hashBytes(encoder.encode(text), algorithm)
}

export async function hashBytes(bytes, algorithm = 'SHA-256') {
  const digest = await crypto.subtle.digest(algorithm, bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function generateUuids(count) {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Choose between 1 and 100 UUIDs.')
  return Array.from({ length: count }, () => crypto.randomUUID()).join('\n')
}
