// `File.text()` gives no progress events, so large files read as a silent
// stall. FileReader reports `loaded` / `total` as it goes, which is what the
// progress panel needs.
//
// Note that the browser decides how often `progress` fires — a small file may
// jump straight from 0% to 100% in a single event. That is accurate, not a bug.
export function readFileWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    }
    reader.onload = () => {
      onProgress(file.size, file.size)
      resolve(String(reader.result ?? ''))
    }
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`))
    reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled`))

    reader.readAsText(file)
  })
}
