import { compareTexts } from './compare'

self.onmessage = ({ data }) => {
  try { self.postMessage({ result: compareTexts(data.before, data.after, data.options) }) }
  catch (error) { self.postMessage({ error: error.message }) }
}
