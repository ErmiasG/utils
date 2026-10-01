import { Marked } from 'marked'
import DOMPurify from 'dompurify'

const marked = new Marked({
  gfm: true,
  breaks: false,
  pedantic: false,
})

// Links should leave the app in a new tab, and never carry the referrer.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // A document must not contact remote hosts simply by being previewed.
  // Permit embedded bitmap images; other resources require an explicit link.
  for (const attribute of ['src', 'srcset', 'poster', 'background']) {
    if (node.hasAttribute(attribute) && !(attribute === 'src' && /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(node.getAttribute(attribute)))) {
      node.removeAttribute(attribute)
    }
  }
  if (['image', 'use'].includes(node.tagName?.toLowerCase())) {
    for (const attribute of ['href', 'xlink:href']) {
      if (node.hasAttribute(attribute) && !node.getAttribute(attribute).startsWith('#')) node.removeAttribute(attribute)
    }
  }
  if (node.tagName === 'A' && node.getAttribute('href')?.startsWith('http')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

// Split into two steps so a slow document can report which one it is in —
// on a multi-megabyte file each of these takes seconds on its own.
export function parseMarkdown(source) {
  return marked.parse(source ?? '')
}

export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'link'],
    FORBID_ATTR: ['style'],
    ADD_ATTR: ['target', 'id'],
  })
}

// Mermaid hands back SVG it has already run through DOMPurify itself, but
// nothing reaches this app's DOM without its own pass, so it gets one. The
// options mirror mermaid's: `foreignobject` carries the HTML labels, and
// naming it as an integration point is what keeps that markup from being
// flattened on the way through.
export function sanitizeSvg(svg) {
  return DOMPurify.sanitize(svg, {
    ADD_TAGS: ['foreignobject'],
    ADD_ATTR: ['dominant-baseline', 'target', 'id'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  })
}

export function renderMarkdown(source) {
  return sanitizeHtml(parseMarkdown(source))
}

export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}
