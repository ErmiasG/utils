import { ciReport, readCiContext, scanCiBundle, searchCiBundle } from './ci.js'

let bundle = null, queryVersion = 0, detailVersion = 0
const send = (type, request, data) => self.postMessage({ type, request, ...data })
function progress(request) {
  let last = 0
  return (loaded, total, path) => {
    if (Date.now() - last > 100 || loaded === total) { send('progress', request, { loaded, total, path }); last = Date.now() }
  }
}

async function handle(data) {
  if (data.type === 'load') {
    bundle = await scanCiBundle(data.sources, { onProgress: progress(data.request) })
    const { files, findings, failures, stats } = bundle
    send('ready', data.request, { files, findings, failures, stats })
  } else if (data.type === 'search') {
    queryVersion = data.request
    const result = await searchCiBundle(bundle, data.query, data.filters, { onProgress: progress(data.request), isCurrent: () => queryVersion === data.request })
    if (result && queryVersion === data.request) send('search', data.request, result)
  } else if (data.type === 'cancel-search') queryVersion = data.request
  else if (data.type === 'context') {
    detailVersion = data.request
    const detail = await readCiContext(bundle, data.fileId, data.line, data.radius)
    if (detailVersion === data.request) send('context', data.request, detail)
  } else if (data.type === 'report') send('report', data.request, { text: ciReport(bundle) })
}

self.onmessage = ({ data }) => handle(data).catch((error) => send('error', data.request, { error: error.message || 'Could not read the CI logs.' }))
