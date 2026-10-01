// Only the languages this app can actually show, so the bundle stays small.
import hljs from 'highlight.js/lib/core'

import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const LANGUAGES = {
  bash, css, diff, go, java, javascript, json, markdown,
  plaintext, python, rust, shell, sql, typescript, xml, yaml,
}

for (const [name, definition] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, definition)
}

hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['html', 'htm', 'svg', 'vue'], { languageName: 'xml' })
hljs.registerAliases(['sh', 'zsh', 'console'], { languageName: 'shell' })
hljs.registerAliases(['yml'], { languageName: 'yaml' })
hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerAliases(['md'], { languageName: 'markdown' })
hljs.registerAliases(['text', 'txt'], { languageName: 'plaintext' })

export const HLJS_LANGUAGE = {
  json: 'json',
  html: 'xml',
  xml: 'xml',
  markdown: 'markdown',
  text: 'plaintext',
}

export function highlight(code, language) {
  const name = hljs.getLanguage(language) ? language : 'plaintext'
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value
  } catch {
    return null
  }
}

export default hljs
