// Counting words means walking every character; past this size the number is
// not worth the pause it costs, so it is reported as unavailable instead.
const WORD_COUNT_LIMIT = 2_000_000

export function countStats(source) {
  let lines = source ? 1 : 0
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) lines += 1
  }

  let words = null
  if (source.length <= WORD_COUNT_LIMIT) {
    words = source.trim() ? source.trim().split(/\s+/).length : 0
  }

  return { lines, words, characters: source.length }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const MIME = {
  markdown: 'text/markdown',
  json: 'application/json',
  html: 'text/html',
  xml: 'application/xml',
  text: 'text/plain',
}

export function downloadText(name, contents, kind) {
  const blob = new Blob([contents], { type: `${MIME[kind] || 'text/plain'};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    // Clipboard API needs a secure context; fall back to the legacy path so
    // this keeps working when the app is served over plain http on a LAN IP.
    const area = document.createElement('textarea')
    area.value = value
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}
