# utils.

A local developer workbench. Reuses the Markdown renderer, Mermaid integration,
syntax highlighting, and JSON/HTML/XML formatters from `../MdReader`.
The app is self-contained after installation; MdReader is not needed at runtime.

## Run locally

Requires Node.js **22.12+** (or Node.js 24) and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:5174**. Add `--open` to launch a browser:

```bash
pnpm dev --open
```

For a production build:

```bash
pnpm build
pnpm preview
```

Open **http://127.0.0.1:4174**. Both servers bind to the loopback interface by
default. `dist/` is a static site and can also be served by a local HTTP server.
Use an HTTP server rather than opening `index.html` directly: module imports,
Web Workers, and browser crypto require the appropriate browser context.

## Tools

| Tool | What it does |
| --- | --- |
| JWT decoder | Decodes Base64URL header and payload, displays time claims, accepts a Bearer prefix. Does **not** verify signatures. Encrypted JWE tokens are identified but not decrypted. |
| Text & file diff | Compares pasted text or UTF-8 files across the full workspace, shows additions/removals and line numbers, exports an exact unified patch. Optional edge-whitespace and CRLF normalization apply to the display; exported patches preserve the original inputs. |
| JSON log viewer | Opens or drops UTF-8 JSON Lines / NDJSON and plain-text logs. Timestamps at the start of a line begin new text entries; continuation lines stay grouped. Detects varying timestamp, level, logger, message, and thread fields; supports display-field overrides, level/format/thread dropdowns, custom filter values, and case-insensitive full-text or property search. Inspect formatted JSON, original entries, or decoded multiline strings. Stack focus collapses third-party frames while keeping Hopsworks frames and cause headers visible. Show 10/25/50 original entries on each side of a result, jump to its original page, and save exact source lines. |
| CI log explorer | Imports an extracted CI artifact folder or multiple files. Browses source paths and Kubernetes namespaces, pods, and containers; groups failure evidence and links failed Jobs to errors in dependencies referenced by their commands. Separates failures, startup warnings, recovered Job attempts, and collection gaps. Searches across files, shows numbered source context, opens files in the log viewer, and exports findings or complete source files. |
| JSON formatter | Formats with 2/4/8 spaces, minifies, and reports syntax-error line and column. |
| Markdown reader | Sanitized GitHub-flavored Markdown with syntax-highlighted code, tables, tasks, heading anchors, and lazy-loaded Mermaid diagrams. Opens at full workspace width and height, with optional split view for editing. |
| HTML / XML formatters | Formats and minifies markup, shows warnings for unbalanced tags, and supports original source view. |
| Base64 converter | Encodes/decodes UTF-8 text including emoji, with optional Base64URL alphabet. |
| URL encoder | Uses URL-component encoding and decoding. Spaces encode as `%20`; decoding does not interpret `+` as a space. |
| Timestamp converter | Converts Unix seconds/milliseconds and timezone-qualified ISO dates to UTC, local time, and Unix units. |
| Hash generator | SHA-256, SHA-384, SHA-512, and legacy SHA-1 for UTF-8 text or exact file bytes. |
| UUID generator | Generates 1–100 cryptographically random version 4 UUIDs, with optional uppercase output. |

Search tools in the sidebar; **Ctrl/Cmd+K** focuses search and **Enter** opens the
first match. **Escape** clears search and closes mobile navigation. Tool URLs
use `?tool=jwt`, `?tool=diff`, etc., and support browser back/forward navigation.
Switch tools without losing inputs. Reloading clears all inputs.

In the log viewer, **Show context** includes neighboring entries outside active
filters and centers the selected entry. **Jump to original position** clears
filters and opens its page in the source file. Click a thread name or ID in the
table to follow it, or use **Follow thread** in details to match both values.
Following a thread clears other filters so earlier messages remain visible.
Thread matching is exact and case-sensitive; display-field overrides also apply
to thread filters and their dropdown options. Choose **Enter a value…** to filter
by a value outside the detected options. **Stack focus** keeps `Caused by` and `Suppressed` headers
visible; collapsed frame groups can be expanded, and Copy retains the full trace.

Plain-text entries split at leading ISO timestamps, numeric date/time stamps,
syslog dates (such as `Oct  3 12:34:56`), or times (`12:34:56,789`), including
timestamps in square brackets. Stack traces and other lines without a leading
timestamp stay with the preceding text entry. Text before the first timestamp
forms its own entry; text without timestamps remains grouped. Detected text
timestamps appear in the Timestamp column with their original spelling.

Open **CI log explorer** (`?tool=ci`) and choose **Open folder** to select the
extracted artifact directory, such as `logs (1)`. Folder drops also preserve
relative paths. Start with the prioritized finding and its dependency links,
then inspect evidence to see the original lines and stack trace. **Search all
logs** scans every selected file; Namespace and Evidence filters narrow the
scope. Select a file to search within it, or choose **All files** to restore
cross-file search. **Open in log viewer** opens that source without importing
it again. **Save findings** downloads a Markdown report with source paths and
line numbers. A failed attempt is marked recovered when its owning Job has a
successful outcome in the collected descriptions. Pattern matches and command
dependency links are investigation leads; include runner output to confirm
which failure ended CI. The app does not contact an external analysis service.

## Privacy and limits

Processing happens entirely in your browser: no backend API, analytics, CDN,
external fonts, or input uploads. Only the theme is stored in localStorage.
Automatic remote image/resource loading is removed from Markdown previews;
embedded Base64 bitmap images are allowed. Clicking a document's external link
can still open that site in a new tab.

- Text file import: Markdown, diff, and logs have no fixed size limit; other tools accept up to 5 MB per file. Choose UTF-8 text. Binary comparisons are not supported.
- Formatting and encoding: up to 2 million characters. Markdown preview accepts larger documents; available browser memory determines the practical limit.
- Diff: no fixed character limit. A worker and computation limits protect the UI from expensive comparisons. The preview shows at most 10,000 rows; the full patch is downloadable when generation completes within the computation limit. Available browser memory determines the practical input size limit.
- Logs (`?tool=logs`): no fixed file size limit. A worker scans 1 MiB chunks and keeps a compact byte-offset index (about 32 bytes per entry, plus up to 8 bytes per matching entry). Only the current 100-entry page or a context window of up to 101 entries is read for display. Search scans the file in the background; opening another file or clearing cancels work. Available browser memory and disk speed determine the practical limit. JSON objects and arrays occupy one physical line each. Plain-text entries split at leading timestamps, preserving continuation lines, internal blank lines, and source line ranges. Text without timestamps stays grouped. Standalone booleans, numbers, null, and quoted strings remain plain text. Invalid JSON stays visible as a separate entry. Text blocks are searched line by line, including beyond the 8 MiB read preview; individual physical lines over 8 MiB are indexed as text and searched only in their first 8 MiB. Detail previews show up to 200,000 characters; Save entry preserves the entire original entry, including a BOM or trailing CR, without loading it all into memory. Field/level/thread suggestions list up to 256 unique values each; entry details preserve arbitrary properties. Choose Original to see exact numeric values beyond JavaScript's safe integer range.
- Hashing: up to 100 MB per binary file; file hashing reads the whole file into memory.
- CI explorer: no fixed folder size limit. A worker scans each file in 1 MiB slices and stores offsets for nonblank lines (about 24 bytes each), file metadata, and grouped evidence with bounded snippets. Binary or unreadable files are reported and skipped. Searches count all matching physical lines and display the first 200; narrow the scope to find later matches. Findings show 100 groups per page. Context shows up to 21 physical lines with a bounded preview; Save file preserves the complete source. Individual lines over 8 MiB are scanned using their first 8 MiB. Available browser memory determines the practical bundle size. Archives must be extracted before import; folder selection uses the browser's directory picker.
- Markup formatting is a tolerant indenter, not a full HTML/XML parser. Minification removes comments and may alter significant whitespace. Check output before using it in whitespace-sensitive documents.
- JSON formatting uses `JSON.parse`, so numbers beyond JavaScript's safe integer range can lose precision; use Original view to preserve exact source.
- Mermaid and other dependencies are bundled locally. Diagram chunks load from the app's own origin when needed.

## Check changes

```bash
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

To use an installed Chrome instead of downloading Chromium:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome pnpm test:e2e
```

Browser tests use the production preview server and cover file intake, worker
diffs, patch export, JWT validation, formatting, Mermaid, sanitization, external
request blocking, converters, navigation, and mobile layouts.

## Structure

- `src/App.jsx`: navigation, tool catalog, theme, and in-memory tool retention.
- `src/tools/`: individual utility interfaces.
- `src/components/`: shared editors, actions, and copied preview components.
- `src/lib/`: copied MdReader helpers plus JWT/conversion logic and diff worker.
- `tests/`: core utility tests and production-browser integration tests.

The diff implementation uses [jsdiff](https://github.com/kpdecker/jsdiff).
The app is built with [Vite](https://vite.dev/guide/) and React.
